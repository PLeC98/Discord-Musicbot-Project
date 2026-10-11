// 틀: 위 막대 · 세로 막대 · 계정 메뉴 · 알림함 · 세션 · 시계 · 없는 주소

const notFoundTitle = "페이지 없음";
const notFound = "페이지를 찾을 수 없어요!\n주소가 잘못되었거나 없어진 페이지예요.";

// 위 막대
const topBar = "위 막대";
const serverList = "서버 목록";
const serverSettingsSuffix = "- 서버 설정";
const adminPanel = "운영자 패널";
const openMenu = "메뉴 열기";
/** 권한 수준 오버라이드 중임을 알리는 줄. tier 는 고른 계층의 이름 */
const viewingAs = "권한으로 보는 중";
const clearViewAs = "해제";

// 세로 막대(서버 막대)
const serverRail = "서버";
const sidebarWidth = "사이드바 폭";
const sidebarExpand = "사이드바 펼치기";
const sidebarCollapse = "사이드바 접기";
const closeMenu = "메뉴 닫기";
const allServers = "모든 서버";

// 계정 메뉴
const brightness = "화면 밝기";
const settings = "설정";
const licenses = "라이선스";
const logout = "로그아웃";
const modeDark = "어둡게";
const modeLight = "밝게";
const modeSystem = "시스템";

// 알림함
const inbox = "알림";
const inboxUnread = (count: number) => `알림 ${count}개 안 읽음`;
const inboxClear = "지우기";
const inboxRemoveOne = "이 알림 지우기";
const inboxEmpty = "알림 없음";

// 세션이 끝났거나 연결이 끊겼을 때
const loginAgain = "다시 로그인";
const retry = "다시 시도";
const reconnecting = "실시간 갱신(SSE)이 끊어져 다시 연결하는 중이에요.";
const loginAgainBody = "로그인 창에서 다시 로그인하면 이 탭에서 이어서 쓸 수 있어요. 고치던 내용은 그대로 남아 있어요.";
const later = "나중에";
const loggedIn = "로그인했어요";
const openLoginWindow = "로그인 창 열기";
/** 로그인 창을 연 뒤 대화상자에 */
const loginWindowOpen = "로그인 창에서 로그인을 마치면 그 창은 저절로 닫히고 여기서 이어서 해요.";
/** 로그인 창의 끝(/login-done) */
const loginDoneTitle = "로그인했어요";
const loginDoneBody = "원래 탭에서 이어서 해요. 이 창이 닫히지 않으면 직접 닫아 주세요.";
const notLoggedInYet = "아직 로그인되지 않았어요. 로그인 창에서 로그인을 마쳐 주세요.";
const reauthBody = "로그인 창에서 다시 로그인하면 하던 일을 이어서 해요. 고치던 내용은 그대로 남아 있어요.";

// 시계(사이드바)
const clockLabel = (hh: string, mm: string) => `${hh}시 ${mm}분`;
const year = (n: number) => `${n}년`;
const month = (n: number) => `${n}월`;
const day = (n: number) => `${n}일`;

export {
  notFoundTitle,
  notFound,
  topBar,
  serverList,
  serverSettingsSuffix,
  adminPanel,
  openMenu,
  viewingAs,
  clearViewAs,
  serverRail,
  sidebarWidth,
  sidebarExpand,
  sidebarCollapse,
  closeMenu,
  allServers,
  brightness,
  settings,
  licenses,
  logout,
  modeDark,
  modeLight,
  modeSystem,
  inbox,
  inboxUnread,
  inboxClear,
  inboxRemoveOne,
  inboxEmpty,
  loginAgain,
  retry,
  reconnecting,
  loginAgainBody,
  later,
  loggedIn,
  openLoginWindow,
  loginWindowOpen,
  loginDoneTitle,
  loginDoneBody,
  notLoggedInYet,
  reauthBody,
  clockLabel,
  year,
  month,
  day,
};
