// 설정 내보내기 · 불러오기(운영자 패널 백업 탭). /api/admin/settings-archive
// 내보내기는 ZIP 하나: settings.json(사람이 읽는 목록 · 설정) + 종류에 따라 favicon/(파비콘 폴더: index.json · 이미지) · login-background/(배경 기록 index.json · 배경마다의 파일). .env · 세션은 어느 쪽에도 없다.
// 대시보드의 백업은 쓰임새마다 따로다(2026-10-15 사용자): 봇 설정 묶음에는 파비콘 · 로그인 배경이 들지 않고 따로 내보낸다(예전 파일의 파비콘도 불러온다).
// 로그인 배경은 다 만든 배경만 담고, 불러오면 지금 기록을 통째로 바꾼다(2026-10-17 사용자). 수백 MB 가 될 수 있어 내보내기는 흘려 보낸다.
// 내보내기는 두 걸음: POST /export?kind=… 가 최근 로그인을 보고 한 번 쓰는 주소(1분)를 주면, 브라우저가 그 주소(GET /download/:ticket)를 바로 내려받는다(화면이 파일을 메모리에 들지 않게).
// 불러오기는 파일을 한 번 올려 미리 보고(POST /preview, 올린 파일의 표 token), 고른 항목만 그 표로 덮어쓴다(POST /import?token=…&items=…).
// 올린 파일은 가져오거나 닫거나(DELETE /upload/:token) 1시간이 지나면 지운다. 올리는 크기에 고정 상한은 없고 남은 공간으로만 막는다

/** settings: 봇 설정만(남에게 나눠 줄 것), full: 서버별 설정 · 키 · 쿠키의 암호문까지, favicon: 파비콘(칸 · 기록), login-background: 로그인 배경(다 만든 배경 · 화면 값 · 한도) */
const ARCHIVE_KINDS = ["settings", "full", "favicon", "login-background"] as const;
type ArchiveKind = (typeof ARCHIVE_KINDS)[number];
const isArchiveKind = (value: string): value is ArchiveKind => (ARCHIVE_KINDS as readonly string[]).includes(value);

/** 가져올 수 있는 항목. 설정 문서 넷 · 운영 조절값 · 서버별 설정 · 키 · 쿠키(암호문) · 파비콘 · 로그인 배경 */
const ARCHIVE_ITEMS = ["tunables", "genres", "status", "ai", "ai-prompt", "guilds", "secrets", "favicon", "login-background"] as const;
type ArchiveItem = (typeof ARCHIVE_ITEMS)[number];

const isArchiveItem = (value: string): value is ArchiveItem => (ARCHIVE_ITEMS as readonly string[]).includes(value);

/**
 * 미리 보기 한 줄. inFile: 파일에 있나, same: 지금 값과 같나, problems: 검사에 걸린 것(있으면 가져올 수 없다),
 * warnings: 가져올 수는 있지만 알아 둘 것(바깥으로 나가는 값이 바뀐다 · 건너뛰는 값), count: 서버 수 · 쓸 수 있는 키 수 · 그림 수 · 배경 수(나머지는 null)
 */
type ArchiveRow = { item: ArchiveItem; inFile: boolean; same: boolean; problems: string[]; warnings: string[]; count: number | null };
/** 미리 보기. token 은 올린 파일의 표(가져오기에 넘긴다), 파일의 종류 · 만든 때 · 봇 버전(파일에 적힌 그대로), 줄은 그 종류의 항목만 */
type ArchivePreview = { token: string; kind: ArchiveKind; exportedAt: string | null; botVersion: string | null; rows: ArchiveRow[] };
/** 내보내기의 답. url 은 한 번 쓰는 내려받기 주소(1분 안에) */
type ArchiveDownload = { url: string };
/** 가져오기의 답. 덮어쓴 항목 */
type ArchiveImported = { imported: ArchiveItem[] };

export { ARCHIVE_KINDS, ARCHIVE_ITEMS, isArchiveKind, isArchiveItem };
export type { ArchiveKind, ArchiveItem, ArchiveRow, ArchivePreview, ArchiveDownload, ArchiveImported };
