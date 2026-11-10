import type { Response } from "express";
import config from "../config/index.ts";
import { onTunablesChanged } from "../config/tunables-changed.ts";
import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/error-kind.ts";
import { sendProblem } from "./problem.ts";
import type { GuildEvent } from "./contract/guilds.ts";
const log = logger.child({ category: "dashboard" });

type StreamOptions = { heartbeatMs: number; maxPerUser: number; coalesceMs: number };
/** 연결 하나. canSee 는 보낼 때 그 서버의 보기 권한을 확인한다. guilds 는 연결을 열 때(와 그 뒤 봇이 든 서버에서) 멤버로 확인한 서버: 게이트웨이에 재연결해 멤버 캐시가 비면 이 서버들만 다시 채운다 */
type Sub = { res: Response; canSee: (guildId: string) => boolean; userKey: string; guilds: Set<string>; cleanup: () => void };
/** 확보한 슬롯 하나(사용자당 연결 상한의 슬롯). 해제는 여러 번 호출해도 한 번만 동작한다 */
type Slot = { userKey: string; release: () => void };

/**
 * 대시보드 플레이어 상태 변화 넛지(SSE).
 *
 * 화면의 탭 하나가 연결 하나를 연다. 그 연결이 사용자가 볼 수 있는 서버 전체의 신호를 싣는다(보기 권한은 보낼 때 확인한다).
 * 서버 목록, 재생 바, 서버 화면이 같은 연결을 나눠 쓴다.
 *
 * 페이로드는 "어느 서버에 변화 발생"이라는 최소 신호(`{"t":"changed","g":"<guildId>"}`). 받으면 GET으로 재조회.
 * per-user 권한/범위 지정은 GET 경로가 담당, 이 모듈은 "누가 구독 중인가"만 관리.
 */
class PlayerStream {
  /** 상한, 합치기 창은 쓸 때마다 읽는다(설정 객체를 넘기면 운영 조절값을 저장하자마자 적용된다) */
  options: StreamOptions;
  heartbeatMs: number;
  subs = new Set<Sub>();
  perKey = new Map<string, number>(); // userKey -> 연결 수 (사용자당 캡, 모든 탭, 기기 합산)
  coalesceTimers = new Map<string, NodeJS.Timeout>();
  heartbeat: NodeJS.Timeout;
  /** 설정 알림 떼기(close 때) */
  offChanged: (() => void) | null = null;

  constructor(options: StreamOptions) {
    this.options = options;
    // 하트비트: 유휴 연결이 프록시 타임아웃으로 끊기지 않게 주기적 주석 전송
    this.heartbeatMs = options.heartbeatMs;
    this.heartbeat = this._armHeartbeat();
  }

  _armHeartbeat() {
    const timer = setInterval(() => this._pingAll(), this.heartbeatMs);
    timer.unref();
    return timer;
  }

  /** 하트비트 간격이 바뀌었으면 다시 건다 */
  syncHeartbeat() {
    if (this.options.heartbeatMs === this.heartbeatMs) return;
    clearInterval(this.heartbeat);
    this.heartbeatMs = this.options.heartbeatMs;
    this.heartbeat = this._armHeartbeat();
  }

