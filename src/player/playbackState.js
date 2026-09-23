"use strict";

// 재생 생명주기. 두 축이다.
//   단계(phase)   idle → starting → playing, 버리면 disposed(이 플레이어를 더 안 쓴다. stop · leave · 정리)
//   끝 처리(ending)  곡 끝을 처리하는 중인가. 끝 처리가 다음 곡을 틀기 때문에 단계와 따로 선다(끝 처리 중에 starting · playing 이 된다)
// 전이마다 한 줄 남긴다. 허용되지 않은 전이는 경고로 드러내고 그대로 따른다(재생을 멈추면 안 된다).

const log = require("../infra/log/logger").child({ category: "watchdog" });

const NEXT = {
  idle: ["starting", "disposed"],
  starting: ["playing", "idle", "disposed"],
  playing: ["idle", "starting", "disposed"],
  disposed: [],
};

class PlaybackState {
  // label: 로그에 붙일 곡 이름
  constructor(label = () => "") {
    this.phase = "idle";
    this.ending = false;
    this.label = label;
  }

  to(next, why = "") {
    const prev = this.phase;
    if (prev === next) return;
    const tail = `${why ? ` | ${why}` : ""}${this.label() ? ` | ${this.label()}` : ""}`;
    if (NEXT[prev]?.includes(next)) log.debug(`재생 단계: ${prev} → ${next}${tail}`);
    else log.warn(`예상하지 못한 재생 단계 전이: ${prev} → ${next}${tail}`);
    this.phase = next;
  }

  get starting() {
    return this.phase === "starting";
  }

  /** 끝 처리를 시작한다. 이미 처리 중이면 false(겹쳐 들어온 끝은 버린다) */
  beginEnd() {
    if (this.ending) return false;
    this.ending = true;
    return true;
  }

  finishEnd() {
    this.ending = false;
  }
}

module.exports = PlaybackState;
