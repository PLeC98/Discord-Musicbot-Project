// 로그 문구: 재생, 곡 찾기 실패의 이유(rules/failure-reason, rules/operator-hints). 플레이어와 곡 찾기의 실패 줄에 값으로 들어간다

const reason = {
  /** 무엇이 막았는지가 분명한 실패 종류의 이름(키는 rules/error-kind 종류 이름의 카멜 표기) */
  ytAgeCookiesInvalid: () => `연령 제한, 쿠키가 유효하지 않음. 쿠키를 다시 입력해 주세요`,
  ageContentOff: () => `연령 제한 콘텐츠 꺼짐`,
  ageChannelOnly: () => `연령 제한 채널이 아님`,
  ytBotCheck: () => `봇 감지`,
  unavailableContents: () => `없거나 비공개 또는 삭제된 곡`,
  unavailablePlaylist: () => `없거나 비공개인 재생목록`,
  scPreviewOnly: () => `미리듣기만 열린 곡`,
  geoBlocked: () => `지역 차단`,
  rateLimited: () => `요청 제한`,
  spNoYoutubeMatch: () => `유튜브에서 같은 곡을 못 찾음`,
  /** 쿠키가 없거나 쿠키로도 열리지 않는 연령 제한 영상. configured: 쿠키를 설정해 두었다 */
  ytAgeNoCookies: ({ configured }: { configured: boolean }) => `연령 제한, ${configured ? "쿠키로도 재생 불가" : "쿠키 없음"}`,
  /** 운영자가 설정으로 풀 수 있는 실패의 안내 */
  hintBotCheck: () => `bgutil(POToken)을 켜면 풀릴 수 있다`,
  hintRateLimited: () => `유튜브면 요청이 한도를 넘은 것이다(yt-dlp 위키: 로그인 없는 세션은 시간당 영상 약 300개). 길어야 한 시간이면 풀린다(yt-dlp). 사운드클라우드는 요청이 몰리면 IP를 몇 분 막는다`,
  /** 실패 이유 한 줄. why: 종류 이름이나 오류의 첫 줄, hint: 운영자 안내(없으면 빈 글), id: 유튜브 영상 ID(없으면 빈 글) */
  line: ({ why, hint, id }: { why: string; hint: string; id: string }) => `${why}${hint ? ` (운영자: ${hint})` : ""}${id ? ` (${id})` : ""}`,
};

export { reason };
