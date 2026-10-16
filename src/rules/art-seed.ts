// 그림의 대표색(화면 색 체계의 바탕색 씨앗) 고르기. 화면(theme/art: 앨범아트 · 배경)과 봇(로그인 배경의 대표색 · 장면 색)이 같은 셈을 쓴다.
// 가운데를 SEED_SIDE × SEED_SIDE 로 줄인 픽셀(RGBA)에서 Material 색 유틸리티로 양자화(Celebi 64색)해 점수가 가장 높은 하나를 고른다.
// 쓸 만한 색이 없는 그림(흑백 · 거의 무채색)이면 COLORLESS(회색 테마). 브라우저도 쓴다. Node 에 기대는 것이 없다

import { QuantizerCelebi, Score } from "@material/material-color-utilities";

/** 색을 뽑을 때 읽는 크기(40×40). 대표색 하나를 고르는 데는 이 정도면 충분하고, 더 크면 양자화가 프레임을 넘긴다 */
const SEED_SIDE = 40;
/** 쓸 만한 색이 없다(라이브러리는 이때 구글 파랑을 준다) */
const COLORLESS = 0;

/** RGBA 픽셀(0 ~ 255, 4개씩)의 대표색(ARGB). 반투명한 픽셀은 뺀다 */
function seedOfPixels(rgba: ArrayLike<number>): number {
  const pixels: number[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 255) continue;
    pixels.push(((255 << 24) | (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]) >>> 0);
  }
  const [best] = Score.score(QuantizerCelebi.quantize(pixels, 64), { desired: 1, filter: true, fallbackColorARGB: COLORLESS });
  return best ?? COLORLESS;
}

/** ARGB → #RRGGBB(COLORLESS 는 null) */
const hexOfSeed = (seed: number) => (seed === COLORLESS ? null : `#${(seed & 0xffffff).toString(16).padStart(6, "0")}`);

export { SEED_SIDE, COLORLESS, seedOfPixels, hexOfSeed };
