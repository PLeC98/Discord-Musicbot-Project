// 로그인 배경의 크기 셈: 정지 그림 폭 · 영상 단계 · 짧은 변을 맞춘 크기 · 원본을 고르게 만드는 필터. 미리보기 · 어림 · 굽기가 같이 쓴다.
// 영상 단계의 1080p · 4K 는 짧은 변 1080 · 2160 이다(세로 영상은 1080 × 1920 등). 원본보다 큰 단계는 만들지 않고, 원본이 1080p 보다 작으면 원본 크기 하나

import { LOGIN_BG_WIDTHS, type LoginBackgroundCrop } from "../contract/login-background.ts";
import type { Probed } from "./source.ts";

/** 영상 단계의 짧은 변 */
const FHD = 1080;
const UHD = 2160;
/** 영상의 초당 장면 수 상한 */
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

/** 크롭 안 가운데 정사각형의 크롭(색을 뽑을 때: 화면의 앨범아트 색 뽑기처럼 가운데 정사각형에서) */
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

/**
 * 원본을 고르게 만드는 필터(처음 [0:v] 에 이어 붙인다): 투명은 검정 위에 얹고(투명은 지원하지 않는다), HDR 은 SDR 로 톤 매핑하고,
 * 초당 장면 수를 30 이하로, 크롭이 있으면 자른다. 크기 맞추기 · 픽셀 형식은 부르는 쪽이 갈래마다 붙인다
 */
function sourceFilter(probed: Probed, crop?: LoginBackgroundCrop | null): string {
  const steps: string[] = [];
  if (probed.hdr) steps.push("zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709", "tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:r=tv");
  if ((probed.fps ?? FPS_CAP) > FPS_CAP) steps.push(`fps=${FPS_CAP}`);
  if (crop && (crop.w < 1 || crop.h < 1)) steps.push(`crop=trunc(iw*${crop.w}/2)*2:trunc(ih*${crop.h}/2)*2:trunc(iw*${crop.x}):trunc(ih*${crop.y})`);
  const chain = steps.length ? steps.join(",") : "null";
  // 투명: 같은 크기 검정 바탕에 얹는다(움짤의 투명한 곳은 검정)
  if (probed.alpha) return `color=c=black:s=${probed.width}x${probed.height}:r=${Math.min(probed.fps ?? FPS_CAP, FPS_CAP)}[bg];[bg][0:v]overlay=shortest=1:format=auto,${chain}`;
  return `[0:v]${chain}`;
}

/** 크기를 맞추는 필터 한 갈래(lanczos, 픽셀 형식은 굽기면 4:2:0, 장면을 뜰 때는 RGB) */
const scaleTo = ({ width, height }: { width: number; height: number }, format = "yuv420p") => `scale=${width}:${height}:flags=lanczos,format=${format}`;

export { TRANSPARENT_FILL, FHD, UHD, FPS_CAP, fitShort, cropped, squareCrop, stillWidths, rungShorts, sourceFilter, scaleTo };
