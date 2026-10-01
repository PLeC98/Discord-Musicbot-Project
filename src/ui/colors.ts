// 화면의 색. 경고 수준마다 하나(디스코드 기본 팔레트). 그 밖의 화면은 운영자가 정한 색(EMBED_COLOR).
// 완료(초록)는 서버 설정을 바꿔 저장한 결과에만 쓴다. 오래 남는 바뀜이라 눈에 띄게

import config from "../../config.ts";

const FIXED = {
  error: "#ED4245", // 봇 쪽 문제 · 외부 실패로 못 했다
  warning: "#FEE75C", // 사용자가 고칠 수 있거나 지금 상태라 못 했다 · 일부만 됐다
  done: "#57F287", // 서버 설정을 저장했다
} as const;

type Meaning = keyof typeof FIXED | "brand";

/** 그 뜻의 색. brand 는 운영자가 정한 색(부를 때 읽는다) */
function colorOf(meaning: Meaning): `#${string}` {
  return meaning === "brand" ? config.bot.embedColor : FIXED[meaning];
}

export { colorOf };
export type { Meaning };
