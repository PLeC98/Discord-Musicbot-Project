// 그림이 없는 곡(직접 링크 등)의 썸네일: 패널 색을 연하게 깐 바탕에 같은 색 음표(대시보드의 그림 없는 곡과 같은 꼴).
// 음표는 대시보드 아이콘 글꼴(Material Symbols Rounded, SIL OFL 1.1)의 music_note 윤곽이다(글꼴 단위 960, y 위로).
// 메시지에 첨부하고 attachment://로 가리킨다. 패널 색마다 처음 쓸 때 만든다

import sharp from "sharp";

const NAME = "no-art.png";
const SIZE = 256;
/** music_note(FILL 0 · wght 400) 윤곽 */
const NOTE = "M400 120Q400 120 367 120Q334 120 287 167Q240 214 240 280Q240 346 287 393Q334 440 400 440Q423 440 442.5 434.5Q462 429 480 418L480 800Q480 817 491.5 828.5Q503 840 520 840L680 840Q697 840 708.5 828.5Q720 817 720 800L720 720Q720 703 708.5 691.5Q697 680 680 680L560 680L560 280Q560 214 513 167Q466 120 400 120Z";
/** 바탕의 진하기(밝은 · 어두운 디스코드 둘 다에서 음표가 보이게) */
const TINT = 0.22;

/** 그 색의 썸네일 PNG */
function svgOf(color: `#${string}`): string {
  // 음표는 칸의 절반(대시보드의 그림 없는 곡과 같은 비율): 기호는 글꼴 칸 960 의 3/4 이라 글꼴 칸을 칸의 2/3 로, 가운데에 두고 y 를 뒤집는다
  const box = (SIZE * 2) / 3;
  const at = (SIZE - box) / 2;
  const scale = box / 960;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="${color}" fill-opacity="${TINT}"/><path transform="translate(${at} ${at + box}) scale(${scale} ${-scale})" d="${NOTE}" fill="${color}"/></svg>`;
}

const made = new Map<string, Promise<Buffer>>();
const pngOf = (color: `#${string}`) => {
  let found = made.get(color);
  if (!found) {
    found = sharp(Buffer.from(svgOf(color)))
      .png()
      .toBuffer();
    made.set(color, found);
  }
  return found;
};

export const url = `attachment://${NAME}`;
export const file = async (color: `#${string}`) => ({ attachment: await pngOf(color), name: NAME });
export const _internals = { svgOf, NAME, SIZE };
