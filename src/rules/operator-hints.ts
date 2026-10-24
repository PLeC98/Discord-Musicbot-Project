// 운영자가 설정으로 풀 수 있는 실패의 안내. 사용자 문장(ui/error-messages)에는 무엇이 안 됐는지만 쓰고,
// 고치는 법은 운영자가 보는 로그에 이 안내를 붙인다. 곡 찾기(sources)와 재생(player)이 같이 쓴다.
// 쿠키는 권하지 않는다. 연령 제한 영상의 다시 묻기에만 붙고, yt-dlp 도 계정이 있어야 여는 콘텐츠에만 쓰라고 한다(계정 정지 위험)

const HINTS: Record<string, string> = {
  "yt-bot-check": "bgutil(POToken)을 켜면 풀릴 수 있다",
  "rate-limited": "유튜브면 요청이 한도를 넘은 것이다(yt-dlp 위키: 로그인 없는 세션은 시간당 영상 약 300개). 길어야 한 시간이면 풀린다(yt-dlp). 사운드클라우드는 요청이 몰리면 IP 를 몇 분 막는다",
};

/** 로그 줄 끝에 붙일 안내. 없으면 빈 문자열 */
function operatorHint(kind: string): string {
  return HINTS[kind] ? ` (운영자: ${HINTS[kind]})` : "";
}

export { operatorHint };
