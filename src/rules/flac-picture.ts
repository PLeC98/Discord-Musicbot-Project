// FLAC 그림 블록(METADATA_BLOCK_PICTURE). Ogg Opus 의 그림 태그는 이것을 base64 로 적은 Vorbis 주석이다(RFC 7845 · FLAC 형식).
// 모든 수는 빅 엔디언 32비트: 종류(3 = 앞 표지) · MIME 길이 · MIME · 설명 길이 · 설명 · 가로 · 세로 · 색 깊이 · 색 수(팔레트 아니면 0) · 그림 길이 · 그림

type PictureBlock = { mime: string; width: number; height: number; data: Uint8Array };

const FRONT_COVER = 3;
const DEPTH = 24;

function pictureBlock({ mime, width, height, data }: PictureBlock): Uint8Array {
  const mimeBytes = new TextEncoder().encode(mime);
  const out = new Uint8Array(32 + mimeBytes.length + data.length);
  const view = new DataView(out.buffer);
  let at = 0;
  const u32 = (value: number) => {
    view.setUint32(at, value);
    at += 4;
  };
  u32(FRONT_COVER);
  u32(mimeBytes.length);
  out.set(mimeBytes, at);
  at += mimeBytes.length;
  u32(0);
  u32(width);
  u32(height);
  u32(DEPTH);
  u32(0);
  u32(data.length);
  out.set(data, at);
  return out;
}

export { pictureBlock };
export type { PictureBlock };
