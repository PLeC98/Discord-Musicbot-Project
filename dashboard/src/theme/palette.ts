// 색 체계를 :root 의 --md-* 변수로 설정한다. 계산은 봇이 그리는 이미지와 같은 것(src/rules/palette)을 쓴다.
// 바탕색은 지금 곡의 앨범아트에서 추출한다(art.ts). 곡이 없으면 운영자가 지정한 임베드 색(theme.ts), 그것을 불러오기 전 처음이면 기본색.
// 앨범아트 배경화면이 색을 더 보탠다

import { DEFAULT_SEED, schemeColors } from "../../../src/rules/palette.ts";

const kebab = (name: string) => name.replaceAll("_", "-");

/** 바탕색 → { "--md-primary": "#...", ... } */
function paletteOf(seed: number, dark: boolean): Record<string, string> {
  return Object.fromEntries(Object.entries(schemeColors(seed, dark)).map(([name, hex]) => [`--md-${kebab(name)}`, hex]));
}

export { DEFAULT_SEED, paletteOf };
