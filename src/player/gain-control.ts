// 볼륨 정규화의 게인 조절기. 플레이어마다 하나. 곡을 한 번 트는 동안의 재생 상태(근거, 목표 게인, 보낸 게인, 추종, 재생 중 측정값)와
// 파이프라인별 게인 탭(media/gain-tap)을 가진다. 출력 스트림이 프레임마다 탭에 게인을 묻고, 측정 단계가 블록마다 탭에 순간 음량을 넘긴다.
//
// 근거: 캐시 파일 측정값(고정 게인), 끝까지 재생하며 측정한 값(고정 게인), 그 밖에는 재생 중 측정으로 느리게 따라간다(player/loudness-follower).
// 이어 트는 재생(위치 이동, 끊김 복구, 라이브 다시 열기)은 같은 재생 상태에 새 탭을 붙이고, 새 재생(다른 곡, 한 곡 반복의 다음 회차)은
// 새 재생 상태를 만든다. 확정은 소리를 바꾸기 직전(commitPlaying)이고, 그 전의 새 탭은 기존 재생 상태를 건드리지 않는다.
// 램프 시간은 보낸 프레임 수로 잰다. 일시정지 중에는 프레임을 묻지 않으므로 램프도 멈춘다.

import logger from "../infra/log/logger.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import * as loudness from "../store/loudness.ts";
import * as audioCache from "../store/audio-cache.ts";
import { LoudnessFollower, type FollowerStart } from "./loudness-follower.ts";
import type { GainTap, PathFacts, TapFrame } from "../media/gain-tap.ts";
import type { EndFacts } from "../rules/end-verdict.ts";
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
const FS = 48_000;
/** 보낸 게인이 목표를 따라갈 때 프레임당 최대 변화량(dB). 감소 초당 20, 증가 초당 3 */
const STEP_DOWN = 20 / FRAMES_PER_SEC;
const STEP_UP = 3 / FRAMES_PER_SEC;
/** 근거가 바뀌거나 정규화를 켜고 끌 때 감소에 걸리는 시간(초). 증가는 STEP_UP 속도다 */
const MOVE_DOWN_SEC = 1;
const SETTLED = 1e-6;
/** 추종 값을 프레임의 시작 위치 + 이만큼(샘플)에서 읽는다(측정이 소리보다 앞서 본 만큼) */
const LOOK_SAMPLES = FS;
/** 측정값이 곧 올 곡을 음악으로 가정한 음량(LUFS). file 값이 MEDIAN_MIN 개 이상 쌓이면 그 중앙값을 쓴다(store/loudness) */
const MUSIC_PRIOR = -8;
/** 이 길이(초)를 넘거나 길이를 모르는 곡은 음악으로 가정하지 않고 0 dB 에서 시작한다(긴 것은 측정값이 늦게 오고 발매 음원일 가능성이 낮다) */
const PRIOR_MAX_SEC = 600;
/** 들은 양이 이만큼(초)을 넘을 때만 저장한다(조용한 도입부에 속은 값이 다음 재생을 망치지 않게) */
const SAVE_MIN_SEC = 30;
/** 끝까지 재생하며 측정한 값의 길이 대조 허용 폭(초). 길이 어긋남을 로그로 남기는 기준과 같다 */
const LENGTH_TOL_SEC = 2;
/** 라이브는 이 블록 수(1블록 = 100ms)마다 지금까지 측정한 값을 저장한다(봇이 꺼져도 남게) */
const CHECKPOINT_BLOCKS = 3000;

type Mode = "off" | "fixed" | "follow";

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

const pw = (l: number) => 10 ** ((l + 0.691) / 10);
const lk = (z: number) => -0.691 + 10 * Math.log10(z);

/** 저장할 재생 중 측정값. 추종이 모은 블록과 따로, 그 재생에서 들은 것 전부를 모은다(추종은 시작 광고를 빼기도 한다) */
class Heard {
  // 순간 음량 -70 ~ +20 LUFS(0.01 단위), 샘플 피크 -60 ~ +12 dB(0.1 단위)
  readonly #bins = new Float64Array(9001);
  readonly #peaks = new Float64Array(721);
  #sum = 0;
  #count = 0;
  #peakCount = 0;
  #max = -120;
  /** 받은 블록 수(무음 포함). 길이 대조에 쓴다 */
  blocks = 0;

