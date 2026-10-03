import type { Response } from "express";
import config from "../config/index.ts";
import { sendProblem } from "./problem.ts";

type StreamOptions = { heartbeatMs: number; maxPerUser: number; coalesceMs: number };
/** 서버 목록 페이지의 연결 하나. canSee 는 보낼 때 그 서버를 볼 수 있는지 묻는다 */
type ListSub = { res: Response; canSee: (guildId: string) => boolean; userKey: string; cleanup?: () => void };

/**
 * 대시보드 플레이어 상태 변화 넛지 (SSE, 하이브리드).
 *
 * 두 종류의 구독:
 *  - 개별 서버(플레이어) 페이지: 서버 1개 구독 (this.guilds: guildId -> Set<res>)
 *  - 서버 목록 페이지: 사용자가 볼 수 있는 서버 전체를 한 연결로 멀티플렉스 (this.listSubs). 볼 수 있는지는 보낼 때 묻는다
 *    → 목록마다 서버 수만큼 연결을 여는 폭발을 피함.
 *
 * 페이로드는 "어느 서버에 변화 발생"이라는 최소 신호(`{"t":"changed","g":"<guildId>"}`). 받으면 GET으로 재조회.
 * per-user 권한/범위 지정은 GET 경로가 담당, 이 모듈은 "누가 무엇을 구독 중인가"만 관리.
 */
class PlayerStream {
  maxPerUser: number;
  coalesceMs: number;
  guilds = new Map<string, Set<Response>>(); // 개별 서버 페이지
  listSubs = new Set<ListSub>(); // 서버 목록 페이지. 멀티플렉스
  perKey = new Map<string, number>(); // userKey -> 연결 수 (사용자당 캡, 모든 탭 · 기기의 개별+목록 공유)
  _cleanups = new WeakMap<Response, () => void>(); // idempotent cleanup (쓰기 실패 경로에서 호출)
  coalesceTimers = new Map<string, NodeJS.Timeout>();
  heartbeat: NodeJS.Timeout;

  constructor({ heartbeatMs, maxPerUser, coalesceMs }: StreamOptions) {
    this.maxPerUser = maxPerUser;
    this.coalesceMs = coalesceMs;

    // 하트비트: 유휴 연결이 프록시 타임아웃으로 끊기지 않게 주기적 주석 전송
    this.heartbeat = setInterval(() => this._pingAll(), heartbeatMs);
    this.heartbeat.unref();
  }

  _sseHead(res: Response) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write(": connected\n\n");
  }

  /** 사용자당 연결 캡 확인 + 카운트 증가. 초과 시 429 응답 후 false. 이미 끊긴 연결도 false */
  _capOk(res: Response, userKey: string) {
    // 부르는 쪽이 멤버 확인을 기다리는 사이 끊겼다. 이제 건 close 감시는 불리지 않아 셈이 남는다
    if (res.closed) return false;
    const count = this.perKey.get(userKey) || 0;
    if (count >= this.maxPerUser) {
      sendProblem(res, "too-many-streams");
      return false;
    }
    this.perKey.set(userKey, count + 1);
    return true;
  }

  _releaseKey(userKey: string) {
    const c = (this.perKey.get(userKey) || 1) - 1;
    if (c <= 0) this.perKey.delete(userKey);
    else this.perKey.set(userKey, c);
  }

  /** 개별 서버(플레이어) 페이지 구독. requireAuth + 멤버십 게이트 뒤 호출할 것. */
  addClient(guildId: string, res: Response, userKey: string) {
    if (!this._capOk(res, userKey)) return;
    this._sseHead(res);

    let set = this.guilds.get(guildId);
    if (!set) {
      set = new Set<Response>();
      this.guilds.set(guildId, set);
    }
    const subscribers = set;
    set.add(res);

    // idempotent cleanup. close/error/쓰기 실패 어느 경로로 와도 회계(Set·perKey 캡·빈 Set 정리)가 한 번만, 전부 정리.
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      subscribers.delete(res);
      if (subscribers.size === 0 && this.guilds.get(guildId) === subscribers) this.guilds.delete(guildId);
      this._releaseKey(userKey);
    };
    this._cleanups.set(res, cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  }

  /** 서버 목록 페이지 구독. 볼 수 있는 서버(canSee)의 이벤트를 한 연결로 멀티플렉스. 연결을 연 뒤 들어간 서버도 보낼 때 본다 */
  addListClient(res: Response, canSee: (guildId: string) => boolean, userKey: string) {
    if (!this._capOk(res, userKey)) return;
    this._sseHead(res);

    const sub: ListSub = { res, canSee, userKey };
    this.listSubs.add(sub);

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      this.listSubs.delete(sub);
      this._releaseKey(userKey);
    };
    sub.cleanup = cleanup;
    res.on("close", cleanup);
    res.on("error", cleanup);
  }

  /** 서버 상태 변화 알림. coalesceMs 동안 몰린 호출을 한 번의 넛지로 합침. 구독자 없으면 타이머도 안 만듦. */
  notify(guildId: string | null | undefined) {
    if (!guildId) return;
    if (!this.guilds.has(guildId) && this.listSubs.size === 0) return; // 이 서버를 볼 구독자 없음
    if (this.coalesceTimers.has(guildId)) return; // 이미 예약됨
    const t = setTimeout(() => {
      this.coalesceTimers.delete(guildId);
      this._emit(guildId);
    }, this.coalesceMs);
    t.unref();
    this.coalesceTimers.set(guildId, t);
  }

  _emit(guildId: string) {
    // guildId를 함께 보낸다. 목록 구독자는 여러 서버를 한 연결로 받으므로, 이게 없으면
    // 어느 서버가 바뀌었는지 몰라 전부 다시 조회해야 한다(전역 재생 바가 자기 대상만 고르는 근거).
    // 목록 구독자에게는 그 서버를 볼 수 있을 때만 보내 ID 노출 문제는 없다.
    const payload = `data: {"t":"changed","g":${JSON.stringify(guildId)}}\n\n`;
    const set = this.guilds.get(guildId);
    if (set) {
      for (const res of set) {
        try {
          res.write(payload);
        } catch {
          this._cleanups.get(res)?.();
        }
      }
    }
    // 목록 구독자: 볼 수 있는 서버의 이벤트만 (스코핑)
    for (const sub of this.listSubs) {
      if (sub.canSee(guildId)) {
        try {
          sub.res.write(payload);
        } catch {
          sub.cleanup?.();
        }
      }
    }
  }

  _pingAll() {
    const ping = ": ping\n\n";
    for (const set of this.guilds.values()) {
      for (const res of set) {
        try {
          res.write(ping);
        } catch {
          this._cleanups.get(res)?.();
        }
      }
    }
    for (const sub of this.listSubs) {
      try {
        sub.res.write(ping);
      } catch {
        sub.cleanup?.();
      }
    }
  }

  /** 서버 목록 연결을 열어 둔 사용자 */
  listUsers() {
    return new Set([...this.listSubs].map((sub) => sub.userKey));
  }

  /** 하트비트와 예약한 넛지를 멈춘다 */
  close() {
    clearInterval(this.heartbeat);
    for (const t of this.coalesceTimers.values()) clearTimeout(t);
    this.coalesceTimers.clear();
  }
}

/** 설정(`SSE_*`)으로 허브를 만든다. 조립이 하나 만들어 플레이어 알림과 대시보드 경로에 나눠 준다 */
function createPlayerStream(options: StreamOptions = config.dashboard.sse) {
  return new PlayerStream(options);
}

export { createPlayerStream, PlayerStream };
