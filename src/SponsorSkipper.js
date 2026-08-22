"use strict";

const { AudioPlayerStatus } = require("@discordjs/voice");

// SponsorSkipper — 재생 중 SponsorBlock 구간을 자동 스킵.
//
// 핵심: "구간 시작 경계를 자연 재생으로 넘어설 때만" 발동(§계획 5). prevSec→curSec 사이에
// seg.start가 들어오면 발동하고, 매 play(seek 포함)마다 prevSec를 seek 지점으로 리셋한다.
// → 사용자가 구간 안으로 직접 seek하면 seg.start > prevSec 가 거짓이 되어 자동 스킵이 안 걸림
//   (= "수동 진입 허용"을 별도 상태 없이 교차 감지만으로 처리).
//
// 구간 처리:
//  - 인트로/중간: 기존 seek 재사용(play(null, end*1000))으로 구간 끝으로 점프.
//  - 아웃트로/끝(seg.end ≈ 트랙 길이): 다음 트랙으로 진행(handleTrackEnd).

const TICK_MS = 500; // 워처 주기 (인트로 블리드 ≤ 이 값)
const END_EPSILON_SEC = 1.5; // seg.end가 트랙 끝에서 이 이내면 아웃트로로 간주

class SponsorSkipper {
  constructor(player) {
    this.player = player;
    this.segments = [];
    this._prevSec = -1;
    this._interval = null;
  }

  /**
   * 발동 판정(순수 함수, 테스트 가능). segments는 start 오름차순 가정(SponsorBlock 정규화 결과).
   * @returns {{action: 'seek'|'end'|null, toSec?: number, prevSec: number}}
   */
  static decide(segments, prevSec, curSec, durationSec, endEpsilon = END_EPSILON_SEC) {
    for (const seg of segments) {
      if (seg.start > prevSec && seg.start <= curSec) {
        if (durationSec > 0 && seg.end >= durationSec - endEpsilon) {
          return { action: "end", prevSec: seg.end };
        }
        return { action: "seek", toSec: seg.end, prevSec: seg.end };
      }
    }
    return { action: null, prevSec: curSec };
  }

  /** 재생 시작/seek 시 호출 — 이번 재생 세션의 구간·기준점 설정 후 워처 가동. */
  onPlayStart(seekMs = 0) {
    const t = this.player.currentTrack;
    this.segments = t && t.sponsor && Array.isArray(t.sponsor.skipSegments) ? t.sponsor.skipSegments : [];
    // 신규 재생(seekMs 0)은 prevSec=-1로 두어 인트로(start=0)도 넘어섬 판정되게 함.
    this._prevSec = seekMs > 0 ? seekMs / 1000 : -1;
    if (this.segments.length) this._start();
    else this.stop(); // 구간 없으면 워처 불필요
  }

  _start() {
    if (this._interval) return;
    this._interval = setInterval(() => {
      this._tick().catch(() => {});
    }, TICK_MS);
    if (this._interval.unref) this._interval.unref();
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  async _tick() {
    const p = this.player;
    if (!p.currentTrack || p.paused || !this.segments.length) return;
    // 셋업(play 진행) 중이거나 아직 실제 Playing이 아니면 발동 보류 — 비캐시 곡의 초반
    // 스킵이 셋업 중인 play()에 재진입해 재생을 깨는 것을 방지(버그 수정).
    if (p.isPlayStarting) return;
    if (p.audioPlayer?.state?.status !== AudioPlayerStatus.Playing) return;

    const curSec = p.getCurrentTime() / 1000;
    const durationSec = Number(p.currentTrack.duration) || 0;

    const d = SponsorSkipper.decide(this.segments, this._prevSec, curSec, durationSec);
    this._prevSec = d.prevSec;

    if (d.action === "end") {
      console.log(`[SponsorBlock] ${p.currentTrack?.title ?? ""} — 종료 구간 도달, 트랙 종료`);
      p.endCurrentTrackNaturally("sponsorblock"); // 오디오 정지→Idle→handleTrackEnd (루프 존중)
    } else if (d.action === "seek") {
      console.log(`[SponsorBlock] ${p.currentTrack?.title ?? ""} — 구간 건너뜀 → ${Math.round(d.toSec)}s`);
      // play()가 onPlayStart를 다시 호출해 prevSec를 seek 지점으로 재설정한다.
      p.play(null, Math.round(d.toSec * 1000)).catch(() => {});
    }
  }
}

module.exports = SponsorSkipper;
