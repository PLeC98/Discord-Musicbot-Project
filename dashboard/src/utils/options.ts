// 고르기 칸의 선택지와 거르기. 하나 고르기 · 여럿 고르기가 같이 쓴다

/** 선택지 하나. 값은 저장할 것, label 은 보일 것 */
type OptionValue = string | number;
type Option = { value: OptionValue; label: string };

/** 검색어가 이름이나 값에 들어 있는 선택지. keep 이 참인 것은 검색어와 무관하게 남긴다(고른 것) */
function filterOptions(options: Option[], term: string, keep: (value: OptionValue) => boolean = () => false): Option[] {
  const want = term.trim().toLowerCase();
  if (!want) return options;
  return options.filter((one) => keep(one.value) || String(one.label).toLowerCase().includes(want) || String(one.value).toLowerCase().includes(want));
}

export { filterOptions };
export type { Option, OptionValue };
