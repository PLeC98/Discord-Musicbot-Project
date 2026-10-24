// 화면의 색. 경고 수준마다 하나(ui/palette). 그 밖의 화면은 운영자가 정한 색(EMBED_COLOR).
// 운영자 공지(대시보드)도 이 표에서 선택한다: 점검 = 경고, 긴급 = 오류, 업데이트 = 완료, 공지사항 = 공지(계약 ANNOUNCE_STYLE)

import config from "../config/index.ts";
import { FIXED_COLORS } from "./palette.ts";

type Meaning = keyof typeof FIXED_COLORS | "brand";

/** 그 뜻의 색. brand 는 운영자가 정한 색(부를 때 읽는다) */
function colorOf(meaning: Meaning): `#${string}` {
  return meaning === "brand" ? config.bot.embedColor : FIXED_COLORS[meaning];
}

export { colorOf };
export type { Meaning };
