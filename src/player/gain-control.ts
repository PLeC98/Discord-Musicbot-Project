// 볼륨 정규화의 게인 조절기. 플레이어마다 하나. 곡을 한 번 트는 동안의 재생 상태(근거, 목표 게인, 보낸 게인)와
// 파이프라인별 게인 탭(media/gain-tap)을 가진다. 출력 스트림이 프레임마다 탭에 게인을 묻는다.
//
// 이어 트는 재생(위치 이동, 끊김 복구, 라이브 다시 열기)은 같은 재생 상태에 새 탭을 붙이고, 새 재생(다른 곡, 한 곡 반복의 다음 회차)은
// 새 재생 상태를 만든다. 확정은 소리를 바꾸기 직전(commitPlaying)이고, 그 전의 새 탭은 기존 재생 상태를 건드리지 않는다.
// 램프 시간은 보낸 프레임 수로 잰다. 일시정지 중에는 프레임을 묻지 않으므로 램프도 멈춘다.

import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/error-kind.ts";
import * as loudness from "../store/loudness.ts";
import * as audioCache from "../store/audio-cache.ts";
import type { GainTap, PathFacts, TapFrame } from "../media/gain-tap.ts";
const log = logger.child({ category: "player", sub: "gain" });

/** 목표 음량(LUFS) */
const TARGET = -14;
/** 증폭 상한(dB). 캐시 파일 측정값, 끝까지 재생하며 측정한 값에 쓴다 */
const FILE_BOOST = 12;
const HEARD_BOOST = 6;
/** 증폭할 때 프레임 피크 상위 1% 가 이 값을 넘지 않게 제한한다(dBTP, 리미터의 상한) */
const CEILING = -1.5;
/** 재생 중 측정한 값은 샘플 피크라 이만큼 더해 쓴다(dB) */
const HEARD_PEAK_MARGIN = 0.5;
/** 이보다 낮은 음량 측정값은 쓰지 않는다(LUFS) */
const QUIET = -50;
const FRAMES_PER_SEC = 50;
/** 보낸 게인이 목표를 따라갈 때 프레임당 최대 변화량(dB). 감소 초당 20, 증가 초당 3 */
const STEP_DOWN = 20 / FRAMES_PER_SEC;
const STEP_UP = 3 / FRAMES_PER_SEC;
/** 근거가 바뀌거나 정규화를 켜고 끌 때 감소에 걸리는 시간(초). 증가는 STEP_UP 속도다 */
const MOVE_DOWN_SEC = 1;
const SETTLED = 1e-6;

type Mode = "off" | "fixed" | "zero";

/** 측정값으로 구한 고정 게인(dB). 쓸 수 없는 값이면 null */
function fixedGainOf(row: loudness.Row): number | null {
  if (!Number.isFinite(row.integrated) || row.integrated < QUIET) return null;
  const need = TARGET - row.integrated;
  if (need <= 0) return need;
  const file = row.kind === "file";
  const peak = row.peakP99 + (file ? 0 : HEARD_PEAK_MARGIN);
  // max(0, ...): 피크가 이미 상한 위인 조용한 곡을 줄이지 않는다
  return Math.min(need, file ? FILE_BOOST : HEARD_BOOST, Math.max(0, CEILING - peak));
}

/** 곡을 한 번 트는 동안의 재생 상태. 이어 트는 재생은 같은 상태를 쓴다 */
class PlaybackState {
  key: string | null;
  cacheFile: string | null;
  mode: Mode = "off";
  fixed = 0;
  /** 마지막 프레임에 실은 정규화 게인(dB) */
  sent = 0;
  /** 전환 중의 프레임당 최대 변화량. 없으면 평소 값 */
  move: { down: number; up: number } | null = null;
  wasOn: boolean;
  ended = false;
  readonly control: GainControl;

  constructor(control: GainControl, { key, cacheFile }: { key: string | null; cacheFile: string | null }) {
    this.control = control;
    this.key = key;
    this.cacheFile = cacheFile;
    this.wasOn = control.isOn();
  }

  /** 근거를 골라 목표를 정한다. first: 이 상태의 첫 탭(아직 아무것도 보내지 않았다) */
  choose(first: boolean) {
    const mode: Mode = !this.control.isOn() ? "off" : this.#fixedNow() ? "fixed" : "zero";
    const was = this.mode;
    this.mode = mode;
    const target = this.target();
    if (first) {
      this.sent = target;
      this.move = null;
      return;
    }
    if (was === mode && mode !== "fixed") return;
    // 보낸 게인에서 이어 간다(목표에서 이어 가면 앞서 나간 만큼 튄다)
    const gap = target - this.sent;
    this.move = { down: gap < 0 ? -gap / (MOVE_DOWN_SEC * FRAMES_PER_SEC) : STEP_DOWN, up: STEP_UP };
  }

  target() {
    return this.mode === "fixed" ? this.fixed : 0;
  }

  /** 프레임 하나에 실을 게인과 리미터 켜짐 여부를 내고 보낸 게인을 그만큼 램프한다 */
  step(): TapFrame {
    const target = this.target();
    const limit = this.move ?? { down: STEP_DOWN, up: STEP_UP };
    const gap = target - this.sent;
    this.sent += gap < 0 ? Math.max(gap, -limit.down) : Math.min(gap, limit.up);
    if (this.move && Math.abs(target - this.sent) < SETTLED) this.move = null;
    return this.frameNow();
  }

  /** 램프하지 않고 지금 보낸 게인. 정규화를 끈 뒤에도 게인이 0 으로 다 돌아올 때까지 리미터를 켠다(먼저 끄면 증폭된 소리가 클립된다) */
  frameNow(): TapFrame {
    return { gain: this.sent, press: this.mode !== "off" || Math.abs(this.sent) > SETTLED };
  }

