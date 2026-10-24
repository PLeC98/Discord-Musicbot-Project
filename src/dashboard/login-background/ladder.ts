// 로그인 배경의 크기 계산: 정지 그림 폭 · 영상 단계 · 짧은 변을 맞춘 크기 · 원본을 고르게 만드는 필터. 미리보기 · 어림 · 인코딩이 같이 쓴다.
// 영상 단계의 1080p · 4K 는 짧은 변 1080 · 2160 이다(세로 영상은 1080 × 1920 등). 원본보다 큰 단계는 만들지 않고, 원본이 1080p 보다 작으면 원본 크기 하나

import { LOGIN_BG_WIDTHS, type LoginBackgroundCrop } from "../contract/login-background.ts";
import type { Probed } from "./source.ts";

/** 영상 단계의 짧은 변 */
const FHD = 1080;
const UHD = 2160;
/** 영상의 초당 프레임 수 상한 */
const FPS_CAP = 30;

/** 투명한 곳을 채우는 검정(투명은 지원하지 않는다). 그림은 sharp 의 flatten, 영상은 sourceFilter 의 color=black */
const TRANSPARENT_FILL = { r: 0, g: 0, b: 0 };

/** 짝수로(인코더가 4:2:0 이라 홀수 크기를 받지 않는다) */
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** 짧은 변을 short 로 맞춘 크기(원본이 더 작으면 원본 크기) */
function fitShort(width: number, height: number, short: number): { width: number; height: number } {
  const scale = Math.min(1, short / Math.min(width, height));
  return { width: even(width * scale), height: even(height * scale) };
}

/** 크롭한 크기 */
const cropped = (width: number, height: number, crop: LoginBackgroundCrop) => ({ width: Math.round(width * crop.w), height: Math.round(height * crop.h) });

/** 크롭 안 가운데 정사각형의 크롭(색을 추출할 때: 화면의 앨범아트 색 추출처럼 가운데 정사각형에서) */
function squareCrop(width: number, height: number, crop: LoginBackgroundCrop): LoginBackgroundCrop {
  const side = Math.min(width * crop.w, height * crop.h);
  const w = side / width;
  const h = side / height;
  return { x: crop.x + (crop.w - w) / 2, y: crop.y + (crop.h - h) / 2, w, h };
}

/** 정지 그림을 내는 폭: 원본 폭보다 작거나 같은 것, 하나도 없으면 원본 폭 하나 */
function stillWidths(width: number): number[] {
  const fit = LOGIN_BG_WIDTHS.filter((one) => one <= width);
  return fit.length ? fit : [width];
}

/** AV1 · VP9 단계의 짧은 변: 4K 는 원본의 짧은 변이 2160 이상일 때만, 1080p 는 늘(원본이 작으면 원본 크기) */
const rungShorts = (width: number, height: number) => (Math.min(width, height) >= UHD ? [FHD, UHD] : [FHD]);

/** 읽을 구간(초). to 가 null 이면 끝까지 */
type Span = { from: number; to: number | null };

/**
 * 장면을 앞 장면 위에 그리는 움직이는 그림. 입력 앞 -ss 로 찾아가면 장면이 나오지 않거나(WebP) 깨진 장면이 나와(APNG)
 * 처음부터 풀어 필터에서 자른다. GIF 도 같은 방식의 형식이라 같이 둔다
 */
const STACKED_FORMATS = ["webp_anim", "apng", "gif"];
const stacked = (probed: Pick<Probed, "format">) => STACKED_FORMATS.includes(probed.format);
/**
 * 풀어 낸 영상의 초당 프레임 수(인코딩의 키프레임 간격 · 목록의 프레임 수도 이것): 영상은 원본(30 이하),
 * 움직이는 그림은 장면 길이가 제각각이라(같은 장면을 2초짜리 하나로 적는 등) 30 으로 고르게 편다
 */
const frameRate = (probed: Pick<Probed, "format" | "fps">) => (stacked(probed) ? FPS_CAP : Math.min(probed.fps ?? FPS_CAP, FPS_CAP));

/** 구간을 찾아가는 입력 인자(-i 앞): 영상은 -ss · -to, 움직이는 그림은 없다(sourceFilter 가 자른다) */
function seekArgs(probed: Probed, span: Span): string[] {
  if (stacked(probed)) return [];
  return ["-ss", String(span.from), ...(span.to === null ? [] : ["-to", String(span.to)])];
}

/** 움직이는 그림을 고르게 펴고 구간을 자르는 필터(영상이면 null). 편 뒤에 자른다: trim 은 구간 안에서 시작한 장면만 남겨, 긴 장면이 구간 앞에서 시작하면 빠진다 */
function evenedSpan(probed: Probed, span?: Span): string | null {
  if (!stacked(probed)) return null;
  const cut = span ? [`trim=start=${span.from}${span.to === null ? "" : `:end=${span.to}`}`, "setpts=PTS-STARTPTS"] : [];
  return [`fps=${frameRate(probed)}`, ...cut].join(",");
}

/**
 * 원본을 고르게 만드는 필터(처음 [0:v] 에 이어 붙인다): 움직이는 그림은 장면 간격을 고르게 펴 구간을 자르고(seekArgs), 투명은 검정 위에 얹고(투명은 지원하지 않는다),
 * HDR 은 SDR 로 톤 매핑하고, 초당 프레임 수를 frameRate 로, 크롭이 있으면 자른다. 크기 맞추기 · 픽셀 형식은 부르는 쪽이 분기마다 붙인다
 */
function sourceFilter(probed: Probed, crop?: LoginBackgroundCrop | null, span?: Span): string {
  const steps: string[] = [];
  if (probed.hdr) steps.push("zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709", "tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:r=tv");
  if (!stacked(probed) && (probed.fps ?? FPS_CAP) > FPS_CAP) steps.push(`fps=${FPS_CAP}`);
  if (crop && (crop.w < 1 || crop.h < 1)) steps.push(`crop=trunc(iw*${crop.w}/2)*2:trunc(ih*${crop.h}/2)*2:trunc(iw*${crop.x}):trunc(ih*${crop.y})`);
  const chain = steps.length ? steps.join(",") : "null";
  const evened = evenedSpan(probed, span);
  if (!probed.alpha) return `[0:v]${evened ? `${evened},` : ""}${chain}`;
  // 투명: 같은 크기 검정 바탕에 얹는다(움짤의 투명한 곳은 검정). 바탕은 구간 길이만큼(얹을 장면이 하나도 없으면 바탕만 끝없이 나온다)
  const length = span && span.to !== null ? `:d=${span.to - span.from}` : "";
  const background = `color=c=black:s=${probed.width}x${probed.height}:r=${frameRate(probed)}${length}[bg]`;
  const input = evened ? `[0:v]${evened}[src];[bg][src]` : "[bg][0:v]";
  return `${background};${input}overlay=shortest=1:format=auto,${chain}`;
}

/** 크기를 맞추는 필터 분기 하나(lanczos, 픽셀 형식은 인코딩이면 4:2:0, 장면을 뜰 때는 RGB) */
const scaleTo = ({ width, height }: { width: number; height: number }, format = "yuv420p") => `scale=${width}:${height}:flags=lanczos,format=${format}`;

export { TRANSPARENT_FILL, FHD, UHD, FPS_CAP, fitShort, cropped, squareCrop, stillWidths, rungShorts, stacked, frameRate, seekArgs, sourceFilter, scaleTo };
export type { Span };
