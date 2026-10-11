// SponsorBlock 에서 건너뛸 수 있는 구간 종류. 설정 검사(src/config/index.ts) · 조회(sources/sponsor-block) · 설정 화면이 같이 본다.

const CATEGORIES = ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "hook", "filler", "music_offtopic"] as const;
type SkipCategory = (typeof CATEGORIES)[number];
// 설정 · 저장값은 글자로 와서 견주므로 글자 목록으로도 둔다
const SKIP_CATEGORIES: readonly string[] = CATEGORIES;

// 화면에 보일 이름. SponsorBlock 확장 프로그램의 한국어 번역을 그대로 쓴다(무대가 = 대가 없는)
const CATEGORY_LABELS: Readonly<Record<SkipCategory, string>> = {
  music_offtopic: "음악이 아닌 구간",
  intro: "인트로/무음 구간",
  outro: "최종 화면 구간",
  sponsor: "후원이나 협찬 구간",
  selfpromo: "무대가 홍보 구간",
  interaction: "상호작용 알림 구간",
  preview: "미리보기/요약 구간",
  hook: "후킹/인사말",
  filler: "잡담/농담",
};

// 구간 종류마다의 설명. 설정 화면이 이름 옆에 보인다
const CATEGORY_DESCRIPTIONS: Readonly<Record<SkipCategory, string>> = {
  music_offtopic: "이 구간은 뮤직비디오에서만 해당합니다.",
  intro: "반복되는 애니메이션이나 정적 프레임과 같은 내용을 포함하는 구간",
  outro: "최종 화면이나 크레딧 내용을 포함하는 구간",
  sponsor: "유료 광고, 유료 협찬과 같은 직접적인 광고 내용을 포함하는 구간",
  selfpromo: '"후원이나 협찬 구간"과 유사하지만, 자발적으로 홍보하는 내용을 포함하는 구간',
  interaction: "좋아요, 구독, 팔로우를 요청하는 구간",
  preview: "동영상의 뒷부분에서 반복되는 현재 동영상 또는 시리즈의 다른 동영상에 나온 정보를 보여주는 구간",
  hook: "후속 편에 대한 내용이나, 인사말이 있는 구간",
  filler: "전반적인 동영상의 주제를 이해하는 데 필요 없는 잡담이나 농담이 포함되는 구간",
};

// 구간을 하나도 고르지 않았다는 값(운영 조절값). 빈 값은 기본값이라 따로 둔다. 구간 id 가 아니라 읽을 때 걸러져 빈 목록이 된다
const NO_CATEGORIES = "none";

const isSkipCategory = (id: unknown): id is SkipCategory => CATEGORIES.some((one) => one === id);
const categoryLabel = (id: string) => (isSkipCategory(id) ? CATEGORY_LABELS[id] : id);
const categoryDescription = (id: string) => (isSkipCategory(id) ? CATEGORY_DESCRIPTIONS[id] : "");

export { SKIP_CATEGORIES, CATEGORY_LABELS, NO_CATEGORIES, isSkipCategory, categoryLabel, categoryDescription };
export type { SkipCategory };
