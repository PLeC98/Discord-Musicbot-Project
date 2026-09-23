"use strict";

const log = require("./infra/log/logger").child({ category: "track" });
const config = require("../config");

/**
 * 대기열 앞부분을 캐시에 올려둔 상태로 유지한다.
 *
 * 조작 지점마다 알리는 대신 주기적으로 대기열을 직접 본다. 큐를 변형하는 지점이 수십 곳이라
 * 알림 방식은 하나만 빠뜨려도 그 경로가 조용히 예열되지 않는다. 직접 보면 최악이 몇 초 늦음이고,
 * 큐 조작이 늘어도 여기를 고칠 필요가 없다.
 *
 * 앞 N곡의 서명이 연속 두 틱 같을 때만 움직인다. 셔플하는 동안에는 매 틱 목표가 바뀌어서
 * 곧 쓸모없어질 곡을 계속 받게 된다. 조작이 멎기를 기다렸다가 한 번만 움직인다.
 *
 * 예열 루프는 하나뿐이고 매 반복마다 목표를 다시 계산한다. 그래서 세대를 셀 필요가 없고,
 * 루프가 하나라는 사실만으로 동시 다운로드가 1로 묶인다.
 */
class QueueWarmer {
  /**
   * @param {object} player  MusicPlayer (queue / currentTrack / loop / guild 를 읽는다)
   * @param {object} deps    협력자 주입. 생략하면 실제 모듈을 쓴다
   */
  constructor(player, deps = {}) {
    this.player = player;

    this.intervalMs = deps.intervalMs ?? config.preload.tickMs;
    this.ahead = deps.ahead ?? config.preload.ahead;
    this.gapMs = deps.gapMs ?? config.preload.gapMs;

    // 한 곡을 캐시에 올린다. 실패는 던진다.
    this.warm = deps.warm;
    // 캐시 파일이 이미 있는가 / 지금 받는 중인가. 이 둘만이 "받을 필요가 없다"의 근거다.
    this.isCached = deps.isCached;
    this.isBusy = deps.isBusy;
    // 트랙 → 캐시 키(없을 수 있다: 아직 유튜브 동등물을 못 찾은 스포티파이 트랙)
    this.keyOf = deps.keyOf;
    // 길드의 보호 키 집합을 통째로 교체한다
    this.setProtection = deps.setProtection;

    this._timer = null;
    this._sleepTimer = null;
    this._lastSeen = null; // 직전 틱의 서명. 안정 여부 판정용
    this._applied = null; // 실제로 반영한 서명
    this._running = false;
    this._stopped = false;
    this._failed = new Set(); // 이번 서명에서 실패한 트랙. 같은 곡을 무한히 재시도하지 않는다
  }

  start() {
    if (this._timer) return;
    this._stopped = false;
    this._timer = setInterval(() => this.tick(), this.intervalMs);
    if (typeof this._timer.unref === "function") this._timer.unref();
  }

