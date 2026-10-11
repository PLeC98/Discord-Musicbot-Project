// 입력 부품(고르기 · 여럿 고르기 · 칩 · 태그 · 구간 · 이모지 · 마크다운 편집)의 글

/** 고르기 칸의 찾기(후보가 많을 때) */
const searchAmong = (count: number) => `${count}개 중에서 찾기`;
const pick = "고르기";
/** 여럿 고르기에서 둘 이상 골랐을 때 */
const pickedSummary = (first: string, more: number) => `${first} 외 ${more}개`;
const emojiChange = "이모지 바꾸기";
const emojiPick = "이모지 고르기";
const rangeStart = (label: string) => `${label} 시작`;
const rangeEnd = (label: string) => `${label} 끝`;
const typeForSuggestions = "입력하면 후보가 표시돼요";
const suggestLoading = "후보를 찾는 중이에요";
const suggestFailed = "후보를 받지 못했어요. Enter 로 그대로 넣을 수 있어요";
const suggestNone = "후보가 없어요. Enter 로 그대로 넣을 수 있어요";
/** 마크다운 링크를 넣을 때 고른 글이 없으면 그 자리 */
const linkText = "링크 글";
/** 마크다운 미리보기에서 멘션 자리(누구인지 모른다) */
const mentionUser = "@사용자";
const mentionRole = "@역할";
const mentionChannel = "#채널";

// 이모지 고르기
const emojiSearch = "이름 · 디스코드 이름 · 이모지 붙여넣기";
const emojiSearchClear = "검색어 지우기";
const emojiLoading = "불러오는 중...";
const emojiNone = "찾는 이모지가 없어요.";
const emojiClear = "비우기";
const emojiLoadFailed = "목록을 불러오지 못했어요. 대시보드를 다시 빌드했다면 새로고침해 주세요.";
const colorArea = "채도 · 밝기";
/** 채도 · 밝기 판을 읽어 줄 때(퍼센트) */
const colorAreaValue = (saturation: number, brightness: number) => `채도 ${saturation}% · 밝기 ${brightness}%`;
const colorHue = "색상";
const colorDefault = "기본 색으로";

// 마크다운 서식 도구(디스코드와 같은 단축키는 부르는 쪽이 붙인다)
const format = {
  bold: "굵게",
  italic: "기울임",
  underline: "밑줄",
  strike: "취소선",
  spoiler: "스포일러",
  h1: "제목 1",
  h2: "제목 2",
  h3: "제목 3",
  small: "작은 글씨",
  quote: "인용",
  list: "목록",
  numbered: "번호 목록",
  code: "코드",
  codeBlock: "코드 블록",
  link: "링크",
  timestamp: "현재 시간 (시간대 자동 변환)",
};

export { searchAmong, pick, pickedSummary, emojiChange, emojiPick, rangeStart, rangeEnd, typeForSuggestions, suggestLoading, suggestFailed, suggestNone, linkText, mentionUser, mentionRole, mentionChannel, emojiSearch, emojiSearchClear, emojiLoading, emojiNone, emojiClear, emojiLoadFailed, colorArea, colorAreaValue, colorHue, colorDefault, format };