  _sseHead(res: Response) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      // 세션이 끝나 연결을 끊을 때 소켓을 강제로 닫으므로 재사용하지 않게 한다
      Connection: "close",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write(": connected\n\n");
  }

  /**
   * 사용자당 연결 슬롯을 하나 잡는다. 상한에 도달했으면 null을 반환한다. 라우트 핸들러는 멤버 확인(디스코드 조회) 전에 슬롯을 잡고 조회가 끝날 때까지 유지한다:
   * 연결이 그사이 닫혀도 곧바로 풀면 열고 끊기를 되풀이해 끝나지 않은 조회가 상한보다 많아진다
   */
  reserve(userKey: string): Slot | null {
    const count = this.perKey.get(userKey) || 0;
    if (count >= this.options.maxPerUser) return null;
    this.perKey.set(userKey, count + 1);
    let held = true;
    return {
      userKey,
      release: () => {
        if (!held) return;
        held = false;
        this._releaseKey(userKey);
      },
    };
  }

  _releaseKey(userKey: string) {
    const c = (this.perKey.get(userKey) || 1) - 1;
    if (c <= 0) this.perKey.delete(userKey);
    else this.perKey.set(userKey, c);
  }

  /** 구독(슬롯 확보와 연결 열기를 함께 수행). 상한을 넘으면 too-many-streams로 답하고 false를 반환한다. 대기 없이 바로 여는 쪽(테스트)에서 쓴다 */
  addClient(res: Response, canSee: (guildId: string) => boolean, userKey: string, guilds = new Set<string>()) {
    const slot = this.reserve(userKey);
    if (!slot) {
      sendProblem(res, "too-many-streams");
      return false;
    }
    if (this.open(res, slot, canSee, guilds)) return true;
    slot.release();
    return false;
  }

  /**
   * 확보한 슬롯으로 연결을 연다. 보기 권한(canSee)이 있는 서버의 신호를 한 연결로 보내며, 연결 후 들어간 서버도 전송할 때 권한을 확인한다. guilds는 멤버로 확인한 서버다.
   * 그사이 연결이 닫혔으면 열지 않고 false를 반환한다(슬롯은 호출한 쪽이 해제한다). 연결을 열면 닫힘, 오류, 쓰기 실패 시 슬롯을 한 번 해제한다
   */
  open(res: Response, slot: Slot, canSee: (guildId: string) => boolean, guilds = new Set<string>()) {
    // 호출한 쪽이 멤버 확인을 기다리는 사이에 연결이 끊겼다. 이미 닫힌 뒤라 close 리스너를 등록해도 호출되지 않는다
    if (res.closed) return false;
    const { userKey } = slot;
    this._sseHead(res);

    // idempotent cleanup. close/error/쓰기 실패 어느 경로로 와도 회계(구독, perKey 캡)가 한 번만
    let done = false;
    const sub: Sub = {
      res,
      canSee,
      userKey,
      guilds,
      cleanup: () => {
        if (done) return;
        done = true;
        this.subs.delete(sub);
        slot.release();
      },
    };
    this.subs.add(sub);
    res.on("close", sub.cleanup);
    res.on("error", (error: unknown) => {
      log.debug(`재생 상태 SSE 연결 오류: ${messageOf(error)}`);
      sub.cleanup();
    });
    return true;
  }

  /** 연결 하나를 뺀다(세션이 끝나 끊을 때). 닫힘을 기다리지 않는다 */
  drop(res: Response) {
    for (const sub of this.subs) if (sub.res === res) sub.cleanup();
  }

  /** 서버 상태 변화 알림. coalesceMs 동안 몰린 호출을 한 번의 넛지로 합침. 그 서버를 볼 구독자가 없으면 타이머도 안 만듦. */
  notify(guildId: string | null | undefined) {
    if (!guildId) return;
    if (![...this.subs].some((sub) => sub.canSee(guildId))) return;
    if (this.coalesceTimers.has(guildId)) return; // 이미 예약됨
    const t = setTimeout(() => {
      this.coalesceTimers.delete(guildId);
      this._emit(guildId);
    }, this.options.coalesceMs);
    t.unref();
    this.coalesceTimers.set(guildId, t);
  }

  /**
   * 봇이 그 서버에서 나갔다. 이제 그 서버를 볼 수 없어 canSee 를 묻지 않고, 나가기 전에 그 서버 멤버였던 사용자(userKeys)의 연결에 바로 보낸다.
   * 받은 화면이 서버 목록을 다시 읽어 그 서버를 빼고, 초대 화면이 그 서버를 되돌린다
   */
  notifyLeft(guildId: string, userKeys: Set<string>) {
    this._emit(guildId, (sub) => userKeys.has(sub.userKey));
  }

  _emit(guildId: string, to = (sub: Sub) => sub.canSee(guildId)) {
    // guildId를 함께 보낸다. 한 연결이 여러 서버를 받으므로, 이게 없으면
    // 어느 서버가 바뀌었는지 몰라 전부 다시 조회해야 한다(재생 바, 서버 화면이 자기 서버만 선택하는 근거).
    // 그 서버를 볼 수 있는 구독자에게만 보내 ID 노출 문제는 없다.
    const payload = `data: ${JSON.stringify({ t: "changed", g: guildId } satisfies GuildEvent)}\n\n`;
    for (const sub of this.subs) {
      if (!to(sub)) continue;
      try {
        sub.res.write(payload);
      } catch (error) {
        log.trace(`재생 상태 SSE 쓰기 실패: ${messageOf(error)}`);
        sub.cleanup();
      }
    }
  }

  _pingAll() {
    const ping = ": ping\n\n";
    for (const sub of this.subs) {
      try {
        sub.res.write(ping);
      } catch (error) {
        log.trace(`재생 상태 SSE 하트비트 쓰기 실패: ${messageOf(error)}`);
        sub.cleanup();
      }
    }
  }

  /** 연결을 열어 둔 사용자 */
  listUsers() {
    return new Set([...this.subs].map((sub) => sub.userKey));
  }

  /** 그 서버를 멤버로 확인한 연결의 사용자 */
  watching(guildId: string) {
    return new Set([...this.subs].filter((sub) => sub.guilds.has(guildId)).map((sub) => sub.userKey));
  }

  /** 그 사용자의 연결에 멤버로 확인한 서버를 더한다(연결을 연 뒤 봇이 든 서버) */
  watch(userKey: string, guildId: string) {
    for (const sub of this.subs) if (sub.userKey === userKey) sub.guilds.add(guildId);
  }

  /** 하트비트와 예약한 넛지를 멈춘다 */
  close() {
    this.offChanged?.();
    this.offChanged = null;
    clearInterval(this.heartbeat);
    for (const t of this.coalesceTimers.values()) clearTimeout(t);
    this.coalesceTimers.clear();
  }
}

/** 설정(`SSE_*`)으로 허브를 만든다. 조립이 하나 만들어 플레이어 알림과 대시보드 경로에 나눠 준다. 하트비트 간격도 저장하면 바로 적용된다 */
function createPlayerStream(options: StreamOptions = config.dashboard.sse) {
  const stream = new PlayerStream(options);
  stream.offChanged = onTunablesChanged(() => stream.syncHeartbeat());
  return stream;
}

export { createPlayerStream, PlayerStream };
export type { Slot };
