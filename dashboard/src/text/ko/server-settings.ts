// 서버 설정 화면(카드마다 볼 수 있는 계층은 서버의 dashboard/settings-cards)

const backToPlayer = "재생 화면으로";
const back = "돌아가기";
const loadFailed = "설정을 불러오지 못했어요.";
const saveFailed = "설정을 저장하지 못했어요.";

/**
 * 상주 모드(디스코드 /247). enabledIn 은 켜져 있을 때의 스위치 글: 채널 이름이 길면 이름만 줄이게 앞뒤를 나눈다(볼 수 없는 채널이면 enabled).
 * locked: 바꿀 수 없을 때 잠근 스위치의 툴팁(지금 상태). 바꿀 수 없는 까닭은 봇 문장표의 거절 문장
 */
const stay = {
  title: "상주 모드",
  desc: "켜면 사람이 없어도 음성 채널에서 나가지 않고 계속 머물러요.",
  enable: "상주 모드 켜기",
  /** 켜져 있지만 머무는 채널을 볼 수 없을 때 */
  enabled: "상주 모드 켜짐",
  enabledIn: { before: "상주 모드 켜짐 (", after: ")" },
  locked: (on: boolean) => (on ? "켜져 있지만 조작할 수 없어요!" : "꺼져 있지만 조작할 수 없어요!"),
  failed: "상주 모드를 바꾸지 못했어요.",
};

/** 볼륨 정규화(디스코드 /normalize). locked, failed 는 상주 모드와 같은 자리 */
const normalize = {
  title: "볼륨 정규화",
  desc: "곡과 영상마다 제각각인 볼륨을 비슷하게 맞춰요.",
  enable: "볼륨 정규화 켜기",
  enabled: "볼륨 정규화 켜짐",
  locked: stay.locked,
  failed: "볼륨 정규화를 바꾸지 못했어요.",
};

/** 봇 전용 채널 */
const channel = { title: "봇 전용 채널", desc: "명령어 없이 링크나 검색어만 입력해도 재생돼요. 컨트롤 패널과 공지도 이 채널을 우선 사용해요.", none: "지정 안 함" };

/** DJ 역할. 선택할 수 있는 수는 max */
const dj = {
  title: "DJ 역할",
  desc: "재생 제어를 역할 보유자와 서버 관리자로 제한해요. 설정하지 않으면 모든 유저가 제어할 수 있어요.",
  noRoles: "이 서버에 지정할 수 있는 역할이 없어요",
  noMatch: "일치하는 역할이 없어요",
  picked: (count: number, max: number) => `선택됨: ${count} / ${max}`,
};

/** SponsorBlock 자동 스킵 */
const sponsor = {
  title: "SponsorBlock 자동 스킵",
  desc: "뮤직비디오의 인트로, 최종 화면, 음악이 아닌 구간 등을 SponsorBlock 데이터를 사용해 건너뛰어요.",
  masterOff: "봇 전역 설정에서 SponsorBlock이 꺼져 있어 이 서버 설정은 적용되지 않아요.",
  enable: "이 서버에서 자동 스킵 사용",
  categories: "건너뛸 구간 종류",
  help: "각 구간 설명 보기",
  helpLabel: "각 구간 설명",
};

/** 한 번에 넣을 재생목록 곡 수 */
const playlistAdd = {
  title: "한 번에 넣을 재생목록 곡 수",
  desc: "많은 곡이 포함된 재생목록을 한 번에 다 넣지 않고 설정한 곡만큼만 넣어요. 남은 곡은 이어서 넣을 수 있어요.",
  choose: "곡 수 선택",
  /** 기본값 버튼: 넓은 카드는 "기본값 · ", 좁으면 "기본 " */
  defaultLong: "기본값 · ",
  defaultShort: "기본 ",
  songs: (count: number) => `${count}곡`,
  custom: "직접 입력",
  unit: "곡",
  invalid: (min: number, max: number) => `${min}~${max}곡 사이의 정수로 입력해 주세요.`,
  /** 지금 값 안내: 앞, 값, 뒤로 나눠 값만 굵게 그린다 */
  effectiveBefore: "재생목록을 넣으면 한 번에 ",
  effectiveAfter: (min: number, max: number) => `씩 들어가요 · ${min}~${max}곡 · 디스코드에서는 `,
};

/** 연령 제한 콘텐츠를 틀 곳(봇 운영자가 연령 제한 콘텐츠를 켰을 때만 보인다) */
const agePlace = {
  title: "연령 제한 콘텐츠",
  desc: "연령 제한이 걸린 곡을 어떤 음성 채널에서 재생 가능하게 할지 정해요.",
  choose: "틀 곳 선택",
  channel: "연령 제한 채널에서만",
  all: "모든 채널에서",
  allWarning: "이 서버의 모든 음성 채널에서 연령 제한이 걸린 곡을 재생할 수 있어요. 봇은 청취자의 연령을 확인하지 않아요.",
};

/** 봇 내보내기(디스코드에서 봇을 추방할 수 있는 사람). 확인 대화상자는 운영자 패널의 나가기와 같은 결 */
const leave = {
  title: "봇 내보내기",
  desc: "이 서버에서 봇을 내보내요. 다시 쓰려면 봇을 다시 초대해야 해요.",
  button: "봇 내보내기",
  confirmTitle: (name: string) => `'${name}'에서 봇을 내보낼까요?`,
  confirmBody: "되돌릴 수 없어요. 재생 중인 곡과 대기열, 상주 모드는 사라지고, 서버 설정은 남아서 다시 초대하면 그대로 써요.",
  done: (name: string) => `'${name}'에서 봇을 내보냈어요.`,
  failed: "봇을 내보내지 못했어요.",
};

export { backToPlayer, back, loadFailed, saveFailed, stay, normalize, channel, dj, sponsor, playlistAdd, agePlace, leave };
