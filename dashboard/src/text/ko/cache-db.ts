// 운영자 패널 캐시 DB 탭의 문구.
// 낱말은 DB 도구 · 엑셀에서 흔히 쓰는 말 그대로(테이블 · 행 · 열 · 셀 · 필터 · 헤더 · 정렬). 셀 툴팁은 값만으로 알 수 없는 것에만

import type { TrackCacheTable, TrackFileUse } from "../../../../src/dashboard/contract/track-cache.ts";

const tables: Record<TrackCacheTable, string> = { requests: "링크 데이터", files: "캐시 파일", age: "연령 제한" };
const tableLabel = "테이블";

/** 열 이름 */
const columns: Record<string, string> = {
  requestKey: "요청",
  platform: "플랫폼",
  title: "제목",
  artist: "아티스트",
  audioUrl: "재생 음원",
  pinnedAt: "지정 시각",
  file: "파일 상태",
  size: "크기",
  plays: "재생 수",
  lastPlayedAt: "마지막 재생",
  ageMarkedAt: "연령 제한",
  check: "재생 테스트",
  audioKey: "캐시 키",
  channel: "채널",
  status: "상태",
  duration: "길이",
  downloadedAt: "다운로드 시각",
  requests: "요청 수",
  videoId: "영상 ID",
  markedAt: "등록 시각",
};
/** 열 헤더 툴팁: 이름만으로 뜻이 덜 읽히는 열 */
const columnTips: Record<string, string> = {
  requestKey: "봇이 받은 요청(링크, 자동재생이면 그 출처의 키)",
  audioUrl: "이 요청에 재생하는 음원. 편집하면 직접 지정한 음원이 되고, 지정하지 않은 행은 봇이 자동으로 찾은 음원이에요",
  pinnedAt: "음원을 직접 지정한 시각. 비어 있으면 자동으로 찾은 음원이에요",
  audioKey: "캐시 파일을 가리키는 키(유튜브 yt: · 사운드클라우드 sc: · 직접 링크 dl:)",
  requests: "이 캐시 파일을 재생 음원으로 쓰는 요청 수",
};

const tools = {
  refresh: "새로고침 (F5)",
  clearFilters: "모든 필터 지우기",
  clearFilter: "필터 지우기",
  clearSort: "정렬 해제",
  newRow: "새 행: 아직 재생한 적 없는 요청에 음원을 미리 지정해요",
  newRowOff: "새 행은 링크 데이터 테이블에서만 추가할 수 있어요",
  deleteRows: "선택한 행 삭제",
  probe: "재생 테스트",
  probeTip: "선택한 행의 음원이 지금 재생되는지 확인해요. 저장과 상관없이 바로 실행돼요",
  probing: (n: number) => `재생 테스트 중 ${n}`,
  search: "모든 열에서 필터",
  shortcuts: "단축키",
};

const filterPlaceholder = "필터";
/** 필터 입력란 오른쪽 클릭 */
const filterMenu = [
  { label: "포함", hint: "abc", insert: "" },
  { label: "같음", hint: "=abc", insert: "=" },
  { label: "같지 않음", hint: "<>abc", insert: "<>" },
  { label: "보다 큼", hint: ">10", insert: ">" },
  { label: "보다 작음", hint: "<10", insert: "<" },
  { label: "이상", hint: ">=10", insert: ">=" },
  { label: "이하", hint: "<=10", insert: "<=" },
  { label: "범위", hint: "10~20", insert: "~" },
  { label: "정규식", hint: "/abc/", insert: "//" },
  { label: "비어 있음", hint: "=''", insert: "=''" },
  { label: "비어 있지 않음", hint: "<>''", insert: "<>''" },
] as const;
const filterHelp = "필터 문법은 DB Browser for SQLite 와 같아요. 크기는 10MB, 날짜는 2026-10-17, 길이는 3:30 처럼 적어요. 여러 열에 필터를 걸면 모두 맞는 행만 남아요.";

