// 크기에 맞는 단위 선택. 봇 상태의 지표 카드 · 보조 텍스트 · 그래프(축 · 툴팁) · 연결 카드, AI 로그의 걸린 시간이 같은 규칙을 쓴다.
// 수를 몇 자리로 쓸지는 자리마다 다르므로 부르는 쪽이 n 을 꾸민다. per: 기본 단위로 몇인지(그래프 축의 상한을 선택한 단위의 깔끔한 수로 되돌릴 때)

import { formatNumber } from "./locale.ts";

export type Scaled = { n: number; unit: string; per: number };
export type Scale = (v: number) => Scaled;

/** ms. 1000ms 부터 초 */
export const time: Scale = (ms) => (ms >= 1000 ? { n: ms / 1000, unit: "s", per: 1000 } : { n: ms, unit: "ms", per: 1 });

/** Mbps. 1 아래는 kbps, 1000 부터 Gbps(회선 속도처럼 1000 배씩) */
export const bitRate: Scale = (mbps) => (mbps >= 1000 ? { n: mbps / 1000, unit: "Gbps", per: 1000 } : mbps >= 1 ? { n: mbps, unit: "Mbps", per: 1 } : { n: mbps * 1000, unit: "kbps", per: 0.001 });

/** MB/s(1024² 바이트). 1000 부터 GB/s(1024 배, 받은 양의 GB 와 같은 계산) */
export const byteRate: Scale = (mbs) => (mbs >= 1000 ? { n: mbs / 1024, unit: "GB/s", per: 1024 } : { n: mbs, unit: "MB/s", per: 1 });

/** 개수. 1000 부터 k, 100만부터 M(좁은 칸 · 긴 수를 줄여 쓸 때) */
export const count: Scale = (n) => (n >= 1e6 ? { n: n / 1e6, unit: "M", per: 1e6 } : n >= 1000 ? { n: n / 1000, unit: "k", per: 1000 } : { n, unit: "", per: 1 });

/** 단위가 하나뿐인 값(% · 개) */
export const fixed =
  (unit: string): Scale =>
  (v) => ({ n: v, unit, per: 1 });

/** 그래프의 수: 100 이상은 정수에 쉼표, 그 아래는 소수 한 · 두 자리(정수면 그대로) */
export const plain = (v: number) => (v >= 100 || Number.isInteger(v) ? formatNumber(Math.round(v)) : v.toFixed(v < 10 ? 2 : 1));

/** 1 · 2 · 5 × 10ⁿ 중 값이 들어가는 가장 작은 것(1 아래로는 내리지 않는다) */
export const niceMax = (peak: number) => {
  const step = 10 ** Math.floor(Math.log10(Math.max(1, peak)));
  return [1, 2, 5, 10].map((k) => k * step).find((v) => v >= peak) ?? 10 * step;
};

/**
 * 그래프 세로축의 상한. floor 는 최소 상한이라 값이 작을 때는 그대로(작은 흔들림이 부풀지 않게), 최고값이 넘으면 그 단위의 깔끔한 수로 늘린다(튄 것이 보이게).
 * 단위는 최고값의 단위로 정한다(5만 ms 는 50s 로)
 */
export function axisMax(peak: number, floor: number, scale: Scale) {
  if (peak <= floor) return floor;
  const s = scale(peak);
  return niceMax(s.n) * s.per;
}
