// SponsorBlock 에서 건너뛸 수 있는 구간 종류. 설정 검사(config.ts) · 조회(sources/sponsorBlock) · 설정 화면이 같이 본다.

const SKIP_CATEGORIES: readonly string[] = ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "hook", "filler", "music_offtopic"];

export { SKIP_CATEGORIES };
