// 디스코드 앱 이모지의 색. 바탕색(운영자 색 · 응답 색)의 색상만 가져와 정한 톤으로 칠한다: 타일은 톤 40, 기호는 톤 98(머티리얼의 채운 아이콘 버튼과 같은 짝).
// 톤을 고정하므로 어떤 바탕색이 와도 같은 밝기다(어두운 테마에서 튀지 않고 밝은 테마에서 묻히지 않는다). 채도는 Tonal Spot 의 primary 와 같은 36,
// 무채색 바탕색이면 채도 0(회색). 브라우저도 쓴다. Node 에 기대는 것이 없다

import { Hct, TonalPalette, argbFromHex, hexFromArgb } from "@material/material-color-utilities";

/** 이보다 채도가 낮으면 무채색으로 본다(대시보드 색 체계와 같은 기준. 앨범아트에서 색을 추출할 때 버리는 Score.CUTOFF_CHROMA 와 같다) */
const CHROMA_FLOOR = 5;

const TILE_TONE = 40;
const GLYPH_TONE = 98;
const CHROMA = 36;

/** 바탕색(#RRGGBB) → 타일 · 기호 색 */
function iconTones(hex: `#${string}`): { tile: `#${string}`; glyph: `#${string}` } {
  const hct = Hct.fromInt(argbFromHex(hex));
  const palette = TonalPalette.fromHueAndChroma(hct.hue, hct.chroma < CHROMA_FLOOR ? 0 : CHROMA);
  return { tile: hexFromArgb(palette.tone(TILE_TONE)) as `#${string}`, glyph: hexFromArgb(palette.tone(GLYPH_TONE)) as `#${string}` };
}

export { CHROMA_FLOOR, iconTones };
