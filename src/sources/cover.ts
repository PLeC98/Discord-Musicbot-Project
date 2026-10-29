// 앨범아트(파일 태그의 이미지)를 봇이 다시 인코딩한 JPEG 으로. 쓰는 쪽(캐시 파일 · 디스코드 · 대시보드)에는 이것만 간다.
// 외부 이미지라 읽기 전에 바이트 상한, 디코딩 전에 선언된 픽셀 상한(sharp 의 limitInputPixels)을 건다. 애니메이션은 첫 프레임, 투명한 곳은 검정(sharp 기본)

import sharp from "sharp";
import { messageOf } from "../rules/error-kind.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "track" });

/** 긴 변 상한(px, 작으면 키우지 않는다) · JPEG 품질 */
const SIDE = 1000;
const QUALITY = 85;
/** 입력 이미지의 바이트 상한(file-tags 의 태그 읽기 상한과 같은 값) */
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
/** 선언된 픽셀 수 상한(8000×8000) */
const MAX_PIXELS = 64_000_000;

type Cover = { jpeg: Buffer; width: number; height: number };

/** 다시 인코딩한다. 읽을 수 없거나 상한을 넘으면 null(곡은 앨범아트 없이) */
async function bakeCover(data: Uint8Array): Promise<Cover | null> {
  if (data.length === 0 || data.length > MAX_INPUT_BYTES) return null;
  try {
    const { data: jpeg, info } = await sharp(data, { limitInputPixels: MAX_PIXELS, pages: 1 }).rotate().flatten().resize(SIDE, SIDE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    return { jpeg, width: info.width, height: info.height };
  } catch (error) {
    log.debug(`앨범아트를 불러오지 못함(앨범아트 없이 진행): ${messageOf(error)}`);
    return null;
  }
}

/**
 * 캐시 파일 태그에서 꺼낸 앨범아트. bakeCover 결과 형식(JPEG · 긴 변 1000px 이하)이면 그대로, 아니면 다시 인코딩한다.
 * 백업으로 불러온 남의 캐시 파일도 같은 확인을 지난다(누가 만든 파일인지 가리지 않는다)
 */
async function checkCover(data: Uint8Array): Promise<Cover | null> {
  if (data.length === 0 || data.length > MAX_INPUT_BYTES) return null;
  try {
    const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    const { format, width = 0, height = 0 } = await sharp(data, { limitInputPixels: MAX_PIXELS }).metadata();
    if (isJpeg && format === "jpeg" && width > 0 && height > 0 && width <= SIDE && height <= SIDE) return { jpeg: Buffer.from(data), width, height };
  } catch (error) {
    log.debug(`앨범아트를 확인하지 못함(앨범아트 없이 진행): ${messageOf(error)}`);
    return null;
  }
  return bakeCover(data);
}

export { bakeCover, checkCover, SIDE };
export type { Cover };