  add(momentary: number, peak: number) {
    this.blocks++;
    if (!(momentary > -70)) return;
    this.#bins[Math.min(9000, Math.max(0, Math.round((momentary + 70) * 100)))]++;
    this.#sum += pw(momentary);
    this.#count++;
    if (!Number.isFinite(peak)) return;
    this.#peaks[Math.min(720, Math.max(0, Math.round((peak + 60) * 10)))]++;
    this.#peakCount++;
    this.#max = Math.max(this.#max, peak);
  }

  /** 게이트 통합 음량, 샘플 피크, 프레임 피크 상위 1%, 들은 양(초). 게이트를 넘은 블록이 없으면 null */
  value(): (loudness.Measured & { heardSec: number }) | null {
    if (!this.#count) return null;
    const rel = lk(this.#sum / this.#count) - 10;
    let n = 0;
    let s = 0;
    for (let i = Math.max(0, Math.ceil((rel + 70) * 100)); i <= 9000; i++) {
      const c = this.#bins[i] as number;
      if (c) {
        n += c;
        s += c * pw(-70 + i / 100);
      }
    }
    let need = this.#peakCount * 0.01;
    let k = 720;
    for (; k > 0; k--) {
      need -= this.#peaks[k] as number;
      if (need < 0) break;
    }
    return n ? { integrated: lk(s / n), truePeak: this.#max, peakP99: -60 + k / 10, heardSec: this.#count / 10 } : null;
  }
}

/**
 * 탭을 열 때 플레이어가 아는 것. key 는 잠정이다. startMs: 곡 안의 시작 위치, lengthSec: 음악 가정의 10분 기준에 쓰는 길이(캐시 행의 길이, 출처의 길이),
 * downloadMatches: 재생과 함께 받는 캐시 다운로드의 음원이 이 재생의 음원과 같다
 */
type TapInfo = { key: string | null; continued: boolean; startMs: number; lengthSec: number | null; downloadMatches: boolean };

/** 저장된 지난 값에서 시작한다. 증폭 한도도 지난 값의 것을 쓴다(이번 재생에서 모은 블록으로 한도를 계산할 때까지) */
function storedStart(row: loudness.Row): FollowerStart {
  const margin = row.kind === "file" ? 0 : HEARD_PEAK_MARGIN;
  return { prior: row.integrated, startGain: TARGET - row.integrated, startCap: Math.max(0, CEILING - row.peakP99 - margin) };
}

/** 끝 판정에 넘긴 정보 가운데 저장 조건이 보는 것 */
type EndView = Pick<EndFacts, "reason" | "live" | "streamEnded" | "broken" | "lengthMs">;

/** 곡을 한 번 트는 동안의 재생 상태. 이어 트는 재생은 같은 상태를 쓴다 */
class PlaybackState {
  key: string | null;
  readonly facts: PathFacts;
  readonly info: TapInfo;
  mode: Mode = "off";
  fixed = 0;
  follower: LoudnessFollower | null = null;
  readonly heard = new Heard();
  /** 마지막 프레임에 실은 정규화 게인(dB) */
  sent = 0;
  /** 전환 중의 프레임당 최대 변화량. 없으면 평소 값 */
  move: { down: number; up: number } | null = null;
  wasOn: boolean;
  /** 붙은 탭 수. 이어 튼 재생이 있었으면 끝까지 재생하며 측정한 값이 될 수 없다 */
  pipelines = 1;
  /** 0초부터 측정했고 끊긴 적이 없다 */
  meteredFromStart = false;
  ended = false;
  readonly control: GainControl;

  constructor(control: GainControl, info: TapInfo, facts: PathFacts) {
    this.control = control;
    this.key = info.key;
    this.info = info;
    this.facts = facts;
    this.wasOn = control.isOn();
  }

  /** 근거를 골라 목표를 정한다. first: 이 상태의 첫 탭(아직 아무것도 보내지 않았다), midPlay: 재생 중에 정규화를 켰다 */
  choose(first: boolean, midPlay = false) {
    const fixed = this.control.isOn() ? this.#fixedNow() : null;
    const mode: Mode = !this.control.isOn() ? "off" : fixed !== null ? "fixed" : "follow";
    if (fixed !== null) this.fixed = fixed;
    if (mode === "follow" && !this.follower) this.follower = new LoudnessFollower(midPlay ? {} : this.#startOf());
    const was = this.mode;
    this.mode = mode;
    const target = this.target();
    if (first) {
      this.sent = target;
      this.move = null;
      this.meteredFromStart = mode === "follow" && this.info.startMs === 0;
      return;
    }
    if (was === mode && mode !== "fixed") return;
    // 보낸 게인에서 이어 간다(목표에서 이어 가면 측정이 앞서 본 만큼 튄다)
    const gap = target - this.sent;
    this.move = { down: gap < 0 ? -gap / (MOVE_DOWN_SEC * FRAMES_PER_SEC) : STEP_DOWN, up: STEP_UP };
  }

  /** 추종 중이면 그 탭의 추종 게인 기록에서 읽은 값을 넘긴다 */
  target(follow: number | null = null) {
    if (this.mode === "fixed") return this.fixed;
    if (this.mode === "follow") return follow ?? this.follower?.gain ?? 0;
    return 0;
  }

  /** 프레임 하나에 실을 게인과 리미터 켜짐 여부를 내고 보낸 게인을 그만큼 램프한다 */
  step(target: number): TapFrame {
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

  /** 정규화 켜짐 여부가 바뀌었는지 확인한다(프레임마다 부르므로 설정은 메모리에서 읽는다). 바뀌면 0초부터 끊김 없이 측정한 것이 아니다 */
  poll() {
    const on = this.control.isOn();
    if (on === this.wasOn) return;
    this.wasOn = on;
    this.meteredFromStart = false;
    this.choose(false, true);
    if (on && this.mode === "follow") this.control.wantMeasure(this);
  }

  /** 측정 단계의 블록 하나(확정된 탭). 돌려주는 값은 그 뒤의 추종 게인 */
  block(momentary: number, peak: number): number {
    this.heard.add(momentary, peak);
    if (this.facts.live && this.heard.blocks % CHECKPOINT_BLOCKS === 0) this.save(false);
    return (this.follower as LoudnessFollower).push(momentary, peak);
  }

  /** 재생 중 측정값을 저장한다. full: 끝까지 재생하며 측정한 값이 될 조건을 모두 갖췄다 */
  save(full: boolean) {
    const value = this.heard.value();
    if (!this.key || !value || value.heardSec <= SAVE_MIN_SEC) return;
    const { heardSec, ...measured } = value;
    const identity = { sizeBytes: this.facts.sizeBytes, durationSec: this.info.lengthSec, audioVersion: null };
    try {
      loudness.recordHeard(this.key, full ? "heard-full" : "heard-part", { value: measured, identity, heardSec });
    } catch (error) {
      // 종료 중에 DB 가 닫힌 뒤의 저장은 버린다
      if (codeOf(error) !== "DB_NOT_OPEN") log.warn(`재생 중 측정값 저장 실패: ${this.key} | ${messageOf(error)}`);
    }
  }

  // 고정 게인을 쓸 수 있는 측정값이 있으면 그 게인
  #fixedNow(): number | null {
    if (!this.key) return null;
    try {
      const rows = loudness.rowsOf(this.key);
      const cached = audioCache.lookupByAudioKey(this.key);
      const file = rows.file;
      // 지금 캐시 파일과 같은 파일을 잰 값
      const fileGain = file && cached?.status === "cached" && cached.file_size_bytes === file.sizeBytes && cached.duration_sec === file.durationSec ? fixedGainOf(file) : null;
      if (fileGain !== null) {
        loudness.touch(this.key, "file");
        return fileGain;
      }
      const full = rows["heard-full"];
      const fullGain = full && this.#sameSource(full) ? fixedGainOf(full) : null;
      if (fullGain !== null) loudness.touch(this.key, "heard-full");
      return fullGain;
    } catch (error) {
      log.warn(`음량 값 읽기 실패(정규화 게인 0 dB 에서 추종): ${this.key} | ${messageOf(error)}`);
      return null;
    }
  }

  // 끝까지 재생하며 측정한 값이 지금 소리를 잰 것인지: 길이(허용 폭 안)와 출처가 알려 준 크기가 모두 일치한다
  #sameSource(row: loudness.Row) {
    const length = this.info.lengthSec;
    return length !== null && row.durationSec !== null && Math.abs(row.durationSec - length) <= LENGTH_TOL_SEC && row.sizeBytes !== null && row.sizeBytes === this.facts.sizeBytes;
  }

  // 추종의 시작값: 저장된 지난 값, 측정값이 곧 올 10분 이하의 곡은 음악으로 가정한 음량, 그 밖에는 0 dB
  #startOf(): FollowerStart {
    const key = this.key;
    try {
      const stored = key ? this.#storedOf(loudness.rowsOf(key)) : null;
      if (key && stored) {
        loudness.touch(key, stored.kind);
        return storedStart(stored);
      }
      const length = this.info.lengthSec;
      const valueSoon = this.facts.kind === "file" || (this.facts.downloading && this.info.downloadMatches);
      if (valueSoon && length !== null && length <= PRIOR_MAX_SEC) return { prior: loudness.fileMedian() ?? MUSIC_PRIOR };
    } catch (error) {
      log.warn(`음량 값 읽기 실패(0 dB 에서 추종): ${String(key)} | ${messageOf(error)}`);
    }
    return {};
  }

  // 시작값으로 쓸 저장된 값. 캐시 파일이 정리된 곡의 file 값은 길이가 맞을 때만 쓴다(파일을 보기 전에는 길이로만 같은 소리인지 안다)
  #storedOf(rows: loudness.Rows): loudness.Row | null {
    const length = this.info.lengthSec;
    const file = rows.file && length !== null && rows.file.durationSec !== null && Math.abs(rows.file.durationSec - length) <= LENGTH_TOL_SEC ? rows.file : null;
    const stored = rows["heard-full"] ?? rows["heard-part"] ?? file;
    return stored && Number.isFinite(stored.integrated) && stored.integrated >= QUIET ? stored : null;
  }

  /** 끝까지 재생하며 측정한 값이 될 조건을 모두 갖췄는지 판정한다. facts: 끝 판정에 넘긴 정보(없으면 끝 판정 없이 끝난 경우) */
  fullAfter(facts: EndView | null): boolean {
    if (!facts || facts.reason !== "idle" || facts.live || !facts.streamEnded || facts.broken) return false;
    if (this.facts.live || this.info.startMs !== 0 || this.pipelines !== 1 || !this.meteredFromStart) return false;
    const length = facts.lengthMs ? facts.lengthMs / 1000 : null;
    return length !== null && Math.abs(this.heard.blocks / 10 - length) <= LENGTH_TOL_SEC && this.facts.sizeBytes !== null && this.info.lengthSec !== null;
  }
}

/** 게인 탭: 파이프라인 하나에 하나 */
class Tap implements GainTap {
  committed = false;
  closed = false;
  // 이어 트는 재생에서 확정 전까지 쓰는 새 탭이다. 기존 재생 상태가 마지막으로 보낸 게인을 그대로 주고, 블록은 확정할 때 넣는다
  readonly shared: boolean;
  readonly state: PlaybackState;
  readonly #queue: Array<[number, number, number]> = [];
  // 블록이 끝난 위치와 그 뒤의 추종 게인. 프레임의 시작 위치 + LOOK_SAMPLES 에서 선형 보간해 읽는다
  readonly #trace: Array<[number, number]> = [];
  // 다음 탭이 확정된 뒤의 이전 탭. 마지막으로 보낸 게인으로 고정된다
  #frozen: TapFrame | null = null;

