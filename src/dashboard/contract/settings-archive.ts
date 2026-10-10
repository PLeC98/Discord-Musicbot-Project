// 설정 내보내기 · 가져오기(운영자 패널 설정 탭). /api/admin/settings-archive
// 내보내기는 ZIP 하나: settings.json(사람이 읽는 JSON) + favicon/(올린 그림). 비밀 · 쿠키 · 세션은 들어가지 않는다.
// 가져오기는 파일을 올려 미리 보고(preview), 고른 항목만 덮어쓴다(import?items=…)

/** 가져올 수 있는 항목. 설정 문서 넷 · 운영 조절값 · 서버별 설정 · 파비콘 그림 */
const ARCHIVE_ITEMS = ["tunables", "genres", "status", "ai", "ai-prompt", "guilds", "favicon"] as const;
type ArchiveItem = (typeof ARCHIVE_ITEMS)[number];

const isArchiveItem = (value: string): value is ArchiveItem => (ARCHIVE_ITEMS as readonly string[]).includes(value);

/** 올릴 수 있는 파일 크기(그림이 아홉 장 들어도 넉넉하게) */
const ARCHIVE_MAX_BYTES = 32 * 1024 * 1024;

/**
 * 미리 보기 한 줄. inFile: 파일에 있나, same: 지금 값과 같나, problems: 검사에 걸린 것(있으면 가져올 수 없다),
 * count: 서버별 설정은 서버 수, 파비콘은 그림 수(나머지는 null)
 */
type ArchiveRow = { item: ArchiveItem; inFile: boolean; same: boolean; problems: string[]; count: number | null };
/** 미리 보기. 파일을 만든 때 · 봇 버전(파일에 적힌 그대로) */
type ArchivePreview = { exportedAt: string | null; botVersion: string | null; rows: ArchiveRow[] };
/** 가져오기의 답. 덮어쓴 항목 */
type ArchiveImported = { imported: ArchiveItem[] };

export { ARCHIVE_ITEMS, ARCHIVE_MAX_BYTES, isArchiveItem };
export type { ArchiveItem, ArchiveRow, ArchivePreview, ArchiveImported };
