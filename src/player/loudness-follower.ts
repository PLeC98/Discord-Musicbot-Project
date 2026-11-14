// 재생 중 측정의 느린 추종. 100ms 마다 순간 볼륨(400ms 블록)과 그 100ms 의 샘플 피크를 넣으면 걸 정규화 게인(dB)을 돌려준다.
// 측정값(캐시 파일, 끝까지 재생하며 측정한 값)이 없는 소리에 쓴다. 곡 안의 조용한 부분과 큰 부분의 차이는 건드리지 않고 지금까지 들은 것의 통합 볼륨을 천천히 따라간다.

const TARGET = -14;
const BIN = 0.1;
const pw = (l: number) => 10 ** ((l + 0.691) / 10);
const lk = (z: number) => (z > 0 ? -0.691 + 10 * Math.log10(z) : -120);

/** 0.1 단위 히스토그램 */
class Hist {
  readonly lo: number;
  readonly n: number;
  readonly bins: Float64Array;
  count = 0;

  constructor(lo: number, hi: number) {
    this.lo = lo;
    this.n = Math.round((hi - lo) / BIN) + 1;
    this.bins = new Float64Array(this.n);
  }

  add(v: number) {
    this.bins[Math.min(this.n - 1, Math.max(0, Math.round((v - this.lo) / BIN)))]++;
    this.count++;
  }

  /** 위에서부터 frac 만큼 내려온 자리의 값(상위 1% 면 0.01) */
  top(frac: number) {
    let need = this.count * frac;
    let i = this.n - 1;
    for (; i > 0; i--) {
      need -= this.bins[i] as number;
      if (need < 0) break;
    }
    return this.lo + i * BIN;
  }
}

/** 절대 게이트를 넘은 블록들: 볼륨 히스토그램과 에너지 합 */
class Evidence {
  // 최대 크기의 고역 사인파나 사각파는 순간 볼륨이 0 LUFS 를 넘는다(+3 ~ +6)
  readonly h = new Hist(-70, 20);
  sum = 0;
  count = 0;

  add(m: number, p: number) {
    this.h.add(m);
    this.sum += p;
    this.count++;
  }

  /** 게이트 통합 볼륨과 상대 게이트를 넘은 블록 수. 블록이 없으면 null */
  read(): { level: number; n: number } | null {
    if (!this.count) return null;
    const rel = lk(this.sum / this.count) - 10;
    const h = this.h;
    let n = 0;
    let s = 0;
    for (let i = Math.max(0, Math.ceil((rel - h.lo) / BIN)); i < h.n; i++) {
      const c = h.bins[i] as number;
      if (c) {
        n += c;
        s += c * pw(h.lo + i * BIN);
      }
    }
    return n ? { level: lk(s / n), n } : null;
  }

  minus(other: Evidence) {
    const e = new Evidence();
    for (let i = 0; i < e.h.n; i++) e.h.bins[i] = Math.max(0, (this.h.bins[i] as number) - (other.h.bins[i] as number));
    e.sum = Math.max(0, this.sum - other.sum);
    e.count = Math.max(0, this.count - other.count);
    e.h.count = e.count;
    return e;
  }
}

