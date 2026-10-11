// 운영자 패널: 봇 상태 탭과 그 그래프

import { josa } from "../../../../src/rules/josa.ts";
import { formatNumber } from "../../utils/locale.ts";

/** 그래프 가로축의 왼쪽 끝 · 오른쪽 끝 */
const minutesAgo = (minutes: number) => `${minutes}분 전`;
const now = "지금";
/** 그래프의 화면 읽기 요약. 값은 단위를 붙여 적은 글 */
const chartSummary = ({ minutes, min, max, axisMax }: { minutes: number; min: string; max: string; axisMax: string }) => `최근 ${minutes}분, 최저 ${min}, 최고 ${max}, 세로축 최대 ${axisMax}`;
/** 아직 모은 값이 없을 때(봇을 켠 뒤 첫 15초)의 화면 읽기 요약 */
const chartEmpty = "아직 모은 값이 없어요";

// 요약
const allOk = "모두 정상";
const needsAttention = (count: number) => `주목이 필요한 ${count}개의 상태가 있어요.`;
const connecting = "연결 중 · ";
const runningFor = (span: string, guilds: number) => `${span}째 작동 중 · 서버 ${guilds}개`;
const staleTip = "상태를 받지 못하고 있다.\n아래 값은 이 시각에 받은 것";
const freshTip = "3초마다 갱신";
const stale = "끊김";
const lastUpdate = "마지막 갱신";
const recentSummary = "지난 1시간 요약";
const errors = (count: number) => `오류 ${count}`;
const warnings = (count: number) => `경고 ${count}`;
const openLogs = "실시간 로그 열기";
const repeated = (count: number, lastAt: string) => `지난 1시간 ${count}번 · 마지막 ${lastAt}`;
/** 요약 칩의 말(그 값이 어떤지) */
const attention = { high: "높음", lagging: "밀림", nearLimit: "한도 가까움", skipped: "건너뜀", failingOften: "잦은 실패", nearlyFull: "거의 참", stray: "잔류 프로세스" };
const youtubeClient = (name: string) => `유튜브 ${name}`;

// 그래프 카드
const metrics = {
  playing: "재생 중",
  playingSubLabel: "연결된 서버",
  playingSub: (connected: number) => `연결된 서버 ${connected}`,
  ping: "디스코드 API 핑",
  pingSub: (minutes: number, average: number) => `${minutes}분 평균 ${average}`,
  loop: "이벤트 루프 지연",
  loopSub: (max: number) => `p99 · 최대 ${max}`,
  heap: "heap 메모리",
  cpu: "CPU",
  cpuSub: (system: number) => `시스템 ${system}%`,
  download: "다운로드 (yt-dlp)",
  downloadActive: (count: number) => `활성 ${count}개`,
  downloadToday: (size: string) => `오늘 ${size}`,
  countUnit: "개",
};

// 연결
const links = "연결";
const lastOk = "마지막 성공";
const response = "응답";
const groups = { play: "재생", youtube: "유튜브", autoplay: "자동재생" };
const linkWords = { ok: "정상", slow: "느림", fail: "실패", idle: "대기 중", off: "비활성" };
const failed = "실패";
const unused = "현재 사용되지 않는 출처";
const retrying = (attempt: number) => `연결 재시도 중 (${attempt}회차)`;
const reconnected = (count: number) => `연결 재수립 ${count}회`;
const cookies = "쿠키";
const noCookies = "쿠키를 쓰지 않음";
const cookieSources = { file: "파일", browser: "브라우저", none: "" };
const clients = "클라이언트 (설정순)";
const clientsRate = "성공/시도";
const clientSkipped = "건너뜀";
const clientDetail = (order: number, tried: number, ok: number, excluded: boolean) => `${order}번째로 시도\n${tried}번 중 ${ok}번 성공${excluded ? "\n연속으로 실패해 한동안 건너뛴다" : ""}`;
/** 지난 때를 큰 단위 둘까지 "2시간 8분 전" 꼴로(0 인 단위는 뺀다). cut 이면 앞에 "약" */
const justNow = "방금 전";
const unitNames = { day: "일", hour: "시간", minute: "분", second: "초" };
const ago = (span: string) => `${span} 전`;
const about = (text: string) => `약 ${text}`;

