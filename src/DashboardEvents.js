"use strict";

const config = require("../config");

const { heartbeatMs, maxPerUser, coalesceMs } = config.dashboard.sse;

/**
 * DashboardEvents — 대시보드 플레이어 상태 변화 넛지 (SSE, 하이브리드).
 *
 * 두 종류의 구독:
 *  - 개별 서버(플레이어) 페이지: 길드 1개 구독 (this.guilds: guildId -> Set<res>)
 *  - 서버 목록 페이지: 사용자의 상호+멤버 길드 전체를 한 연결로 멀티플렉스 (this.listSubs)
 *    → 목록마다 길드 수만큼 연결을 여는 폭발을 피함.
 *
 * 페이로드는 "변화 발생" 최소 신호(`{"t":"changed"}`, 민감정보 없음) — 클라이언트가 받으면 GET으로 재조회.
 * per-user 권한/범위 지정은 GET 경로가 담당, 이 모듈은 "누가 무엇을 구독 중인가"만 관리.
 */
class DashboardEvents {
  constructor() {
    this.guilds = new Map(); // guildId -> Set<res>       (개별 서버 페이지)
    this.listSubs = new Set(); // { res, guildIds:Set }   (서버 목록 페이지 — 멀티플렉스)
    this.listGuildIds = new Map(); // guildId -> 그 길드를 구독 중인 목록 구독자 수 (notify 가드 O(1))
    this.perKey = new Map(); // userKey -> 연결 수 (세션당 캡, 개별+목록 공유)
    this._cleanups = new WeakMap(); // res -> idempotent cleanup (쓰기 실패 경로에서 호출)
    this.coalesceTimers = new Map(); // guildId -> timer

    // 하트비트: 유휴 연결이 프록시 타임아웃으로 끊기지 않게 주기적 주석 전송
    this.heartbeat = setInterval(() => this._pingAll(), heartbeatMs);
    if (this.heartbeat.unref) this.heartbeat.unref();
  }

  _sseHead(res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (res.flushHeaders) res.flushHeaders();
    res.write(": connected\n\n");
  }

  /** 세션당 연결 캡 확인 + 카운트 증가. 초과 시 429 응답 후 false. */
  _capOk(res, userKey) {
    const count = this.perKey.get(userKey) || 0;
    if (count >= maxPerUser) {
      res.status(429).json({ error: "이벤트 연결이 너무 많습니다" });
      return false;
    }
    this.perKey.set(userKey, count + 1);
    return true;
  }

  _releaseKey(userKey) {
    const c = (this.perKey.get(userKey) || 1) - 1;
    if (c <= 0) this.perKey.delete(userKey);
    else this.perKey.set(userKey, c);
  }

  /** 개별 서버(플레이어) 페이지 구독. requireAuth + 멤버십 게이트 뒤 호출할 것. */
  addClient(guildId, res, userKey) {
    if (!this._capOk(res, userKey)) return;
    this._sseHead(res);

    let set = this.guilds.get(guildId);
    if (!set) {
      set = new Set();
      this.guilds.set(guildId, set);
    }
    set.add(res);

    // idempotent cleanup — close/error/쓰기 실패 어느 경로로 와도 회계(Set·perKey 캡·빈 Set 정리)가 한 번만, 전부 정리.
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      set.delete(res);
      if (set.size === 0 && this.guilds.get(guildId) === set) this.guilds.delete(guildId);
      this._releaseKey(userKey);
    };
    this._cleanups.set(res, cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  }

  /** 서버 목록 페이지 구독 — guildIds(사용자의 상호+멤버 길드 집합)의 이벤트를 한 연결로 멀티플렉스. */
  addListClient(res, guildIds, userKey) {
    if (!this._capOk(res, userKey)) return;
    this._sseHead(res);

    const sub = { res, guildIds };
    this.listSubs.add(sub);
    for (const gid of guildIds) this.listGuildIds.set(gid, (this.listGuildIds.get(gid) || 0) + 1);

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      this.listSubs.delete(sub);
      for (const gid of guildIds) {
        const c = (this.listGuildIds.get(gid) || 1) - 1;
        if (c <= 0) this.listGuildIds.delete(gid);
        else this.listGuildIds.set(gid, c);
      }
      this._releaseKey(userKey);
    };
    sub.cleanup = cleanup;
    res.on("close", cleanup);
    res.on("error", cleanup);
  }

  /** 길드 상태 변화 알림 — coalesceMs 동안 몰린 호출을 한 번의 넛지로 합침. 구독자 없으면 타이머도 안 만듦. */
  notify(guildId) {
    if (!guildId) return;
    if (!this.guilds.has(guildId) && !this.listGuildIds.has(guildId)) return; // 이 길드를 보는 구독자 없음
    if (this.coalesceTimers.has(guildId)) return; // 이미 예약됨
    const t = setTimeout(() => {
      this.coalesceTimers.delete(guildId);
      this._emit(guildId);
    }, coalesceMs);
    if (t.unref) t.unref();
    this.coalesceTimers.set(guildId, t);
  }

  _emit(guildId) {
    const payload = 'data: {"t":"changed"}\n\n';
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
    // 목록 구독자: 자기 길드 집합에 든 길드의 이벤트만 (스코핑)
    for (const sub of this.listSubs) {
      if (sub.guildIds.has(guildId)) {
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
}

module.exports = new DashboardEvents();
