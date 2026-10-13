// 설정 내보내기 · 불러오기(운영자 패널 백업 탭). /api/admin/settings-archive
// 내보내기는 ZIP 하나: settings.json(사람이 읽는 JSON) + favicon/(파비콘 폴더: index.json · 이미지). 종류는 둘(settings: 봇 설정만, full: 암호화된 설정까지). .env · 세션은 어느 쪽에도 없다.
// 불러오기는 파일을 올려 미리 보고(preview), 고른 항목만 덮어쓴다(import?items=…)

/** settings: 봇 설정만(남에게 나눠 줄 것), full: 서버별 설정 · 키 · 쿠키의 암호문까지 */
const ARCHIVE_KINDS = ["settings", "full"] as const;
type ArchiveKind = (typeof ARCHIVE_KINDS)[number];
const isArchiveKind = (value: string): value is ArchiveKind => (ARCHIVE_KINDS as readonly string[]).includes(value);

/** 가져올 수 있는 항목. 설정 문서 넷 · 운영 조절값 · 서버별 설정 · 키 · 쿠키(암호문) · 파비콘 */
const ARCHIVE_ITEMS = ["tunables", "genres", "status", "ai", "ai-prompt", "guilds", "secrets", "favicon"] as const;
type ArchiveItem = (typeof ARCHIVE_ITEMS)[number];

const isArchiveItem = (value: string): value is ArchiveItem => (ARCHIVE_ITEMS as readonly string[]).includes(value);

/** 올릴 수 있는 파일 크기(그림이 아홉 장 들어도 넉넉하게) */
const ARCHIVE_MAX_BYTES = 32 * 1024 * 1024;

/**
 * 미리 보기 한 줄. inFile: 파일에 있나, same: 지금 값과 같나, problems: 검사에 걸린 것(있으면 가져올 수 없다),
 * warnings: 가져올 수는 있지만 알아 둘 것(바깥으로 나가는 값이 바뀐다 · 건너뛰는 값), count: 서버 수 · 쓸 수 있는 키 수 · 그림 수(나머지는 null)
 */
type ArchiveRow = { item: ArchiveItem; inFile: boolean; same: boolean; problems: string[]; warnings: string[]; count: number | null };
/** 미리 보기. 파일의 종류 · 만든 때 · 봇 버전(파일에 적힌 그대로) */
type ArchivePreview = { kind: ArchiveKind; exportedAt: string | null; botVersion: string | null; rows: ArchiveRow[] };
/** 가져오기의 답. 덮어쓴 항목 */
type ArchiveImported = { imported: ArchiveItem[] };

export { ARCHIVE_KINDS, ARCHIVE_ITEMS, ARCHIVE_MAX_BYTES, isArchiveKind, isArchiveItem };
export type { ArchiveKind, ArchiveItem, ArchiveRow, ArchivePreview, ArchiveImported };
