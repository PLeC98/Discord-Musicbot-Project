// 화면의 색. 뜻마다 하나(디스코드 기본 팔레트). 그 밖의 화면은 운영자가 정한 색(EMBED_COLOR).
// 끝 · 멈춤 · 취소 · 해제는 오류가 아니라 닫힌 것이라 회색이다

import config from "../../config.ts";

const FIXED = {
  error: "#ED4245", // 실패 · 오류
  done: "#57F287", // 저장됨 · 설정됨
  closed: "#99AAB5", // 취소 · 멈춤 · 끝 · 해제
  working: "#FEE75C", // 처리 중
  settings: "#5865F2", // 설정 화면
} as const;

type Meaning = keyof typeof FIXED | "brand";

/** 그 뜻의 색. brand 는 운영자가 정한 색(부를 때 읽는다) */
function colorOf(meaning: Meaning): `#${string}` {
  return meaning === "brand" ? config.bot.embedColor : FIXED[meaning];
}

export { colorOf };
export type { Meaning };