const headerMenu = { hide: "열 숨기기", showAll: "모든 열 표시", freeze: "여기까지 열 고정", unfreeze: "열 고정 해제", copyName: "열 이름 복사" };

const cellMenu = {
  copy: "복사",
  copyWithHeaders: "헤더 포함 복사",
  paste: "붙여넣기",
  filterEquals: "필터: 이 값과 같음",
  filterContains: "필터: 이 값 포함",
  filterNotEquals: "필터: 이 값과 다름",
  filterGreater: "필터: 이 값보다 큼",
  filterLess: "필터: 이 값보다 작음",
  edit: "셀 편집",
  unpin: "음원 지정 해제",
  clearResult: "자동 검색 결과 지우기",
  deleteFile: (n: number) => (n > 1 ? `캐시 파일 삭제 (요청 ${n}개가 공유)` : "캐시 파일 삭제"),
  clearAge: "연령 제한 해제",
  deleteRows: (n: number) => (n > 1 ? `행 ${n}개 삭제` : "행 삭제"),
  openRequest: "요청 링크 열기",
  openAudio: "음원 링크 열기",
  probe: "재생 테스트",
};

/** 셀 값 */
const values = {
  none: "—",
  file: { cached: "있음", downloading: "다운로드 중", error: "오류", none: "없음" },
  status: { cached: "완료", downloading: "다운로드 중", error: "오류", none: "없음" },
  checkOk: "재생 가능",
  checkLive: "라이브",
  checkFail: "재생 불가",
  noRows: "행이 없어요",
};

/** 셀 툴팁: 값만으로는 알 수 없는 것에만(재생 불가 까닭 · 저장 실패 까닭) */
const tips = {
  checkFailed: (reason: string, when: string) => `${reason} (${when} 테스트)`,
};

/** 격자 아래 상태 줄에 잠깐 보이는 안내 */
const hints = {
  readonly: (column: string) => `${column} 열은 편집할 수 없어요`,
  cantClear: (column: string) => `${column} 셀은 지울 수 없어요`,
  cantClearRow: "행을 삭제하려면 행 번호를 선택한 뒤 Delete 를 눌러 주세요",
  noClipboard: "이 주소에서는 메뉴로 붙여넣을 수 없어요. Ctrl+V 를 눌러 주세요",
  copied: (rows: number) => `${rows}행 복사했어요`,
  loadingAll: "모든 행을 불러오는 중…",
  tooMany: (max: number) => `한 번에 ${max}행까지 삭제할 수 있어요`,
  nothingToUndo: "되돌릴 변경이 없어요",
  undone: "마지막 변경을 되돌렸어요",
};

const pager = { first: "처음", prev: "이전 페이지", next: "다음 페이지", last: "끝", goTo: "행으로 이동", range: (from: number, to: number, total: number) => `${from}–${to} / ${total}행` };

const editPane = {
  title: (column: string, row: number) => `셀 편집 · ${column} · ${row}행`,
  empty: "셀을 선택하면 값이 여기에 보여요.",
  apply: "적용",
  applyTip: "Ctrl+Enter",
  clear: "지우기",
  open: "열기",
  readonly: "봇이 채우는 값이라 편집할 수 없어요.",
  kinds: { youtube: "유튜브 영상", soundcloud: "사운드클라우드 곡", direct: "직접 링크 오디오", spotify: "스포티파이", search: "검색어", unknown: "알 수 없는 링크" } as Record<string, string>,
  audioInfo: (kind: string, key: string) => `${kind} · 캐시 키 ${key}`,
  pinNote: "지정한 음원은 다음에 이 요청을 재생할 때부터 써요. 이미 대기열에 든 곡은 그대로예요.",
  unpinTo: (ledger: string) => `지정을 해제하면 자동으로 찾은 음원으로 돌아가요: ${ledger}`,
  unpinToNone: "지정을 해제하면 다음 재생 때 음원을 다시 찾아요.",
  sameAsRequest: "요청 링크를 그대로 재생해요.",
};

