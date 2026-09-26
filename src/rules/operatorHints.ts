// 운영자가 설정으로 풀 수 있는 실패의 안내. 사용자 문장(ui/errorMessages)에는 무엇이 안 됐는지만 쓰고,
// 고치는 법은 운영자가 보는 로그에 이 안내를 붙인다. 곡 찾기(sources)와 재생(player)이 같이 쓴다

const HINTS: Record<string, string> = {
  "bot-check": "bgutil(POToken)을 켜거나 .env 의 COOKIES_SOURCE 로 쿠키를 걸면 풀릴 수 있다",
  "rate-limited": "잦으면 .env 의 COOKIES_SOURCE 로 쿠키를 건다",
};

/** 로그 줄 끝에 붙일 안내. 없으면 빈 글 */
function operatorHint(kind: string): string {
  return HINTS[kind] ? ` (운영자: ${HINTS[kind]})` : "";
}

export { operatorHint };
