// 드롭다운의 선택지와 필터링. 단일 선택 · 다중 선택이 같이 쓴다
import { koMatch } from "../../../src/rules/ko-search.ts";

/** 선택지 하나. 값은 저장할 것, label 은 보일 것, group 이 있으면 그 이름 아래에 묶어 보인다, color 가 있으면 이름 앞에 그 색 점(로그 카테고리처럼 색으로도 가리키는 것) */
type OptionValue = string | number;
type Option = { value: OptionValue; label: string; group?: string; color?: string };

/** 검색어가 이름이나 값에 들어 있는 선택지(한국어는 조합 중인 글자 · 초성으로도, utils/ko-search). keep 이 참인 것은 검색어와 무관하게 남긴다(선택한 것) */
function filterOptions(options: Option[], term: string, keep: (value: OptionValue) => boolean = () => false): Option[] {
  if (!term.trim()) return options;
  return options.filter((one) => keep(one.value) || koMatch(String(one.label), term) || koMatch(String(one.value), term));
}

export { filterOptions };
export type { Option, OptionValue };
