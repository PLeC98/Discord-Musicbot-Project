// 재생 중 측정 단계. PCM(f32le 48kHz 스테레오)과 출력 스트림 사이에 두는 Transform. 지나가는 소리로 BS.1770 순간 음량(400ms 블록, 100ms 간격)과
// 그 100ms 의 샘플 피크를 재서 게인 탭(media/gain-tap)에 넘긴다. 청크는 손대지 않고 그대로 넘긴다.
// 탭이 측정하라고 할 때만 재고, 측정하지 않을 때도 지나간 위치(채널당 샘플 수)는 센다. 측정을 다시 켜면 필터와 채우던 블록은 새로 시작한다.
// 읽는 쪽 버퍼를 크게 두면 측정이 소리보다 그만큼 앞선다(룩어헤드). 입력이 재생보다 빨리 들어올 때만이고 일부러 기다리지 않는다.

import { Transform, type TransformCallback } from "node:stream";
import type { GainTap } from "./gain-tap.ts";

const FS = 48_000;
const HOP = FS / 10;
/** 이 크기 밖의 샘플은 깨진 값으로 보고 0 으로 둔다(+36 dBFS). 필터에 NaN 이 한 번 들어가면 그 뒤 블록이 전부 무음으로 나온다 */
const BROKEN = 64;
/** 이보다 작은 필터 상태는 0 으로 바꾼다. 무음에서 상태가 0 이 되지 못하고 아주 작은 수(denormal)에 걸리면 연산이 10배 넘게 느려진다 */
const DENORMAL = 1e-25;
const FRAME_BYTES = 8;
/** 룩어헤드: 재생 중 측정이 돌 때 읽는 쪽 버퍼(1초), 아닐 때(0.1초). 바이트 단위다(f32le) */
const AHEAD_BYTES = FS * FRAME_BYTES;
const IDLE_BYTES = AHEAD_BYTES / 10;

// BS.1770 K 가중(48kHz 계수): 고역 셸프, RLB 고역 통과
const B1 = [1.53512485958697, -2.69169618940638, 1.19839281085285] as const;
const A1 = [-1.69065929318241, 0.73248077421585] as const;
const B2 = [1.0, -2.0, 1.0] as const;
const A2 = [-1.99004745483398, 0.99007225036621] as const;

/** 블록 하나를 받는 곳. endPos: 그 블록이 끝난 위치(채널당 샘플 수), momentary: 순간 음량(LUFS), peak: 그 100ms 의 샘플 피크(dBFS) */
type OnBlock = (endPos: number, momentary: number, peak: number) => void;

/** 인터리브 스테레오 샘플을 받아 100ms 마다 블록을 내는 계측기. 처음 400ms 가 차기 전에는 블록을 내지 않는다 */
class BlockMeter {
  // 채널 2 x (단 2 x 상태 2), 전치 직접형 II
  readonly #z = new Float64Array(8);
  #acc = 0;
  #n = 0;
  #peak = 0;
  readonly #parts = [0, 0, 0, 0];
  #filled = 0;
  readonly #onBlock: OnBlock;

  constructor(onBlock: OnBlock) {
    this.#onBlock = onBlock;
  }

  /** startPos: samples 의 첫 샘플의 위치(채널당) */
  push(samples: Float32Array, startPos: number) {
    for (let i = 0; i < samples.length; i += 2) {
      const a = clean(samples[i] as number);
      const b = clean(samples[i + 1] as number);
      const l = this.#weigh(a, 0);
      const r = this.#weigh(b, 4);
      this.#acc += l * l + r * r;
      this.#peak = Math.max(this.#peak, Math.abs(a), Math.abs(b));
      if (++this.#n === HOP) this.#hop(startPos + i / 2 + 1);
    }
  }

  #weigh(x: number, o: number) {
    const z = this.#z;
    const y = B1[0] * x + (z[o] as number);
    z[o] = B1[1] * x - A1[0] * y + (z[o + 1] as number);
    z[o + 1] = B1[2] * x - A1[1] * y;
    const y2 = B2[0] * y + (z[o + 2] as number);
    z[o + 2] = B2[1] * y - A2[0] * y2 + (z[o + 3] as number);
    z[o + 3] = B2[2] * y - A2[1] * y2;
    return y2;
  }

  #hop(endPos: number) {
    const z = this.#z;
    for (let k = 0; k < z.length; k++) if ((z[k] as number) < DENORMAL && (z[k] as number) > -DENORMAL) z[k] = 0;
    this.#parts.shift();
    this.#parts.push(this.#acc);
    const peak = this.#peak;
    this.#acc = 0;
    this.#n = 0;
    this.#peak = 0;
    if (++this.#filled < 4) return;
    const mean = this.#parts.reduce((s, v) => s + v, 0) / (4 * HOP);
    this.#onBlock(endPos, mean > 0 ? -0.691 + 10 * Math.log10(mean) : -120, peak > 0 ? 20 * Math.log10(peak) : -120);
  }
}

const clean = (v: number) => (v > -BROKEN && v < BROKEN ? v : 0);

/** 측정 단계. tap 이 없으면 위치만 세고 넘긴다 */
class LoudnessMeter extends Transform {
  readonly #tap: GainTap | null;
  #meter: BlockMeter | null = null;
  // 지나간 위치(채널당 샘플 수)와 샘플 경계에 모자라 다음 청크로 넘기는 바이트
  #pos = 0;
  #carry: Buffer | null = null;

  constructor(tap: GainTap | null) {
    // 스트림을 열 때 재생 중 측정이 돌 것이면 1초 앞서 본다. 재생 중에 켠 경우의 룩어헤드는 다음에 열 때부터다
    super({ readableHighWaterMark: tap?.metering() ? AHEAD_BYTES : IDLE_BYTES });
    this.#tap = tap;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
    const data = this.#carry ? Buffer.concat([this.#carry, chunk]) : chunk;
    const usable = data.length - (data.length % FRAME_BYTES);
    this.#carry = usable < data.length ? Buffer.from(data.subarray(usable)) : null;
    const tap = this.#tap;
    if (tap?.metering()) {
      this.#meter ??= new BlockMeter((endPos, momentary, peak) => tap.block(endPos, momentary, peak));
      // 정렬되지 않은 버퍼에 Float32Array 뷰를 씌우면 예외를 던진다. 정렬된 새 버퍼로 복사해 읽는다
      const samples = new Float32Array(usable / 4);
      Buffer.from(samples.buffer).set(data.subarray(0, usable));
      this.#meter.push(samples, this.#pos);
    } else this.#meter = null;
    this.#pos += usable / FRAME_BYTES;
    done(null, chunk);
  }
}

export { LoudnessMeter, BlockMeter };
export type { OnBlock };
