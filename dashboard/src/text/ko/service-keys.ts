// 운영자 패널: API 키 탭의 바깥 서비스 키(Spotify · Last.fm · ListenBrainz)

/** 서비스마다: 제목 · 무엇에 쓰나 · 툴팁 · 키 받는 곳 · 칸 이름 */
const services = {
  spotify: {
    title: "Spotify",
    purpose: "스포티파이 트랙 · 앨범 링크를 열 때 써요.",
    tip: "키가 없으면 트랙 · 앨범 링크는 열지 못하고, 재생목록 · 아티스트는 키 없이 열어요.\nSpotify for Developers 의 Dashboard 에서 앱을 만들면 받아요.",
    link: "https://developer.spotify.com/dashboard",
    fields: { clientId: "Client ID", clientSecret: "Client Secret" },
  },
  lastfm: {
    title: "Last.fm",
    purpose: "자동재생 장르의 Last.fm 소스가 써요.",
    tip: "API 계정을 만들면 키와 시크릿을 주는데, 키만 넣으면 돼요.",
    link: "https://www.last.fm/api/account/create",
    fields: { apiKey: "API 키" },
  },
  listenbrainz: {
    title: "ListenBrainz",
    purpose: "자동재생 장르의 ListenBrainz 소스가 써요.",
    tip: "ListenBrainz 설정 페이지에 있는 사용자 토큰이에요.",
    link: "https://listenbrainz.org/settings/",
    fields: { token: "사용자 토큰" },
  },
};

const groupTitle = "서비스 키";
const groupDesc = "넣은 값은 암호화해 두고 다시 보여 주지 않아요. 넣거나 지우려면 로그인한 지 10분 안이어야 해요.";
const linkLabel = "키 받는 곳";
/** 칸의 상태 */
const state = {
  none: "없음",
  ok: (last4: string | null) => (last4 ? `저장됨 · 끝 ${last4}` : "저장됨"),
  again: "다시 넣어 주세요",
};
const againTip = "암호화 키(SECRETS_KEY)가 바뀌었거나 저장된 값이 망가져서 풀 수 없어요.";
/** 바꾼 때 */
const updated = (when: string) => `${when}에 바꿈`;
const placeholderNew = "붙여넣기";
const placeholderReplace = "바꾸려면 새 값을 넣어요";
const save = "저장";
const saving = "저장 중…";
const test = "연결 시험";
const testing = "시험 중…";
const clear = "이 서비스의 키 모두 지우기";
const savedDone = (title: string) => `${title} 키를 저장했어요`;
const clearedDone = (title: string) => `${title} 키를 지웠어요`;
const saveFailed = (title: string) => `${title} 키를 저장하지 못했어요.`;
const clearFailed = (title: string) => `${title} 키를 지우지 못했어요.`;
const testFailed = (title: string) => `${title} 연결 시험을 하지 못했어요.`;
const loadFailed = "서비스 키 상태를 읽지 못했어요.";
/** 연결 시험 결과 */
const check = {
  ok: "연결됐어요. 키가 맞아요.",
  missing: "저장된 키가 없어요.",
  rejected: "서비스가 키를 거절했어요. 값을 확인해 주세요.",
  unreachable: "서비스에 닿지 못했어요. 잠시 뒤 다시 시험해 주세요.",
};

export { services, groupTitle, groupDesc, linkLabel, state, againTip, updated, placeholderNew, placeholderReplace, save, saving, test, testing, clear, savedDone, clearedDone, saveFailed, clearFailed, testFailed, loadFailed, check };
