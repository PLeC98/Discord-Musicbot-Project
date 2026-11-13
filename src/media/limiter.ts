// 송출 직전의 게인과 리미터(인코딩 워커가 스트림마다 하나). 깨진 샘플 거르기, 프레임 안 게인 램프, 룩어헤드 리미터, 클립을 루프 한 번에 처리한다.
// 지연 버퍼는 리미터를 끈(press 가 아닌) 동안에도 늘 돈다. 리미터를 켜고 꺼도 지연이 같아 소리가 튀지 않는다.
// 워커에서 돌므로 다른 모듈을 부르지 않는다(logger 를 부르면 워커에 sink 가 따로 생긴다).

const FS = 48_000;

/** 4배 보간 true peak 의 위상마다 12탭 계수(BS.1770 부속서 2) */
const TRUE_PEAK_PHASES: readonly (readonly number[])[] = [
  [0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625, 0.97216796875, -0.102294921875, 0.047607421875, -0.026611328125, 0.014892578125, -0.00830078125],
  [-0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625, 0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375],
  [-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625, 0.465087890625, -0.16650390625, 0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875],
  [-0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875, -0.102294921875, 0.97216796875, 0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375],
];
const TAPS = 12;
// 보간 필터가 늦추는 샘플 수. 소리를 그만큼 더 늦춰 감지와 맞춘다
const TAP_DELAY = 6;
// 보간 계수의 절댓값 합이 가장 큰 위상에서 2.0228 이다. 최근 12 샘플이 모두 상한 / 2.03 아래면 true peak 가 상한을 넘을 수 없어 보간을 건너뛴다
const SAFE_RATIO = 2.03;
// 이 크기 밖의 샘플은 깨진 값으로 보고 0 으로 둔다(+36 dBFS)
const BROKEN = 64;

type LimiterOptions = { ceilingDb?: number; marginDb?: number; lookMs?: number; releaseMs?: number };

/**
 * 두 채널을 함께 줄이는 룩어헤드 리미터. 필요 게인 → 룩어헤드 길이의 윈도우 최솟값 → 지수 릴리스 → 같은 길이의 이동 평균.
 * 소리는 룩어헤드 길이 + 보간 지연(합쳐서 delaySamples)만큼 늦는다. 스트림이 끝날 때 지연 버퍼에 남은 것은 버린다.
 * ceilingDb: 상한(dBTP). marginDb: 내부 상한을 이만큼 낮춘다(게인이 바뀌는 동안의 보간 피크까지는 상한 아래로 잡지 못한다)
 */
class Limiter {
  /** 채널당 지연 샘플 수 */
  readonly delaySamples: number;
  readonly #ceil: number;
  readonly #look: number;
  readonly #release: number;
  readonly #delay: Float32Array;
  #delayAt = 0;
  // 이동 평균
  readonly #avg: Float32Array;
  #avgSum: number;
  #avgAt = 0;
  // 윈도우 최솟값(단조 덱): 샘플 번호와 필요 게인
  readonly #qAt: Float64Array;
  readonly #qNeed: Float32Array;
  #qHead = 0;
  #qTail = 0;
  #n = 0;
  #held = 1;
  // 보간에 쓰는 최근 샘플. 두 벌로 적어(인덱스 i 와 i + TAPS) 윈도우를 나머지 연산 없이 이어 읽는다
  readonly #hist = [new Float32Array(TAPS * 2), new Float32Array(TAPS * 2)] as const;
  #histAt = 0;
  // 큰 샘플이 지나간 뒤 필터 길이만큼은 계속 보간한다
  #hot = 0;
  // 클립 상한. 리미터를 켜고 끌 때 룩어헤드 길이쯤에 걸쳐 바꾼다(한 번에 바꾸면 그 샘플에서 소리가 튄다)
  #top: number | null = null;
  #topTarget = 1;
  readonly #topStep: number;

  constructor({ ceilingDb = -1.5, marginDb = 0.05, lookMs = 5, releaseMs = 80 }: LimiterOptions = {}) {
    this.#ceil = 10 ** ((ceilingDb - marginDb) / 20);
    this.#look = Math.round((FS * lookMs) / 1000);
    this.delaySamples = this.#look + TAP_DELAY;
    this.#release = Math.exp(-1 / ((FS * releaseMs) / 1000));
    this.#delay = new Float32Array(this.delaySamples * 2);
    this.#avg = new Float32Array(this.#look).fill(1);
    this.#avgSum = this.#look;
    this.#qAt = new Float64Array(this.#look + 1);
    this.#qNeed = new Float32Array(this.#look + 1);
    this.#topStep = 3 / this.#look;
  }