  stop() {
    this._stopped = true;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._sleepTimer) {
      clearTimeout(this._sleepTimer);
      this._sleepTimer = null;
    }
    this._lastSeen = null;
    this._applied = null;
    this._failed = new Set();
    const guildId = this.player.guild?.id;
    if (guildId) this.setProtection(guildId, []);
  }

  /** 한 박자. 서명이 안정됐고 아직 반영하지 않았을 때만 움직인다. */
  tick() {
    if (this._stopped) return;

    const signature = this.signature();
    const stable = signature === this._lastSeen;
    this._lastSeen = signature;

    if (!stable) return; // 아직 조작 중. 목표가 확정되길 기다린다
    if (signature === this._applied) return;
    this._applied = signature;
    this._failed = new Set();

    // 보호를 먼저 건다. 예열이 끝나기 전에 퇴거가 돌아 방금 받은 파일을 가져가면 안 된다.
    // 아직 캐시가 없는 키까지 넣는다. 해당 행이 없으면 퇴거 쪽에서 무해하게 무시된다.
    const guildId = this.player.guild?.id;
    if (guildId) {
      const keys = this.targets()
        .map((t) => this.keyOf(t))
        .filter(Boolean);
      log.debug(`사전 캐싱 보호 갱신: ${keys.length}곡`);
      this.setProtection(guildId, keys);
    }

    this._run().catch((err) => log.error(`사전 캐싱 실패: ${err?.message || err}`));
  }

  /**
   * 내려간 영상을 고른 자동재생 곡을 대기열에서 빼고 다른 곡으로 채운다.
   *
   * 소스 DB(VocaDB·LB Radio 등)는 그 영상이 아직 살아 있다고 믿으므로, 우리가 기억해 두지
   * 않으면 다음 뽑기에서 같은 것을 또 고른다.
   *
   * @returns {boolean} 버렸으면 true. 부르는 쪽은 평소의 실패 처리를 건너뛴다.
   */
  _dropDeadAutoplay(track, err) {
    const YouTube = require("./sources/youtube/index");
    if (!YouTube.isVideoUnavailableError(err)) return false;

    const index = this.player.queue.indexOf(track);
    if (index < 0) return false;

    require("./autoplay/route").markDead(track);
    require("./trackState").removeAt(this.player, index);
    log.info(`자동재생 곡을 뺍니다(영상 없음): "${track.title}". 다른 곡을 고릅니다`);

    // 뺀 자리를 메운다. 기다리지 않는다. 예열 루프를 잡아 두면 뒤 곡이 밀린다.
    this.player.ensureAutoplayNext?.().catch(() => {});
    return true;
  }

  /**
   * 예열 대상. 대기열 앞 N곡.
   *
   * 현재 곡은 제외한다(재생 경로가 이미 받고 있다). 라이브는 끝이 없어 캐시 대상이 아니다.
   * 한곡 반복 중에는 다음 곡이 현재 곡이므로 앞을 받아둘 이유가 없다.
   */
  targets() {
    if (this.player.loop === "track") return [];
    const out = [];
    for (const track of this.player.queue) {
      if (out.length >= this.ahead) break;
      if (!track || track.isLive) continue;
      out.push(track);
    }
    return out;
  }

  /**
   * 대기열 앞부분의 지문. 순서가 바뀌면 달라져야 하므로 이어붙인다.
   * 현재 곡도 넣는다. 대기열은 그대로인데 현재 곡만 바뀌는 경로(이전곡)가 있다.
   *
   * 캐시 키가 아니라 URL을 쓴다. 키는 스포티파이 트랙에서 받는 도중에 정해지므로, 키로 지문을
   * 만들면 곡을 하나 받을 때마다 대기열이 바뀐 것처럼 보여 루프가 매번 끊긴다. 여기서 봐야
   * 하는 것은 대기열이 바뀌었는가지 해석이 얼마나 진행됐는가가 아니다.
   */
  signature() {
    const idOf = (track) => track?.url || this.keyOf(track) || "-";
    const parts = [idOf(this.player.currentTrack)];
    for (const track of this.targets()) parts.push(idOf(track));
    return parts.join("\n");
  }

  /** 아직 받지 않았고 받는 중도 아닌 첫 목표. 없으면 null. */
  nextTarget() {
    for (const track of this.targets()) {
      if (this.isCached(track) || this.isBusy(track) || this._failed.has(track)) continue;
      return track;
    }
    return null;
  }

  async _run() {
    if (this._running) return; // 루프는 언제나 하나
    this._running = true;
    try {
      for (;;) {
        if (this._stopped) return;
        // 도중에 대기열이 흔들렸으면 멈춘다. 다음 안정된 틱이 새 목표로 다시 깨운다.
        if (this.signature() !== this._applied) return;

        const track = this.nextTarget();
        if (!track) return;

        try {
          // 예열은 조용히 도는 배경 작업이라, 이게 없으면 "왜 지금 이 곡을 받고 있나"를
          // 사후에 알 방법이 없다. 다운로드 완료는 track 카테고리가 따로 남긴다.
          log.debug(`사전 캐싱: "${track.title}" | 대상 ${this.targets().length}곡`);
          await this.warm(track);
        } catch (err) {
          // 영상이 내려간 자동재생 곡은 여기서 버린다. 그냥 두면 재생 차례에 스트림도 실패해
          // 대기열이 빈 채로 멈춘다. 우리가 고른 곡이니 사용자에게 알릴 일이 아니라
          // 조용히 빼고 다른 곡을 고르는 것이 맞다.
          if (track.autoplay && this._dropDeadAutoplay(track, err)) continue;

          // 이 서명 동안은 다시 시도하지 않는다. 대기열이 움직이면 자연히 재시도되고,
          // 끝까지 실패해도 재생 시점의 다운로드 경로가 한 번 더 받는다.
          log.warn(`사전 캐싱 실패 (${track.title}): ${require("./sources/youtube/index").briefError(err)}`);
          this._failed.add(track);
        }

        if (this.gapMs > 0) await this._sleep(this.gapMs);
      }
    } finally {
      this._running = false;
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => {
      this._sleepTimer = setTimeout(() => {
        this._sleepTimer = null;
        resolve();
      }, ms);
      if (typeof this._sleepTimer.unref === "function") this._sleepTimer.unref();
    });
  }
}

module.exports = QueueWarmer;