  /** 정규화 켜짐 여부가 바뀌었는지 확인한다(프레임마다 부르므로 설정은 메모리에서 읽는다) */
  poll() {
    const on = this.control.isOn();
    if (on === this.wasOn) return;
    this.wasOn = on;
    this.choose(false);
    if (on && this.mode === "zero") this.control.wantMeasure(this);
  }

  // 지금 캐시 파일과 같은 파일의 측정값이 있으면 그 고정 게인
  #fixedNow(): boolean {
    if (!this.key) return false;
    try {
      const file = loudness.rowsOf(this.key).file;
      const row = audioCache.lookupByAudioKey(this.key);
      if (!file || row?.status !== "cached" || row.file_size_bytes !== file.sizeBytes || row.duration_sec !== file.durationSec) return false;
      const gain = fixedGainOf(file);
      if (gain === null) return false;
      this.fixed = gain;
      loudness.touch(this.key, "file");
      return true;
    } catch (error) {
      log.warn(`음량 값 읽기 실패(정규화 게인 0 dB 로): ${this.key} | ${messageOf(error)}`);
      return false;
    }
  }
}

/** 게인 탭: 파이프라인 하나에 하나 */
class Tap implements GainTap {
  committed = false;
  closed = false;
  // 이어 트는 재생에서 확정 전까지 쓰는 새 탭이다. 기존 재생 상태가 마지막으로 보낸 게인을 그대로 준다
  readonly shared: boolean;
  // 다음 탭이 확정된 뒤의 이전 탭. 마지막으로 보낸 게인으로 고정된다
  #frozen: TapFrame | null = null;
  readonly state: PlaybackState;

  constructor(state: PlaybackState, { shared }: { shared: boolean }) {
    this.state = state;
    this.shared = shared;
  }

  frame(_pos: number): TapFrame {
    if (this.#frozen) return this.#frozen;
    const state = this.state;
    if (this.shared && !this.committed) return state.frameNow();
    state.poll();
    return state.step();
  }

  metering() {
    return false;
  }

  block(_endPos: number, _momentary: number, _peak: number) {
    // 재생 중 측정은 아직 없다
  }

  close() {
    this.closed = true;
  }

  freeze() {
    this.#frozen = this.state.frameNow();
  }
}

/**
 * isOn: 이 서버의 볼륨 정규화 켜짐 여부(프레임마다 부르므로 메모리에서 읽어야 한다)
 * measure: 음원의 캐시 파일 측정을 요청한다(media/loudness-measure)
 */
class GainControl {
  readonly isOn: () => boolean;
  readonly #measure: (audioKey: string) => void;
  #current: PlaybackState | null = null;
  #currentTap: Tap | null = null;

  constructor({ isOn, measure }: { isOn: () => boolean; measure: (audioKey: string) => void }) {
    this.isOn = isOn;
    this.#measure = measure;
  }

  /**
   * 파이프라인의 탭을 연다(resourceOf 가 입력 방식을 정한 뒤 부른다). key 는 잠정이고 확정할 때 다시 본다.
   * continued: 같은 곡을 이어 튼다(위치 이동, 끊김 복구, 라이브 다시 열기 등). 곡과 키가 같으면 재생 상태를 이어 간다
   */
  openTap({ key, continued }: { key: string | null; continued: boolean }, facts: PathFacts): Tap {
    const current = this.#current;
    if (continued && current && !current.ended && current.key === key) return new Tap(current, { shared: true });
    const state = new PlaybackState(this, { key, cacheFile: facts.cacheFile });
    state.choose(true);
    return new Tap(state, { shared: false });
  }

  /** 소리를 바꾸기 직전에 부른다(commitPlaying). key: 바로잡힌 오디오 키. 이전 탭은 마지막 게인으로 고정되고, 새 곡이면 이전 재생 상태는 끝난다 */
  commit(tap: GainTap | null, key: string | null) {
    if (!(tap instanceof Tap)) return;
    if (this.#currentTap && this.#currentTap !== tap) this.#currentTap.freeze();
    if (this.#current && this.#current !== tap.state) this.#current.ended = true;
    tap.committed = true;
    this.#current = tap.state;
    this.#currentTap = tap;
    if (tap.shared) return;
    // 여는 동안 키가 바로잡혔거나 측정값이 생겼을 수 있다. 측정값이 없는 캐시 파일이면 측정을 요청한다
    tap.state.key = key;
    tap.state.choose(false);
    if (tap.state.mode === "zero") this.wantMeasure(tap.state);
  }

  /** 음원의 측정값이 준비됐을 때 부른다(캐시 파일 측정 완료, 또는 다시 받은 파일이 기존 측정값과 일치) */
  valueArrived(audioKey: string) {
    const state = this.#current;
    if (state && !state.ended && state.key === audioKey) state.choose(false);
  }

  /** 지금 곡이 끝났을 때 부른다(곡 끝, 정지, 플레이어 정리). 다음 확정 전까지 나가는 소리는 마지막 게인으로 고정된다 */
  end() {
    if (this.#current) this.#current.ended = true;
    this.#currentTap?.freeze();
    this.#current = null;
    this.#currentTap = null;
  }

  /** 정규화가 켜져 있고 재생 중인 음원이 측정값 없는 캐시 파일이면 측정을 요청한다 */
  wantMeasure(state: PlaybackState) {
    if (state.key && state.cacheFile && this.isOn()) this.#measure(state.key);
  }
}

export { GainControl, fixedGainOf, TARGET };
export type { Tap };
