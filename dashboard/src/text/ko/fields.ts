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

export { searchAmong, pick, pickedSummary, emojiChange, emojiPick, rangeStart, rangeEnd, typeForSuggestions, suggestLoading, suggestFailed, suggestNone, linkText };
