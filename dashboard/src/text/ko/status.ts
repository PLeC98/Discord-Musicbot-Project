// 운영자 패널: 봇 상태 탭과 그 그래프

import { josa } from "../../../../src/rules/josa.ts";
import { formatNumber } from "../../utils/locale.ts";

/** 그래프 가로축의 왼쪽 끝, 오른쪽 끝 */
const minutesAgo = (minutes: number) => `${minutes}분 전`;
const now = "지금";
/** 그래프의 화면 읽기 요약. 값은 단위를 붙여 적은 글 */
const chartSummary = ({ minutes, min, max, axisMax }: { minutes: number; min: string; max: string; axisMax: string }) => `최근 ${minutes}분, 최저 ${min}, 최고 ${max}, 세로축 최대 ${axisMax}`;
/** 아직 모은 값이 없을 때(봇을 켠 뒤 첫 15초)의 화면 읽기 요약 */
const chartEmpty = "아직 모은 값이 없어요";

// 요약
const allOk = "모두 정상";
const needsAttention = (count: number) => `확인이 필요한 항목이 ${count}개 있어요.`;
const connecting = "연결 중 · ";
const runningFor = (span: string, guilds: number) => `${span}째 작동 중 · 서버 ${guilds}개`;
const staleTip = "상태를 받지 못하고 있어요.\n아래 값은 이 시각에 받은 값이에요";
const freshTip = "3초마다 갱신";
const stale = "끊김";
const lastUpdate = "마지막 갱신";
const recentSummary = "지난 1시간 요약";
const errors = (count: number) => `오류 ${count}`;
const warnings = (count: number) => `경고 ${count}`;
const openLogs = "실시간 로그 열기";
const repeated = (count: number, lastAt: string) => `지난 1시간 ${count}번 · 마지막 ${lastAt}`;
/** 요약 칩의 말(그 값이 어떤지) */
const attention = { high: "높음", lagging: "높음", nearLimit: "한도 가까움", skipped: "건너뜀", failingOften: "잦은 실패", nearlyFull: "거의 가득 참", stray: "잔류 프로세스" };
const youtubeClient = (name: string) => `유튜브 ${name}`;

