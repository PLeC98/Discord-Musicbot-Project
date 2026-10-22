// 설정 대화상자(계정 메뉴): 이 브라우저의 화면 설정 · 계정(로그인한 기기)

const title = "설정";
const groupTheme = "테마";
const artColor = { label: "앨범아트 색 사용", desc: "재생 중인 곡의 앨범아트로 테마 색을 만들어요." };
const artWallpaper = { label: "앨범아트 배경", desc: "재생 중인 곡의 앨범아트를 배경에 흐리게 표시해요." };
const groupScreen = "화면";
const clock = { label: "시계", desc: "PC 화면의 사이드바에 시계를 표시해요." };

const groupAccount = "계정";
const devices = {
  title: "로그인한 기기",
  current: "이 기기",
  unknown: "알 수 없는 기기",
  unknownDesc: "이 기능 전에 로그인한 뒤 쓰지 않은 세션",
  private: "내부망",
  now: "지금",
  /** 브라우저 · OS. 하나만 알면 그것만 */
  name: (browser: string | null, os: string | null) => [browser, os].filter(Boolean).join(" · "),
  signOut: "로그아웃",
  signOutOthers: "다른 기기 모두 로그아웃",
  confirmTitle: "다른 기기에서 모두 로그아웃할까요?",
  confirmBody: (n: number) => `이 기기를 뺀 ${n}곳의 로그인이 끝나요.`,
  done: (n: number) => `다른 기기 ${n}곳에서 로그아웃했어요`,
  loadFailed: "로그인한 기기를 읽지 못했어요.",
  failed: "로그아웃하지 못했어요.",
  attribution: "IP Geolocation by DB-IP",
};

export { title, groupTheme, artColor, artWallpaper, groupScreen, clock, groupAccount, devices };
