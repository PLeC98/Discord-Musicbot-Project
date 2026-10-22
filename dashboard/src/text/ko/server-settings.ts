// 서버 설정 화면(서버 관리 권한이 있는 사람)

const backToPlayer = "재생 화면으로";
const back = "돌아가기";
const loadFailed = "설정을 불러오지 못했어요.";
const saveFailed = "설정을 저장하지 못했어요.";

/** 봇 전용 채널 */
const channel = { title: "봇 전용 채널", desc: "명령어 없이 링크나 검색어만 입력해도 재생돼요. 컨트롤 패널과 공지도 이 채널을 우선 사용해요.", none: "지정 안 함" };

/** DJ 역할. 고를 수 있는 수는 max */
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
  /** 기본값 단추: 넓은 카드는 "기본값 · ", 좁으면 "기본 " */
  defaultLong: "기본값 · ",
  defaultShort: "기본 ",
  songs: (count: number) => `${count}곡`,
  custom: "직접 입력",
  unit: "곡",
  invalid: (min: number, max: number) => `${min}~${max}곡 사이의 정수로 입력해 주세요.`,
  /** 지금 값 안내: 앞 · 값 · 뒤로 나눠 값만 굵게 그린다 */
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

export { backToPlayer, back, loadFailed, saveFailed, channel, dj, sponsor, playlistAdd, agePlace };
