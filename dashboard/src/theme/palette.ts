// 색 체계. 바탕색(seed) 하나로 머티리얼 3 의 색 역할 전부를 만들어 :root 의 --md-* 변수로 깐다(2025 규격 = M3 Expressive).
// 바탕색은 지금 곡의 앨범아트에서 추출한다(art.ts). 곡이 없으면 운영자가 지정한 임베드 색(theme.ts), 그것을 불러오기 전 처음이면 아치 리눅스 파랑.
// 방식은 Tonal Spot: 면은 차분하게 두고 강조색만 살린다(matugen 의 기본과 같다). 앨범아트 배경화면이 색을 더 보탠다.
// 쓸 색이 없으면(흑백 앨범아트 · 무채색 임베드 색) 회색 체계(Monochrome). Tonal Spot 은 무채색에서도 색상을 셈해 엉뚱한 색(검정 → 분홍, 흰색 · 회색 → 청록)을 낸다

import { Hct, MaterialDynamicColors, SchemeMonochrome, SchemeTonalSpot, argbFromHex, hexFromArgb } from "@material/material-color-utilities";
// 그림에 쓸 만한 색이 없다(art.ts 가 흑백 · 거의 무채색 그림에 준다)
import { COLORLESS } from "../../../src/rules/art-seed.ts";
// 무채색 기준(디스코드 앱 이모지의 색과 같은 기준)
import { CHROMA_FLOOR } from "../../../src/rules/icon-tones.ts";

/** 운영자 색(임베드 색)을 불러오기 전 처음의 바탕색 */
const DEFAULT_SEED = argbFromHex("#1793d1");

const roles = new MaterialDynamicColors().allColors;
const kebab = (name: string) => name.replaceAll("_", "-");

/** 바탕색 → { "--md-primary": "#...", ... } */
function paletteOf(seed: number, dark: boolean): Record<string, string> {
  const hct = Hct.fromInt(seed === COLORLESS ? argbFromHex("#808080") : seed);
  const scheme = seed === COLORLESS || hct.chroma < CHROMA_FLOOR ? new SchemeMonochrome(hct, dark, 0, "2025") : new SchemeTonalSpot(hct, dark, 0, "2025");
  const out: Record<string, string> = {};
  for (const role of roles) out[`--md-${kebab(role.name)}`] = hexFromArgb(scheme.getArgb(role));
  return out;
}

export { DEFAULT_SEED, paletteOf };
