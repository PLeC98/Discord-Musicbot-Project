// SponsorBlock에서 건너뛸 수 있는 구간 종류. 설정 검사(src/config/index.ts), 조회(sources/sponsor-block), 설정 화면이 같이 본다. 이름과 설명은 문구표(locales/<언어>/bot/sponsor)에 있다.

const CATEGORIES = ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "hook", "filler", "music_offtopic"] as const;
type SkipCategory = (typeof CATEGORIES)[number];
// 설정, 저장값은 문자열로 와서 비교하므로 문자열 목록으로도 둔다
const SKIP_CATEGORIES: readonly string[] = CATEGORIES;

// 구간을 하나도 선택하지 않았다는 값(운영 설정값). 빈 값은 기본값이라 따로 둔다. 구간 id가 아니라 읽을 때 필터링돼 빈 목록이 된다
const NO_CATEGORIES = "none";

const isSkipCategory = (id: unknown): id is SkipCategory => CATEGORIES.some((one) => one === id);

export { SKIP_CATEGORIES, NO_CATEGORIES, isSkipCategory };
export type { SkipCategory };
