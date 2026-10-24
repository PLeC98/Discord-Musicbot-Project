// 로그인 배경의 영상을 무엇으로 틀지.
// 코덱은 우리가, 해상도는 hls.js 가(화면 크기 × 배율 · 통신) 선택한다. 우리는 어느 목록(코덱)을 열지와 해상도 상한만 정한다.
// 선택: powerEfficient ○ 인 단계 중 꽉 채웠을 때 필요한 세로 이상의 가장 낮은 해상도(없으면 가장 높은 것)를 먼저 정하고, 그 해상도에서 AV1 · VP9 · H.264 순서로 코덱.
// H.264 720p(폴백)는 AV1 · VP9 에 ○ 가 없을 때만. ○ 가 없으면 풀 수 있는 가장 낮은 단계. 선택한 해상도가 그 코덱의 가장 높은 단계보다 낮으면 상한을 건다.
// 내리기: 선택한 코덱에서 효과를 테마 색 전체 → 오버레이 색만 → 고정 순서로 빼고, 그 코덱의 낮은 해상도 상한 → H.264 720p → 정지 그림.
// 흐림이 강하면(화면 높이의 0.23% 이상) 4K 와 1080p 가 같아 보여 1080p 까지만 선택한다

import { LOGIN_BG_CODECS, type LoginBackgroundCodec, type LoginBackgroundStream } from "../../../src/dashboard/contract/login-background.ts";

/** 판정(MediaCapabilities.decodingInfo) */
type Verdict = { supported: boolean; smooth: boolean; powerEfficient: boolean };
/** 단계 하나(코덱 · 크기 · 2초 최대 · 판정에 넘길 형식) */
type Rung = { codec: LoginBackgroundCodec; width: number; height: number; type: string; bandwidth: number; frameRate: number };
/** 효과: 테마 색 전체(장면마다) · 오버레이 색만 · 고정(대표색) */
type Effect = "full" | "cover" | "fixed";
/** 내려갈 순서의 한 단계. codec 이 null 이면 정지 그림, cap 이 null 이면 해상도는 hls.js 가 화면 크기 · 통신으로 */
type Step = { codec: LoginBackgroundCodec | null; cap: number | null; effect: Effect };

/** 흐림 → 1080p 상한의 선(화면 높이에 대한 흐림 반지름. 이보다 흐리면 4K 와 1080p 가 같아 보인다) */
const BLUR_CAP_RATIO = 0.0023;
const FHD = 1080;

const rungsOf = (streams: LoginBackgroundStream[]): Rung[] => streams.flatMap((stream) => stream.rungs.map((rung) => ({ codec: stream.codec, width: rung.width, height: rung.height, type: `video/mp4; codecs="${rung.codecs}"`, bandwidth: rung.bandwidth, frameRate: rung.frameRate })));
/** 단계의 짧은 변(4K 는 2160, 세로로 자른 영상도 같다) */
const shortOf = (rung: { width: number; height: number }) => Math.min(rung.width, rung.height);

/** HLS(MSE)로 틀 때의 판정. 못 물어보면 풀 수 없음 */
async function judge(rung: Rung): Promise<Verdict> {
  try {
    const info = await navigator.mediaCapabilities.decodingInfo({ type: "media-source", video: { contentType: rung.type, width: rung.width, height: rung.height, bitrate: rung.bandwidth, framerate: rung.frameRate } });
    return { supported: info.supported, smooth: info.smooth, powerEfficient: info.powerEfficient };
  } catch {
    return { supported: false, smooth: false, powerEfficient: false };
  }
}

/**
 * 꽉 채웠을 때 필요한 짧은 변(기기 픽셀): 틀(CSS px) × 배율을 영상 비율로 덮는 크기. 흐림이 강하면 1080p 까지
 * aspect 는 영상의 가로 ÷ 세로, blur 는 화면 폭의 %
 */
function neededShort(frame: { width: number; height: number; dpr: number }, aspect: number, blur: number): number {
  const w = frame.width * frame.dpr;
  const h = frame.height * frame.dpr;
  // 덮을 때의 영상 크기
  const scale = Math.max(w / aspect, h);
  const need = Math.round(Math.min(scale * aspect, scale));
  const blurred = (frame.width * blur) / 100 >= frame.height * BLUR_CAP_RATIO;
  return blurred ? Math.min(need, FHD) : need;
}

/** 흐림이 강해 1080p 까지만 선택하는가 */
const blurCapped = (frame: { width: number; height: number }, blur: number) => (frame.width * blur) / 100 >= frame.height * BLUR_CAP_RATIO;

/** 내려갈 순서. 첫 단계가 판정으로 선택한 코덱. reduced 면(움직임 줄이기 · 영상 없음) 정지 그림 하나 */
function ladderOf(rungs: Rung[], verdicts: Map<Rung, Verdict>, need: number, options: { reduced: boolean; capFhd: boolean }): Step[] {
  const still: Step = { codec: null, cap: null, effect: "fixed" };
  if (options.reduced) return [still];
  const playable = rungs.filter((rung) => verdicts.get(rung)?.supported && (!options.capFhd || shortOf(rung) <= FHD));
  if (!playable.length) return [still];
  const shortsOf = (codec: LoginBackgroundCodec) => [...new Set(playable.filter((rung) => rung.codec === codec).map(shortOf))].sort((a, b) => a - b);
  // 해상도를 먼저 정하고 그 해상도에서 코덱을 선택한다(세로 화면은 필요한 세로가 커서, 코덱마다 가장 높은 단계만 보면 ○ 인 낮은 단계를 놓친다)
  const efficient = playable.filter((rung) => verdicts.get(rung)?.powerEfficient);
  const quality = efficient.filter((rung) => rung.codec !== "h264");
  const pool = quality.length ? quality : efficient.length ? efficient : playable;
  const shorts = [...new Set(pool.map(shortOf))].sort((a, b) => a - b);
  const top = efficient.length ? (shorts.find((short) => short >= need) ?? shorts[shorts.length - 1]) : shorts[0];
  const codec = pool.filter((rung) => shortOf(rung) === top).sort((a, b) => LOGIN_BG_CODECS.indexOf(a.codec) - LOGIN_BG_CODECS.indexOf(b.codec))[0].codec;
  // 선택한 해상도가 그 코덱의 가장 높은 단계보다 낮으면 상한을 건다(안 걸면 hls.js 가 화면 크기를 보고 ○ 가 아닌 단계로 올라간다)
  const capped = options.capFhd && rungs.some((rung) => rung.codec === codec && shortOf(rung) > FHD);
  const firstCap = shortsOf(codec).some((short) => short > top) || capped ? top : null;
  const steps: Step[] = (["full", "cover", "fixed"] as const).map((effect) => ({ codec, cap: firstCap, effect }));
  for (const short of shortsOf(codec)
    .filter((one) => one < top)
    .reverse())
    steps.push({ codec, cap: short, effect: "fixed" });
  if (codec !== "h264" && shortsOf("h264").length) steps.push({ codec: "h264", cap: null, effect: "fixed" });
  steps.push(still);
  return steps;
}

export { BLUR_CAP_RATIO, blurCapped, judge, ladderOf, neededShort, rungsOf, shortOf };
export type { Effect, Rung, Step, Verdict };
