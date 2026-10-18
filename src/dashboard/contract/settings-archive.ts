// 설정 내보내기 · 불러오기(운영자 패널 백업 · 초기화 탭). /api/admin/settings-archive
// 내보내기는 ZIP 하나: settings.json(사람이 읽는 목록 · 설정) + 종류에 따라 favicon/(파비콘 폴더: index.json · 이미지) · login-background/(배경 기록 index.json · 배경마다의 파일) ·
// audio-cache/(캐시 파일 · 마지막 항목의 행 목록 rows.json). .env · 세션 · 서버별 설정 · 키 · 쿠키는 어느 쪽에도 없다.
// 대시보드의 백업은 쓰임새마다 따로다(2026-10-15 사용자): 봇 설정 백업에는 파비콘 · 로그인 배경이 들지 않고 따로 내보낸다(예전 파일의 파비콘도 불러온다).
// 로그인 배경은 다 만든 배경만 담고, 불러오면 지금 기록을 통째로 바꾼다(2026-10-17 사용자). 오디오 캐시는 지금 캐시에 합치고 캐시 상한까지만 가져온다. 둘 다 커서 내보내기는 스트리밍한다.
// 내보내기는 두 걸음: POST /export?kind=…(오디오 캐시는 &files=0 이면 곡 파일 없이)가 최근 로그인을 보고 한 번 쓰는 주소(1분)를 주면, 브라우저가 그 주소(GET /download/:ticket)를 바로 다운로드한다(화면이 파일을 메모리에 올리지 않게).
// 불러오기는 파일을 한 번 올려 미리 보고(POST /preview, 올린 파일의 토큰 token), 선택한 항목만 그 토큰으로 가져온다(POST /import?token=…&items=…).
// 올린 파일은 가져오거나 닫거나(DELETE /upload/:token) 1시간이 지나면 삭제한다. 올리는 크기에 고정 상한은 없고 남은 공간으로만 막는다

/** settings: 봇 설정만 · favicon: 파비콘(슬롯 · 기록) · login-background: 로그인 배경(다 만든 배경 · 화면 값 · 한도) · audio-cache: 오디오 캐시 */
const ARCHIVE_KINDS = ["settings", "favicon", "login-background", "audio-cache"] as const;
type ArchiveKind = (typeof ARCHIVE_KINDS)[number];
const isArchiveKind = (value: string): value is ArchiveKind => (ARCHIVE_KINDS as readonly string[]).includes(value);

/**
 * 가져올 수 있는 항목. 봇 설정: 설정 문서 넷 · 운영 조절값 / 파비콘 / 로그인 배경 /
 * 오디오 캐시: 캐시 파일(파일과 그 행) · 곡 찾기 기록(링크 데이터) · 직접 지정한 음원 · 연령 제한 · SponsorBlock 구간
 */
const ARCHIVE_ITEMS = ["tunables", "genres", "status", "ai", "ai-prompt", "favicon", "login-background", "audio-files", "audio-ledger", "audio-pins", "audio-age", "audio-sponsorblock"] as const;
type ArchiveItem = (typeof ARCHIVE_ITEMS)[number];
const isArchiveItem = (value: string): value is ArchiveItem => (ARCHIVE_ITEMS as readonly string[]).includes(value);

/**
 * 합치는 항목(오디오 캐시)의 나눔. added: 새로 가져올 것 · existing: 이미 있어 건너뛸 것 · changed: 이미 있지만 값이 달라 덮을 것(직접 지정한 음원) ·
 * overLimit: 캐시 상한(크기 · 수) 때문에 가져오지 않을 것(퇴거 점수가 낮은 것부터) · bytes: 가져올 크기
 */
type ArchiveBreakdown = { added: number; existing: number; changed: number; overLimit: number; bytes: number | null };

/**
 * 미리 보기 한 행. inFile: 파일에 있나, same: 지금 값과 같나, problems: 검사에 걸린 것(있으면 가져올 수 없다),
 * warnings: 가져올 수는 있지만 알아 둘 것(바깥으로 나가는 값이 바뀐다 · PC 에 매인 값이 바뀐다 · 건너뛰는 값), count: 그림 수 · 배경 수 · 행 수(나머지는 null),
 * breakdown: 합치는 항목의 나눔(오디오 캐시만)
 */
type ArchiveRow = { item: ArchiveItem; inFile: boolean; same: boolean; problems: string[]; warnings: string[]; count: number | null; breakdown?: ArchiveBreakdown };
/** 미리 보기. token 은 올린 파일의 토큰(가져오기에 넘긴다), 파일의 종류 · 만든 때 · 봇 버전(파일에 적힌 그대로), 행은 그 종류의 항목만. room: 오디오 캐시를 가져올 남은 공간 */
type ArchivePreview = { token: string; kind: ArchiveKind; exportedAt: string | null; botVersion: string | null; rows: ArchiveRow[]; room?: number };
/** 내보내기의 답. url 은 한 번 쓰는 다운로드 주소(1분 안에) */
type ArchiveDownload = { url: string };
/**
 * 가져오기의 답. imported: 덮어쓰거나 합친 항목 · restart: 다시 시작해야 먹는 값(POToken · SponsorBlock)이 바뀌었다(화면이 "지금 다시 시작 · 나중에" 창을 연다) ·
 * cookiesSource: 쿠키 출처가 바뀌었으면 새 값("file" 은 쿠키 직접 입력, 그 밖은 브라우저 이름. 꺼졌거나 그대로면 null) · added: 합친 항목마다 가져온 수
 */
type ArchiveImported = { imported: ArchiveItem[]; restart: boolean; cookiesSource: string | null; added?: Partial<Record<ArchiveItem, number>> };

export { ARCHIVE_KINDS, ARCHIVE_ITEMS, isArchiveKind, isArchiveItem };
export type { ArchiveKind, ArchiveItem, ArchiveBreakdown, ArchiveRow, ArchivePreview, ArchiveDownload, ArchiveImported };
