// 색 체계. 바탕색(seed) 하나로 머티리얼 3의 색 역할 전부를 만든다(2025 규격 = M3 Expressive). 화면(dashboard theme/palette)과
// 봇이 그리는 이미지(ui/system-card)가 같은 계산을 쓴다. 방식은 Tonal Spot: 면은 차분하게 두고 강조색만 살린다(matugen의 기본과 같다).
// 쓸 색이 없으면(흑백 앨범아트, 무채색 임베드 색) 회색 체계(Monochrome). Tonal Spot은 무채색에서도 색상을 계산해 엉뚱한 색(검정 → 분홍, 흰색, 회색 → 청록)을 낸다.
// 브라우저도 쓴다. Node에 기대는 것이 없다

import { Hct, MaterialDynamicColors, SchemeMonochrome, SchemeTonalSpot, argbFromHex, hexFromArgb, type DynamicScheme } from "@material/material-color-utilities";
import { COLORLESS } from "./art-seed.ts";
import { CHROMA_FLOOR } from "./icon-tones.ts";

/** 운영자 색(임베드 색)이 없을 때의 바탕색(아치 리눅스 파랑) */
const DEFAULT_SEED = argbFromHex("#1793d1");

const roles = new MaterialDynamicColors().allColors;

/** 바탕색(ARGB, COLORLESS면 회색) → 색 역할 이름(primary, on_surface 등)마다 #rrggbb */
function schemeColors(seed: number, dark: boolean): Record<string, string> {
  const hct = Hct.fromInt(seed === COLORLESS ? argbFromHex("#808080") : seed);
  // 둘 다 DynamicScheme이다. 이 패키지의 scheme_*.d.ts는 부모 클래스를 확장자 없이 불러 Node 방식 타입 검사(루트)에서는 그것이 보이지 않는다
  const scheme = (seed === COLORLESS || hct.chroma < CHROMA_FLOOR ? new SchemeMonochrome(hct, dark, 0, "2025") : new SchemeTonalSpot(hct, dark, 0, "2025")) as unknown as DynamicScheme;
  const out: Record<string, string> = {};
  for (const role of roles) out[role.name] = hexFromArgb(scheme.getArgb(role));
  return out;
}

export { DEFAULT_SEED, schemeColors };
