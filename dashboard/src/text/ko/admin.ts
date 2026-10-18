// 운영자 패널 공통

/** 권한 수준 오버라이드의 계층 이름표와 설명 */
const tiers = {
  moderator: { label: "서버 관리자", desc: "같은 음성 채널에 있지 않아도 조작이 가능해요. (관리, 차단, 추방, 타임아웃 권한 중 하나 보유)" },
  dj: { label: "DJ", desc: "재생 조작은 되지만 봇과 같은 음성 채널에 있어야 해요." },
  user: { label: "일반 유저", desc: "DJ 역할을 지정한 서버에서는 조작이 막히고 곡 추가만 할 수 있어요." },
};

// 패널 틀
const back = "뒤로";
const tabsLabel = "운영자 패널 탭";
const unsavedTab = "저장하지 않은 변경이 있어요";
const dbNotYet = "캐시 DB 는 아직 준비되지 않았어요";
const leaveConfirm = { title: "저장하지 않고 나갈까요?", body: "변경한 설정이 저장되지 않았어요. 나가면 변경 내용이 사라져요.", confirm: "나가기" };
/** 탭 이름 */
const tabs = {
  status: "봇 상태",
  guilds: "서버 관리",
  db: "캐시 DB",
  logs: "실시간 로그",
  settings: "일반",
  youtube: "유튜브",
  keys: "API 키",
  presence: "상태 문구",
  appearance: "디스플레이",
  autoplay: "자동재생",
  ai: "AI 보조",
  backup: "백업 · 초기화",
  info: "봇 정보",
  dev: "개발자 옵션",
};
const failed = { status: "봇 상태를 읽지 못했어요.", guilds: "서버 목록을 읽지 못했어요." };

export { tiers, back, tabsLabel, unsavedTab, dbNotYet, leaveConfirm, tabs, failed };
