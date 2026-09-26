// SponsorBlock 에서 건너뛸 수 있는 구간 종류. 설정 검사(config.ts) · 조회(sources/sponsorBlock) · 설정 화면이 같이 본다.

const SKIP_CATEGORIES: readonly string[] = ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "hook", "filler", "music_offtopic"];

// 화면에 보일 이름. SponsorBlock 확장 프로그램의 한국어 번역을 그대로 쓴다(무대가 = 대가 없는)
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
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

const categoryLabel = (id: string) => CATEGORY_LABELS[id] || id;

export { SKIP_CATEGORIES, CATEGORY_LABELS, categoryLabel };