const changes = {
  summary: (n: number, parts: string[]) => `변경 ${n}건: ${parts.join(" · ")}. 저장해야 반영돼요.`,
  pins: (n: number) => `음원 지정 ${n}`,
  unpins: (n: number) => `지정 해제 ${n}`,
  clears: (n: number) => `자동 검색 결과 지우기 ${n}`,
  rows: (n: number) => `요청 삭제 ${n}`,
  files: (n: number) => `캐시 파일 삭제 ${n}`,
  ages: (n: number) => `연령 제한 해제 ${n}`,
  newRows: (n: number) => `새 행 ${n}`,
};
const legend = { changed: "변경됨", newRow: "새 행", deleted: "삭제 예정", failed: "저장 실패", pinned: "직접 지정한 음원(재생 음원 열을 편집해 지정)" };

/** 저장 결과(실패한 셀의 까닭) */
const results = {
  changed: "그사이 봇이 이 값을 바꿨어요. 새로고침한 뒤 다시 편집해 주세요",
  gone: "그사이 삭제된 행이에요",
  downloading: "캐시 파일을 다운로드하는 중이라 삭제하지 않았어요",
  failed: "캐시 파일을 삭제하지 못했어요(다른 프로그램이 열고 있을 수 있어요)",
  inUse: { playing: "재생 중인 곡이라 삭제하지 않았어요", queued: "대기열 앞쪽 곡이라 삭제하지 않았어요", "saved-session": "저장된 대기열 앞쪽 곡이라 삭제하지 않았어요", exporting: "내보내는 중이라 삭제하지 않았어요" } as Record<TrackFileUse, string>,
  doneTitle: "캐시 DB 에 저장했어요",
  partialTitle: "일부 변경을 저장하지 못했어요",
  done: (ok: number, failed: number) => `${ok}건 저장${failed ? ` · ${failed}건 실패(셀에 표시)` : ""}`,
};

/** 단축키 도움말 */
const shortcuts: Array<[string, string]> = [
  ["클릭 · 드래그 · Shift+클릭", "셀 선택 · 범위 선택"],
  ["Ctrl+클릭", "셀 추가 선택"],
  ["행 번호 클릭 · 드래그 · Shift+클릭", "행 선택"],
  ["방향키 · Tab · Home · End · PgUp · PgDn", "이동 (Shift 와 함께 범위 선택)"],
  ["Ctrl+Home · Ctrl+End", "첫 행 · 마지막 행"],
  ["Ctrl+A", "모든 행 선택"],
  ["더블클릭 · F2 · Enter", "셀 편집 (재생 음원 열)"],
  ["Esc", "편집 취소 · 선택 해제"],
  ["Delete", "셀 지우기 (행을 선택했으면 행 삭제)"],
  ["Ctrl+C · Ctrl+V", "복사 · 붙여넣기"],
  ["Ctrl+Z", "마지막 변경 되돌리기"],
  ["Ctrl+S", "저장"],
  ["F5", "새로고침"],
  ["열 헤더 클릭 · Ctrl+클릭", "정렬 · 여러 열 정렬"],
];

const botChanged = "새 변경 사항이 있어요 · 새로고침";
const pasteMany = "붙여넣기는 편집할 수 있는 셀 하나에만 할 수 있어요";
const loadFailed = "캐시 DB 를 불러오지 못했어요.";
const probeFailed = "재생 테스트를 시작하지 못했어요.";

export { tables, tableLabel, columns, columnTips, tools, filterPlaceholder, filterMenu, filterHelp, headerMenu, cellMenu, values, tips, hints, pager, editPane, changes, legend, results, shortcuts, botChanged, pasteMany, loadFailed, probeFailed };