  /**
   * 인터리브 스테레오 PCM 을 제자리에서 처리한다. 게인은 버퍼 안에서 from 에서 to 로 선형 램프하며 마지막 샘플의 게인이 to 다.
   * press 면 리미터가 상한 아래로 줄이고, 아니면 지연만 거친 뒤 ±1 로 클립한다
   */
  run(pcm: Float32Array, from: number, to: number, press: boolean) {
    const frames = pcm.length >> 1;
    const step = frames > 0 ? (to - from) / frames : 0;
    this.#topTarget = press ? this.#ceil : 1;
    this.#top ??= this.#topTarget;
    let gain = from;
    for (let i = 0; i < pcm.length; i += 2) {
      gain += step;
      const l = clean(pcm[i] as number) * gain;
      const r = clean(pcm[i + 1] as number) * gain;
      const peak = this.#peakOf(l, r, press);
      const g = this.#gainFor(press && peak > this.#ceil ? this.#ceil / peak : 1);
      this.#emit(pcm, i, l, r, g);
    }
  }

  // 두 채널의 피크. press 일 때 최근 샘플이 보간하면 상한을 넘을 수 있는 크기면 true peak(4배 보간)까지 본다
  #peakOf(l: number, r: number, press: boolean) {
    const [h0, h1] = this.#hist;
    const at = this.#histAt;
    h0[at] = h0[at + TAPS] = l;
    h1[at] = h1[at + TAPS] = r;
    this.#histAt = (at + 1) % TAPS;
    const peak = Math.max(Math.abs(l), Math.abs(r));
    const near = this.#ceil / SAFE_RATIO;
    if (!press || (peak <= near && this.#hot <= 0)) return peak;
    this.#hot = peak > near ? TAPS : this.#hot - 1;
    return Math.max(peak, interpolatedPeak(h0, this.#histAt), interpolatedPeak(h1, this.#histAt));
  }

  // 룩어헤드 길이의 윈도우 최솟값 → 지수 릴리스 → 같은 길이의 이동 평균
  #gainFor(need: number) {
    const look = this.#look;
    const cap = look + 1;
    const qNeed = this.#qNeed;
    while (this.#qHead !== this.#qTail && (qNeed[(this.#qTail + cap - 1) % cap] as number) >= need) this.#qTail = (this.#qTail + cap - 1) % cap;
    this.#qAt[this.#qTail] = this.#n;
    qNeed[this.#qTail] = need;
    this.#qTail = (this.#qTail + 1) % cap;
    if ((this.#qAt[this.#qHead] as number) <= this.#n - look) this.#qHead = (this.#qHead + 1) % cap;
    this.#n++;
    const target = qNeed[this.#qHead] as number;
    this.#held = target >= this.#held ? target + (this.#held - target) * this.#release : target;
    const a = this.#avgAt;
    this.#avgSum += this.#held - (this.#avg[a] as number);
    this.#avg[a] = this.#held;
    this.#avgAt = (a + 1) % look;
    return Math.min(1, this.#avgSum / look);
  }

  // 지연된 샘플에 게인을 걸어 i 에 쓴다. 설계상 상한을 넘지 않지만 부동소수점 오차와 보간 지연의 어긋남에 대비해 마지막에 클립한다
  #emit(pcm: Float32Array, i: number, l: number, r: number, g: number) {
    const delay = this.#delay;
    const d = this.#delayAt * 2;
    const outL = (delay[d] as number) * g;
    const outR = (delay[d + 1] as number) * g;
    delay[d] = l;
    delay[d + 1] = r;
    this.#delayAt = (this.#delayAt + 1) % this.delaySamples;
    const top = (this.#top = (this.#top as number) + (this.#topTarget - (this.#top as number)) * this.#topStep);
    pcm[i] = outL > top ? top : outL < -top ? -top : outL;
    pcm[i + 1] = outR > top ? top : outR < -top ? -top : outR;
  }
}

const clean = (v: number) => (v > -BROKEN && v < BROKEN ? v : 0);

// 한 채널의 true peak. oldest 는 윈도우에서 가장 오래된 샘플의 인덱스(h[oldest + TAPS - 1] 이 가장 최근)
function interpolatedPeak(h: Float32Array, oldest: number) {
  let peak = 0;
  const newest = oldest + TAPS - 1;
  for (const phase of TRUE_PEAK_PHASES) {
    let s = 0;
    for (let t = 0; t < TAPS; t++) s += (phase[t] as number) * (h[newest - t] as number);
    peak = Math.max(peak, Math.abs(s));
  }
  return peak;
}

export { Limiter, TRUE_PEAK_PHASES };
