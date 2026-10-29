// 멈춤 상태. 사람의 뜻(userPaused)과 지금 음성 상태에서 계산한 억제 사유(holds)를 따로 들고, 소리는 둘 중 하나라도 있으면 멈춘다.
// 오디오를 멈추고 푸는 곳은 여기(apply) 하나다. 값이 바뀌면 플레이어가 준 콜백 하나로 알린다(로그 · 저장 알림 · 패널 갱신은 플레이어가 잇는다).

import { AudioPlayerStatus, type AudioPlayer } from "@discordjs/voice";
import { heldBy, type Hold } from "../rules/holds.ts";

/** 무엇이 바뀌었나. user 는 사람의 뜻이 바뀌었을 때만 있다 */
type PauseChange = { user?: boolean; added: Hold[]; removed: Hold[] };

class PauseState {
  #user = false;
  #holds = new Set<Hold>();
  #audio: () => Pick<AudioPlayer, "state" | "pause" | "unpause">;
  #changed: (change: PauseChange) => void;

  constructor(audio: () => Pick<AudioPlayer, "state" | "pause" | "unpause">, changed: (change: PauseChange) => void) {
    this.#audio = audio;
    this.#changed = changed;
  }

  /** 사람이 멈춰 뒀나(저장된다) */
  get userPaused() {
    return this.#user;
  }

  /** 지금 걸린 억제 사유(저장하지 않는다) */
  get holds(): ReadonlySet<Hold> {
    return this.#holds;
  }

  /** 보여 줄 억제 사유. 없으면 null */
  get heldBy() {
    return heldBy(this.#holds);
  }

  /** 소리가 멈춰 있어야 하나 */
  get silent() {
    return this.#user || this.#holds.size > 0;
  }

  /** 사람의 뜻을 정한다 */
  setUser(on: boolean) {
    const was = this.#user;
    this.#user = on;
    this.apply();
    if (was !== on) this.#changed({ user: on, added: [], removed: [] });
  }

  /** 억제 사유를 통째로 맞춘다. 더해진 것 · 빠진 것을 돌려준다 */
  setHolds(next: Iterable<Hold>) {
    const want = new Set(next);
    const added = [...want].filter((one) => !this.#holds.has(one));
    const removed = [...this.#holds].filter((one) => !want.has(one));
    this.#holds = want;
    this.apply();
    if (added.length || removed.length) this.#changed({ added, removed });
    return { added, removed };
  }

  /**
   * 오디오를 지금 값에 맞춘다. 값이 그대로여도 부른다(어긋난 오디오를 바로잡는다).
   * pause() 는 재생 중일 때만, unpause() 는 멈춘 상태일 때만 먹는다. 버퍼링 · 곡 없음 · AutoPaused 는 재생으로 넘어오는 순간 플레이어의 Playing 리스너가 다시 부른다
   */
  apply() {
    const audio = this.#audio();
    const status = audio.state.status;
    if (this.silent && status === AudioPlayerStatus.Playing) audio.pause();
    else if (!this.silent && status === AudioPlayerStatus.Paused) audio.unpause();
  }

  /** 버린다. 알리지 않는다 */
  reset() {
    this.#user = false;
    this.#holds = new Set();
  }
}

export { PauseState };
export type { PauseChange };