// 그래프 카드
const metrics = {
  playing: "재생 중",
  /** 보조 텍스트의 말(뒤에 수가 붙는다) */
  playingSub: "연결됨",
  ping: "디스코드 API 핑",
  /** lines: 좁은 카드에서 두 줄로 */
  pingSub: (minutes: number, average: string, lines = false) => `${minutes}분 평균${lines ? "\n" : " "}${average}`,
  loop: "이벤트 루프 지연",
  /** 좁은 카드의 제목(툴팁으로 loop 를 보인다) */
  loopShort: "EL lag",
  loopSub: "최대",
  /** 큰 숫자가 p99 인 카드의 제목 뒤 */
  p99: "p99",
  heap: "heap 메모리",
  cpu: "CPU",
  cpuSub: (system: number) => `시스템 ${system}%`,
  download: "다운로드 (yt-dlp)",
  downloadActive: (count: number) => `활성 ${formatNumber(count)}개`,
  downloadToday: "오늘",
  encoding: "인코딩 응답 시간",
  /** 최근 15분 동안의 합(핑의 "15분 평균" 과 같은 앞말). 수는 아래 줄에 */
  encodingLate: "15분 누락 프레임",
  upload: "업로드",
  uploadSystem: "시스템",
  uploadToday: "오늘",
  uploadParts: (voice: string, dashboard: string) => `음성 ${voice} · 대시보드 ${dashboard}`,
  uploadNoSystem: "시스템 전체 업로드는 재지 못했어요",
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
const reconnected = (count: number) => `재연결 ${count}회`;
const cookies = "쿠키";
const noCookies = "쿠키 사용 안 함";
const cookieSources = { file: "파일", browser: "브라우저", none: "" };
const clients = "클라이언트 (설정 순서)";
const clientsRate = "성공/시도";
const clientSkipped = "건너뜀";
const clientDetail = (order: number, tried: number, ok: number, excluded: boolean) => `${order}번째로 시도\n${tried}번 중 ${ok}번 성공${excluded ? "\n연속 실패로 한동안 건너뛰어요" : ""}`;
/** 지난 때를 큰 단위 둘까지 "2시간 8분 전" 형식으로(0 인 단위는 뺀다). cut 이면 앞에 "약" */
const justNow = "방금 전";
const unitNames = { day: "일", hour: "시간", minute: "분", second: "초" };
const ago = (span: string) => `${span} 전`;
const about = (text: string) => `약 ${text}`;

// 플레이어
const playersTitle = (count: number) => `연결된 서버와 활성 플레이어 (${count})`;
const search = "검색";
const playerStates = { playing: "재생 중", paused: "일시정지", idle: "재생 대기" };
const noSong = "곡 없음";
const playerLine = (listeners: number, queued: number) => `${listeners}명 · 대기열 ${formatNumber(queued)}곡`;
const noMatch = "해당하는 서버가 없어요";
const noStatePicked = "선택한 상태가 없어요";
const total = "합계";
const playersTotal = (listeners: number, queued: number) => `청취자 ${formatNumber(listeners)}명 · 대기열 ${formatNumber(queued)}곡`;
const notMemberTip = "참가하지 않은 서버라 열 수 없어요";

// 자식 프로세스
const processes = "자식 프로세스";
const columns = { pid: "PID", label: "프로그램", job: "작업", age: "실행 시간", mem: "메모리" };
const sortBy = (label: string) => `${label}${josa(label, "으로")} 정렬`;
const strayMore = (count: number) => `외 ${formatNumber(count)}개`;
const strayTip = "플레이어가 없는 서버의 재생 작업을 하는 프로세스예요.\n종료에 실패한 잔류 프로세스일 수 있어요.";
/** 작업: 봇 헬퍼는 이름, 서버의 작업은 서버 이름(다음 곡, 자동 검색은 덧붙인다) */
const jobs = { potServer: "POToken 서버", ytdlpUpdate: "yt-dlp 업데이트", loginBackground: "로그인 배경", netStats: "시스템 업로드 측정", leftServer: "나간 서버", prefetch: "다음 곡", lookup: "자동 검색", none: "없음" };
const noProcesses = "실행 중인 자식 프로세스가 없어요";
const processesTotal = (count: number, byLabel: string) => `합계 ${count}개 (${byLabel})`;
/** yt-dlp 줄: 곡 찾기, 다운로드의 도는 수/크기와 기다리는 수 */
const ytdlpLoad = (lookup: string, background: string, waiting: number) => `yt-dlp 곡 찾기 ${lookup} · 다운로드 ${background} · 기다림 ${formatNumber(waiting)}`;
const ytdlpLoadTip = (count: number, reused: number, missed: number) => `지난 1시간 동안 유튜브 영상 정보를 ${formatNumber(count)}번 읽고, 캐시된 정보를 ${formatNumber(reused)}번 다시 썼어요.${missed ? ` 자리가 없어 밀려난 정보를 ${formatNumber(missed)}번 다시 읽었어요.` : ""}\n로그인 없이 쓰면 시간당 약 300번부터 막히기 시작해요.`;
const extractions = "유튜브 영상 정보 읽기";

// 인코딩 워커
const workers = {
  title: (count: number) => `인코딩 워커 (${count})`,
  /** 이 호스트에서 띄울 수 있는 최대(CPU 코어 − 1, 8 까지) */
  limit: "워커 상한",
  quota: (cores: number) => `CPU 할당 ${cores}코어`,
  lateTotal: "켜진 뒤 누락 프레임",
  deaths: "켜진 뒤 다시 띄운 워커",
  worker: (n: number) => `워커 ${n}`,
  streams: (count: number) => `재생 ${formatNumber(count)}`,
  /** 워커 스레드가 지난 1초 동안 쓴 CPU(코어 하나 기준, 100 이 끝) */
  cpu: (pct: number) => `코어 ${pct}%`,
  /** 응답 시간 p99 / 응답 한도(응답이 그 안에 와야 소리가 끊기지 않는 시간, (큐 깊이 − 1) × 20ms) */
  rtt: (rtt: string, limit: string) => `응답 시간 ${rtt} / ${limit}`,
  none: "재생이 없어 워커가 없어요",
};

// 저장공간
const storage = "저장공간";
const dbBrowser = "캐시 DB";
const audioCache = "오디오 캐시";
const cacheFiles = "캐시 파일 수";
const files = (count: number, max: number) => `${formatNumber(count)} / ${formatNumber(max)}개`;
const drive = (name: string) => `드라이브 (${name})`;
const driveFree = (total: string, free: string) => `${total} 중 ${free} 사용 가능`;
const cacheCounts = { protected: "재생 중 캐시 보호", neverPlayed: "미재생 캐시 파일", failed: "다운로드 실패한 캐시 파일" };
const count = (n: number) => `${formatNumber(n)}개`;
const songCount = (n: number) => `${formatNumber(n)}곡`;
const driveParts = { other: "기타", free: "여유 공간", reserve: "최소 여유 공간" };
const reserveTip = (size: string) => `최소 여유 공간 ${size}`;
const db = { file: "DB 파일", lookups: "오디오 링크 데이터", pins: "직접 지정한 음원", sponsor: "SponsorBlock 구간", sessions: "백업된 플레이어", lastCleanup: "마지막 캐시 정리" };
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
  strayMore,
  jobs,
  noProcesses,
  processesTotal,
  ytdlpLoad,
  ytdlpLoadTip,
  extractions,
  workers,
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