// 플레이어
const playersTitle = (count: number) => `연결된 서버 · 활성 플레이어 (${count})`;
const search = "검색";
const playerStates = { playing: "재생 중", paused: "일시정지", idle: "재생 대기" };
const noSong = "곡 없음";
const playerLine = (listeners: number, queued: number) => `${listeners}명 · 대기열 ${formatNumber(queued)}곡`;
const noMatch = "해당하는 서버가 없어요";
const noStatePicked = "고른 상태가 없어요";
const total = "합계";
const playersTotal = (listeners: number, queued: number) => `청취자 ${formatNumber(listeners)}명 · 대기열 ${formatNumber(queued)}곡`;
const notMemberTip = "참가하지 않은 서버라 열 수 없어요";

// 자식 프로세스
const processes = "자식 프로세스";
const columns = { pid: "PID", label: "프로그램", job: "하는 일", age: "작동 시간", mem: "메모리" };
const sortBy = (label: string) => `${label}${josa(label, "으로")} 정렬`;
const strayTip = "플레이어가 없는 서버의 재생 일을 하는 프로세스예요.\n종료에 실패한 잔류 프로세스일 수 있어요.";
/** 하는 일: 봇 도우미는 이름, 서버의 일은 서버 이름(다음 곡 · 곡 찾기는 덧붙인다) */
const jobs = { potServer: "POToken 서버", ytdlpUpdate: "yt-dlp 업데이트", leftServer: "나간 서버", prefetch: "다음 곡", lookup: "곡 찾기", none: "없음" };
const noProcesses = "작동 중인 자식 프로세스가 없어요";
const processesTotal = (count: number, byLabel: string) => `합계 ${count}개 (${byLabel})`;

// 저장공간
const storage = "저장공간";
const dbBrowser = "DB 브라우저";
const audioCache = "오디오 캐시";
const cacheFiles = "캐시 파일 수";
const files = (count: number, max: number) => `${formatNumber(count)} / ${formatNumber(max)}개`;
const drive = (name: string) => `드라이브 (${name})`;
const driveFree = (total: string, free: string) => `${total} 중 ${free} 사용 가능`;
const cacheCounts = { protected: "재생 중 캐시 보호", neverPlayed: "미재생 캐시 파일", failed: "받기 실패한 캐시 파일" };
const count = (n: number) => `${formatNumber(n)}개`;
const songCount = (n: number) => `${formatNumber(n)}곡`;
const driveParts = { other: "기타", free: "여유 공간", reserve: "최소 여유" };
const reserveTip = (size: string) => `최소 여유 ${size}`;
const db = { file: "DB 파일", lookups: "곡 조회 기록", sponsor: "SponsorBlock 구간", sessions: "백업된 플레이어", lastCleanup: "마지막 캐시 정리" };
const cleanup = (when: string, files: number, size: string) => `${when} · ${formatNumber(files)}개 · ${size}`;

export {
  minutesAgo,
  now,
  chartSummary,
  chartEmpty,
  allOk,
  needsAttention,
  connecting,
  runningFor,
  staleTip,
  freshTip,
  stale,
  lastUpdate,
  recentSummary,
  errors,
  warnings,
  openLogs,
  repeated,
  attention,
  youtubeClient,
  metrics,
  links,
  lastOk,
  response,
  groups,
  linkWords,
  failed,
  unused,
  retrying,
  reconnected,
  cookies,
  noCookies,
  cookieSources,
  clients,
  clientsRate,
  clientSkipped,
  clientDetail,
  justNow,
  unitNames,
  ago,
  about,
  playersTitle,
  search,
  playerStates,
  noSong,
  playerLine,
  noMatch,
  noStatePicked,
  total,
  playersTotal,
  notMemberTip,
  processes,
  columns,
  sortBy,
  strayTip,
  jobs,
  noProcesses,
  processesTotal,
  storage,
  dbBrowser,
  audioCache,
  cacheFiles,
  files,
  drive,
  driveFree,
  cacheCounts,
  count,
  songCount,
  driveParts,
  reserveTip,
  db,
  cleanup,
};
