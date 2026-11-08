// 재생 생명주기. 두 축이다.
//   단계(phase)   idle → starting → playing, 버리면 disposed(이 플레이어를 더 안 쓴다. stop, leave, 정리)
//                 parked: 실패로 그 곡에서 일시정지해 둠. 지금 곡은 있고 열린 소리는 없다. ▶(starting), 끝 처리(idle), 버리기로 나온다
//                 resting: 스트림 휴면. 장시간 일시정지한 곡의 스트림을 해제해 둠. 곡, 위치는 있고 열린 소리는 없다. 일시정지가 풀리면 저절로 다시 연다(starting)
//   끝 처리(ending)  곡 끝을 처리하는 중인가. 끝 처리가 다음 곡을 틀기 때문에 단계와 따로 선다(끝 처리 중에 starting, playing 이 된다)
// 전이마다 한 줄 남긴다. 허용되지 않은 전이는 경고로 드러내고 그대로 따른다(재생을 멈추면 안 된다).

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "watchdog" });

type Phase = "idle" | "starting" | "playing" | "parked" | "resting" | "disposed";

const NEXT: Record<Phase, Phase[]> = {
  idle: ["starting", "parked", "disposed"],
  starting: ["playing", "idle", "parked", "disposed"],
  playing: ["idle", "starting", "parked", "resting", "disposed"],
  parked: ["starting", "idle", "disposed"],
  resting: ["starting", "idle", "disposed"],
  disposed: [],
};

class PlaybackState {
  phase: Phase;
  ending: boolean;
  label: () => string;

  // label: 로그에 붙일 곡 이름
  constructor(label: () => string = () => "") {
    this.phase = "idle";
    this.ending = false;
    this.label = label;
  }

  to(next: Phase, why = "") {
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

  /** 실패로 그 곡에서 일시정지해 뒀다(player.park) */
  get parked() {
    return this.phase === "parked";
  }

  /** 스트림 휴면 중이다(player.rest) */
  get resting() {
    return this.phase === "resting";
  }

  /** 곡은 있고 열린 소리가 없는 것이 맞다(실패로 일시정지해 둠, 스트림 휴면). 이때의 Idle 은 곡 끝이 아니다 */
  get released() {
    return this.phase === "parked" || this.phase === "resting";
  }

  /** 버려졌다. 늦게 깨어난 타이머, 두 번째 정리는 이걸 보고 아무것도 하지 않는다 */
  get disposed() {
    return this.phase === "disposed";
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

export type { Phase };
export { PlaybackState };
