// 운영자 패널: API 키 탭의 바깥 서비스 키(Spotify · Last.fm · ListenBrainz)

/** 서비스마다: 제목 · 무엇에 쓰나 · 툴팁 · 키 발급 주소 · 칸 이름 */
const services = {
  spotify: {
    title: "Spotify",
    purpose: "스포티파이 링크를 공식 API 로 열 때 써요. 넣지 않아도 링크는 열려요.",
    tip: "넣으면 트랙 · 앨범 · 아티스트를 공식 API 로 먼저 열고, 실패하면 키 없이 쓰는 웹 플레이어 경로로 열어요. 재생목록은 늘 웹 플레이어 경로예요.\nSpotify for Developers 의 Dashboard 에서 앱을 만들면 발급돼요.",
    link: "https://developer.spotify.com/dashboard",
    fields: { clientId: "Client ID", clientSecret: "Client Secret" },
  },
  lastfm: {
    title: "Last.fm",
    purpose: "자동재생 장르의 Last.fm 출처에서 써요.",
    tip: "API 계정을 만들면 키와 시크릿이 발급되는데, 키만 입력하면 돼요.",
    link: "https://www.last.fm/api/account/create",
    fields: { apiKey: "API 키" },
  },
  listenbrainz: {
    title: "ListenBrainz",
    purpose: "자동재생 장르의 ListenBrainz 출처에서 써요.",
    tip: "ListenBrainz 설정 페이지에 있는 사용자 토큰이에요.",
    link: "https://listenbrainz.org/settings/",
    fields: { token: "사용자 토큰" },
  },
};

const groupTitle = "서비스 키";
const linkLabel = "키 발급";
/** 칸의 상태 */
const state = {
  none: "없음",
  ok: (last4: string | null) => (last4 ? `저장됨 · 끝 ${last4}` : "저장됨"),
  again: "다시 입력해 주세요",
};
const againTip = "암호화 키(SECRETS_KEY)가 바뀌었거나 저장된 값이 손상되어 복호화할 수 없어요.";
/** 바꾼 때 */
const updated = (when: string) => `${when}에 변경`;
const placeholderNew = "붙여넣기";
const placeholderReplace = "변경하려면 새 값을 입력해요";
const save = "저장";
const saving = "저장 중…";
const test = "연결 테스트";
const testing = "테스트 중…";
const clear = "이 서비스의 키 모두 삭제";
const savedDone = (title: string) => `${title} 키를 저장했어요`;
const clearedDone = (title: string) => `${title} 키를 삭제했어요`;
const saveFailed = (title: string) => `${title} 키를 저장하지 못했어요.`;
const clearFailed = (title: string) => `${title} 키를 삭제하지 못했어요.`;
const testFailed = (title: string) => `${title} 연결 테스트를 하지 못했어요.`;
const loadFailed = "서비스 키 상태를 읽지 못했어요.";
/** 연결 시험 결과 */
const check = {
  ok: "연결됐어요. 키가 맞아요.",
  missing: "저장된 키가 없어요.",
  rejected: "서비스가 키를 거절했어요. 값을 확인해 주세요.",
  unreachable: "서비스에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
};

export { services, groupTitle, linkLabel, state, againTip, updated, placeholderNew, placeholderReplace, save, saving, test, testing, clear, savedDone, clearedDone, saveFailed, clearFailed, testFailed, loadFailed, check };