  constructor(state: PlaybackState, { shared }: { shared: boolean }) {
    this.state = state;
    this.shared = shared;
  }

  frame(pos: number): TapFrame {
    if (this.#frozen) return this.#frozen;
    const state = this.state;
    if (this.shared && !this.committed) return state.frameNow();
    state.poll();
    const follow = state.mode === "follow" ? (this.#traceAt(pos + LOOK_SAMPLES) ?? state.sent) : null;
    return state.step(state.target(follow));
  }

  metering() {
    return !this.closed && !this.#frozen && !this.state.ended && this.state.mode === "follow";
  }

  block(endPos: number, momentary: number, peak: number) {
    if (!this.metering()) return;
    if (this.shared && !this.committed) {
      this.#queue.push([endPos, momentary, peak]);
      return;
    }
    this.#trace.push([endPos, this.state.block(momentary, peak)]);
  }

  close() {
    this.closed = true;
  }

  freeze() {
    this.#frozen = this.state.frameNow();
  }

  /** 쌓아 둔 블록을 확정할 때 넣는다 */
  flush() {
    for (const [endPos, momentary, peak] of this.#queue.splice(0)) if (this.state.mode === "follow") this.#trace.push([endPos, this.state.block(momentary, peak)]);
  }

  // 블록이 몰려 와도 프레임마다 게인이 고르게 바뀌도록, 블록이 끝난 위치의 값 사이를 선형 보간해 읽는다. 아직 거기까지 본 블록이 없으면 마지막 값
  #traceAt(pos: number): number | null {
    const t = this.#trace;
    while (t.length > 2 && (t[1] as [number, number])[0] <= pos) t.shift();
    const a = t[0];
    if (!a) return null;
    const b = t[1];
    if (!b || pos <= a[0]) return a[1];
    if (pos >= b[0]) return b[1];
    return a[1] + ((b[1] - a[1]) * (pos - a[0])) / (b[0] - a[0]);
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

  /** 파이프라인의 탭을 연다(resourceOf 가 입력 방식을 정한 뒤 부른다). 이어 트는 재생이고 곡과 키가 같으면 재생 상태를 이어 간다 */
  openTap(info: TapInfo, facts: PathFacts): Tap {
    const current = this.#current;
    if (info.continued && current && !current.ended && current.key === info.key) {
      current.pipelines++;
      current.meteredFromStart = false;
      return new Tap(current, { shared: true });
    }
    const state = new PlaybackState(this, info, facts);
    state.choose(true);
    return new Tap(state, { shared: false });
  }

  /** 소리를 바꾸기 직전에 부른다(commitPlaying). key: 최종 오디오 키. 이전 탭은 마지막 게인으로 고정되고, 새 곡이면 이전 재생 상태는 저장하고 끝난다 */
  commit(tap: GainTap | null, key: string | null) {
    if (!(tap instanceof Tap)) return;
    if (this.#currentTap && this.#currentTap !== tap) this.#currentTap.freeze();
    if (this.#current && this.#current !== tap.state) this.#finish(this.#current, null);
    tap.committed = true;
    this.#current = tap.state;
    this.#currentTap = tap;
    if (tap.shared) {
      tap.flush();
      return;
    }
    // 여는 동안 키가 바뀌었거나 측정값이 생겼을 수 있다. 들은 것은 같은 소리라 재생 중 측정값은 그대로 둔다
    tap.state.key = key;
    tap.state.choose(false);
    if (tap.state.mode === "follow") this.wantMeasure(tap.state);
  }

  /** 음원의 측정값이 준비됐을 때 부른다(캐시 파일 측정 완료, 또는 다시 받은 파일이 기존 측정값과 일치) */
  valueArrived(audioKey: string) {
    const state = this.#current;
    if (state && !state.ended && state.key === audioKey) state.choose(false);
  }

  /** 곡 끝 판정을 받은 뒤 부른다(끊겨 다시 연 곡은 아직 끝나지 않았다). 끝까지 재생하며 측정한 값이 될 수 있는지 보고 저장한다 */
  finish(facts: EndView) {
    if (this.#current) this.#finish(this.#current, facts);
  }

  /** 지금 곡이 끝났을 때 부른다(정지, 플레이어 정리). 저장하고, 다음 확정 전까지 나가는 소리는 마지막 게인으로 고정된다 */
  end() {
    if (this.#current) this.#finish(this.#current, null);
    this.#currentTap?.freeze();
    this.#current = null;
    this.#currentTap = null;
  }

  /** 봇을 끌 때: 지금 곡의 재생 중 측정값을 저장해 둔다(곡은 끝나지 않았다) */
  checkpoint() {
    const state = this.#current;
    if (state && !state.ended) state.save(false);
  }

  /** 정규화가 켜져 있고 재생 중인 음원이 측정값 없는 캐시 파일이면 측정을 요청한다 */
  wantMeasure(state: PlaybackState) {
    if (state.key && state.facts.cacheFile && this.isOn()) this.#measure(state.key);
  }

  // 저장하고 끝낸다. facts 가 없으면 끝 판정을 받지 못한 끝이다(정지, 넘김)
  #finish(state: PlaybackState, facts: EndView | null) {
    if (state.ended) return;
    state.ended = true;
    // 고정 게인으로 튼 곡은 측정하지 않았다
    if (state.mode === "fixed" || !state.follower) return;
    state.save(state.fullAfter(facts));
  }
}

export { GainControl, fixedGainOf, TARGET };
export type { Tap, TapInfo };