/** 추종 파라미터. 시간은 초, 속도는 dB/s */
const RULES = {
  // 가정 볼륨보다 작은 소리를 믿는 데 드는 들은 양(초), 큰 소리는 n0Down
  n0: 30,
  n0Down: 5,
  // 3초 단기 볼륨의 천장: 목표 + H. H 는 h0 부터 관찰한 폭(단기 최대 - 통합 + 1)까지, hMax 를 넘지 않게, 들은 양 / (들은 양 + hGrowS) 만큼 넓어진다
  h0: 3,
  hMax: 14,
  hGrowS: 180,
  // 폭은 이만큼 전까지 본 것으로만 넓힌다. 지금 막 들어온 큰 소리가 스스로 천장을 높이지 못하게 한다
  crestLagS: 30,
  // 순간 볼륨의 천장은 목표 + H + mExtra. 큰 소리가 돌아올 때 3초를 기다리지 않게 한다
  mExtra: 4,
  upRate: 0.15,
  downRate: 4,
  // 천장보다 fastOverDb 넘게 크면 fastDownRate 로 내린다
  fastOverDb: 6,
  fastDownRate: 20,
  // 증폭 한도가 줄어 게인을 내릴 때의 속도. 피크는 리미터가 막으므로 천천히 내린다
  capDownRate: 1,
  maxBoost: 6,
  minGain: -30,
  ceiling: -1.5,
  // 이번 재생에서 모은 블록이 이만큼 쌓이기 전에는 지난 값의 증폭 한도를 쓴다. 처음에는 한도를 넉넉히 깎는다: 여유 = capMarginDb x capMarginS / (capMarginS + 들은 양)
  capAfterS: 20,
  capMarginDb: 3,
  capMarginS: 60,
  // 처음 startS 초가 그 뒤(startFromS ~ startUntilS 초 분량)보다 startDropDb 넘게 컸으면 처음 것을 모은 블록에서 뺀다(시작 광고, 징글)
  startS: 30,
  startDropDb: 6,
  startFromS: 15,
  startUntilS: 60,
};

/**
 * prior: 시작할 때 가정하는 볼륨(LUFS). startGain: 시작 게인(dB, 없으면 가정에서). 증폭이면 maxBoost 와 startCap 으로 제한한다.
 * startCap: 지난 값의 증폭 한도(dB). 이번 재생에서 모은 블록으로 한도를 계산하기 전까지 쓰고, 없으면 그동안 증폭하지 않는다
 */
type FollowerStart = { prior?: number; startGain?: number | null; startCap?: number | null };

class LoudnessFollower {
  /** 지금 걸 게인(dB) */
  gain: number;
  readonly #prior: number;
  #cap: number;
  #ev = new Evidence();
  // 처음 startS 초 뒤에 모은 블록. 앞부분 재확인이 끝나면 null
  #late: { ev: Evidence; peaks: Hist } | null = { ev: new Evidence(), peaks: new Hist(-60, 12) };
  #peaks = new Hist(-60, 12);
  readonly #s3 = new Float64Array(30);
  #s3At = 0;
  #s3Sum = 0;
  #s3N = 0;
  #sMax = -120;
  readonly #lag = new Float64Array(RULES.crestLagS).fill(-120);
  #lagAt = 0;
  #sLag = -120;
  #fed = 0;
  #level: number | null = null;
  #n = 0;

