// 운영자 패널에서 올린 그림으로 앱 이모지 이미지를 만든다(디스코드 서버 설정의 "이모지 추가" 창과 같은 편집: 정사각형 자르기, 90도 회전, 좌우 반전).
// 편집 값은 화면에서 본 그대로다: 원본을 돌리고(rotate), 그다음 좌우로 뒤집고(flip), 그렇게 바뀐 이미지 위에서 정사각형을 픽셀로 자른다.
// sharp 는 연산을 부른 순서가 아니라 정해진 차례로 적용하는 것이 있어(반전이 회전, 자르기보다 먼저) 단계마다 따로 돌린다.
// 움직이는 GIF, WebP 는 프레임마다 같은 편집을 하고 지연, 반복을 그대로 둔다(sharp 는 여러 프레임 이미지의 회전을 막는다, notes 조사 기록 9절).
// 결과는 디스코드 앱 이모지 한도에 맞춘다: 128px, 256KiB. 움직이는 것은 GIF, 넘치면 움직이는 WebP 로 한 번 더

import sharp from "sharp";
import { codedError } from "../rules/error-kind.ts";

/** 디스코드가 권하는 이모지 크기와 파일 한도 */
const EMOJI_SIZE = 128;
const EMOJI_MAX_BYTES = 256 * 1024;
/** 받는 원본의 프레임 수, 프레임 하나의 픽셀 수 상한(프레임마다 sharp 를 돌린다) */
const MAX_FRAMES = 300;
const MAX_FRAME_PIXELS = 4096 * 4096;

type Rotation = 0 | 90 | 180 | 270;
/** 편집 값. left, top, side: 돌리고 뒤집은 이미지 위의 정사각형(픽셀) */
type EmojiEdit = { rotate: Rotation; flip: boolean; left: number; top: number; side: number };
type EmojiImage = { data: Buffer; animated: boolean; format: "png" | "gif" | "webp" };

type Frame = { data: Buffer; width: number; height: number };

/** 프레임 하나를 돌리고, 뒤집고, 자르고, 줄인다. 결과는 EMOJI_SIZE 정사각형의 RGBA */
async function editFrame(frame: Frame, edit: EmojiEdit): Promise<Buffer> {
  const raw = { width: frame.width, height: frame.height, channels: 4 as const };
  const rotated = await sharp(frame.data, { raw }).rotate(edit.rotate).raw().toBuffer({ resolveWithObject: true });
  const turned = { width: rotated.info.width, height: rotated.info.height, channels: 4 as const };
  const flipped = edit.flip ? await sharp(rotated.data, { raw: turned }).flop().raw().toBuffer() : rotated.data;
  if (edit.left < 0 || edit.top < 0 || edit.side < 1 || edit.left + edit.side > turned.width || edit.top + edit.side > turned.height) throw codedError("EMOJI_EDIT", "자를 영역이 이미지 밖입니다");
  return sharp(flipped, { raw: turned })
    .extract({ left: Math.round(edit.left), top: Math.round(edit.top), width: Math.round(edit.side), height: Math.round(edit.side) })
    .resize(EMOJI_SIZE, EMOJI_SIZE, { kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

/** 원본을 읽어 프레임들로. 프레임 수, 크기가 상한을 넘으면 던진다 */
async function framesOf(source: Buffer): Promise<{ frames: Frame[]; delay?: number[]; loop?: number }> {
  let meta;
  try {
    meta = await sharp(source, { animated: true }).metadata();
  } catch {
    throw codedError("EMOJI_IMAGE", "그림을 읽지 못했습니다");
  }
  const pages = meta.pages ?? 1;
  const width = meta.width ?? 0;
  const height = meta.pageHeight ?? meta.height ?? 0;
  if (!width || !height) throw codedError("EMOJI_IMAGE", "그림을 읽지 못했습니다");
  if (pages > MAX_FRAMES || width * height > MAX_FRAME_PIXELS) throw codedError("EMOJI_IMAGE_TOO_BIG", `프레임 ${pages}개, ${width}×${height}`);
  const frames: Frame[] = [];
  for (let page = 0; page < pages; page++) {
    // 브라우저처럼 EXIF 방향대로 세운 이미지 위에서 편집한다(휴대폰 사진)
    const { data, info } = await sharp(source, { page, autoOrient: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    frames.push({ data, width: info.width, height: info.height });
  }
  return { frames, delay: meta.delay, loop: meta.loop };
}

/** 올린 원본과 편집 값으로 앱 이모지 이미지를 만든다. 디스코드 한도를 넘으면 EMOJI_TOO_LARGE 로 던진다 */
async function makeEmojiImage(source: Buffer, edit: EmojiEdit): Promise<EmojiImage> {
  const { frames, delay, loop } = await framesOf(source);
  const edited: Buffer[] = [];
  for (const frame of frames) edited.push(await editFrame(frame, edit));
  if (edited.length === 1) {
    const data = await sharp(edited[0], { raw: { width: EMOJI_SIZE, height: EMOJI_SIZE, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (data.length > EMOJI_MAX_BYTES) throw codedError("EMOJI_TOO_LARGE", `${data.length}B`);
    return { data, animated: false, format: "png" };
  }
  const strip = () => sharp(Buffer.concat(edited), { raw: { width: EMOJI_SIZE, height: EMOJI_SIZE * edited.length, channels: 4, pageHeight: EMOJI_SIZE } });
  const gif = await strip().gif({ delay, loop }).toBuffer();
  if (gif.length <= EMOJI_MAX_BYTES) return { data: gif, animated: true, format: "gif" };
  const webp = await strip().webp({ delay, loop, quality: 80 }).toBuffer();
  if (webp.length <= EMOJI_MAX_BYTES) return { data: webp, animated: true, format: "webp" };
  throw codedError("EMOJI_TOO_LARGE", `GIF ${gif.length}B, WebP ${webp.length}B`);
}

export { makeEmojiImage, EMOJI_SIZE, EMOJI_MAX_BYTES, MAX_FRAMES, MAX_FRAME_PIXELS };
export type { EmojiEdit, EmojiImage, Rotation };