  constructor({ prior = TARGET, startGain = null, startCap = null }: FollowerStart = {}) {
    this.#prior = prior;
    this.#cap = Math.max(0, startCap ?? 0);
    // 가정이 조용한 쪽이어도(-30 LUFS 면 +16 dB) 그대로 걸지 않는다
    const start = startGain ?? TARGET - prior;
    this.gain = Math.max(RULES.minGain, start > 0 ? Math.min(start, RULES.maxBoost, this.#cap) : start);
  }

  /** momentary: 순간 볼륨(LUFS), peak: 그 100ms 의 샘플 피크(dBFS, 모르면 null). 깨진 값은 무음으로 본다. 돌려주는 값은 지금 걸 게인(dB) */
  push(momentary: number, peak: number | null = null): number {
    const m = Math.min(Number.isFinite(momentary) ? momentary : -120, 20);
    const pk = peak !== null && Number.isFinite(peak) ? peak : null;
    const s3 = this.#short(m);
    if (m > -70) this.#gather(m, pk);
    if (this.#fed >= 30 && s3 > this.#sMax) this.#sMax = s3;
    if (this.#fed % 10 === 0) {
      this.#sLag = this.#lag[this.#lagAt] as number;
      this.#lag[this.#lagAt] = this.#sMax;
      this.#lagAt = (this.#lagAt + 1) % this.#lag.length;
    }
    if (this.#fed % 5 === 0) this.#review();
    this.#fed++;
    this.#move(m, s3);
    return this.gain;
  }

  // 3초 단기 볼륨(LUFS)
  #short(m: number) {
    const p = pw(m);
    this.#s3Sum += p - (this.#s3[this.#s3At] as number);
    this.#s3[this.#s3At] = p;
    this.#s3At = (this.#s3At + 1) % 30;
    if (this.#s3N < 30) this.#s3N++;
    // 누적 오차를 가끔 바로잡는다
    if (this.#fed % 3000 === 0) this.#s3Sum = this.#s3.reduce((a, b) => a + b, 0);
    return lk(Math.max(0, this.#s3Sum) / this.#s3N);
  }

  #gather(m: number, pk: number | null) {
    const p = pw(m);
    this.#ev.add(m, p);
    if (pk !== null) this.#peaks.add(pk);
    if (this.#late && this.#fed >= RULES.startS * 10) {
      this.#late.ev.add(m, p);
      if (pk !== null) this.#late.peaks.add(pk);
    }
  }

  // 0.5초마다: 앞부분 재확인, 통합 볼륨, 증폭 한도
  #review() {
    this.#startCheck();
    const r = this.#ev.read();
    this.#level = r ? r.level : null;
    this.#n = r ? r.n : 0;
    if (this.#peaks.count > RULES.capAfterS * 10) {
      const sec = this.#peaks.count / 10;
      const raw = Math.max(0, RULES.ceiling - this.#peaks.top(0.01));
      this.#cap = Math.max(0, raw - (RULES.capMarginDb * RULES.capMarginS) / (RULES.capMarginS + sec));
    }
  }

  #startCheck() {
    const late = this.#late;
    if (!late || late.ev.count < RULES.startFromS * 10) return;
    if (late.ev.count > RULES.startUntilS * 10) {
      this.#late = null;
      return;
    }
    const early = this.#ev.minus(late.ev).read();
    const after = late.ev.read();
    if (early && after && early.level - after.level > RULES.startDropDb) {
      this.#ev = late.ev;
      this.#peaks = late.peaks;
      this.#sMax = -120;
      this.#lag.fill(-120);
      this.#sLag = -120;
      this.#late = null;
    }
  }

  // 믿는 볼륨과 천장으로 정한 게인까지 속도 제한을 지키며 바꾼다
  #move(m: number, s3: number) {
    const sec = this.#n / 10;
    let trusted = this.#prior;
    let over = 0;
    if (this.#level !== null) {
      // 가정보다 큰 소리는 빨리 믿고(n0Down), 작은 소리는 천천히 믿는다(n0). 조용한 도입부에 속지 않게 한다
      const w = this.#level > this.#prior ? RULES.n0Down : RULES.n0;
      trusted = (w * this.#prior + sec * this.#level) / (w + sec);
      if (this.#fed >= 4) {
        const crest = Math.max(RULES.h0, Math.min(RULES.hMax, this.#sLag - this.#level + 1));
        const h = RULES.h0 + (crest - RULES.h0) * (sec / (sec + RULES.hGrowS));
        const need = Math.max(this.#fed >= 10 ? s3 - h : -120, m - h - RULES.mExtra);
        over = this.gain - (TARGET - need);
        trusted = Math.max(trusted, need);
      }
    }
    const level = Math.max(RULES.minGain, Math.min(RULES.maxBoost, TARGET - trusted));
    const want = level > 0 ? Math.min(level, this.#cap) : level;
    const g = this.gain;
    if (g > level) this.gain = Math.max(level, g - (over > RULES.fastOverDb ? RULES.fastDownRate : RULES.downRate) * 0.1);
    else if (g > want) this.gain = Math.max(want, g - RULES.capDownRate * 0.1);
    // 무음에서는 증폭하지 않는다
    else if (g < want && m > -70) this.gain = Math.min(want, g + RULES.upRate * 0.1);
  }
}

export { LoudnessFollower, TARGET as FOLLOW_TARGET };
export type { FollowerStart };
