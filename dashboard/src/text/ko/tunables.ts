// 운영자 패널: 설정 탭의 운영 조절값(옛 .env 의 같은 이름. 칸 목록은 src/rules/tunables.ts)

/** 묶음마다 제목 · 아이콘 · 설명 */
const groups = {
  queue: { title: "대기열 · 나가기", icon: "queue_music", desc: "" },
  look: { title: "표시", icon: "palette", desc: "" },
  youtube: { title: "유튜브", icon: "smart_toy", desc: "" },
  sponsorblock: { title: "SponsorBlock", icon: "fact_check", desc: "비음악 구간을 건너뛰어요. 구간 데이터: sponsor.ajay.app (CC BY-NC-SA 4.0)" },
  cache: { title: "오디오 캐시", icon: "hard_drive", desc: "" },
  stream: { title: "재생 스트림", icon: "graphic_eq", desc: "" },
  dashboard: { title: "대시보드 요청 제한 · 실시간 연결", icon: "dashboard", desc: "" },
} as const;

/** 칸마다 이름표 · 설명(툴팁) */
const fields: Record<string, { label: string; help: string }> = {
  QUEUE_MAX_TRACKS: { label: "대기열 곡 수 상한", help: "재생 중인 곡은 빼고 세요. 0 이면 끔, 켜면 25 이상.\n곡이 수천 개면 셔플처럼 대기열 전체를 다시 쓰는 조작 동안 봇 전체가 잠깐 멈출 수 있어요. 1,000곡 안쪽을 권해요." },
  LEAVE_DELAY_QUEUE_EMPTY_SECONDS: { label: "대기열이 비면 나가기까지(초)", help: "대기열을 다 튼 뒤 음성 채널을 나가기까지 기다리는 시간. 0 이면 바로 나가요." },
  LEAVE_DELAY_ALONE_SECONDS: { label: "혼자 남으면 나가기까지(초)", help: "음성 채널에 봇만 남았을 때 나가기까지 기다리는 시간." },
  EMBED_COLOR: { label: "임베드 색", help: "왼쪽 동그라미를 눌러 고르거나 #RRGGBB 꼴로 적어요. 대시보드의 기본 색으로도 써요." },
  WEBSITE: { label: "봇 웹사이트 주소", help: "비우면 /help 에서 링크를 빼요. http · https 주소만." },
  VOICE_PLAYING_PREFIX: { label: "음성 상태: 재생 중 앞머리", help: "음성 채널 상태에 곡 이름 앞에 붙여요. 예: 📻" },
  VOICE_PAUSED_PREFIX: { label: "음성 상태: 일시정지 앞머리", help: "일시정지 중일 때 곡 이름 앞에 붙여요. 예: ⏸" },
  VOICE_IDLE_STATUS: { label: "음성 상태: 대기 중 문구", help: "틀 곡이 없을 때 음성 채널 상태에 적어요." },
  YTDLP_PLAYER_CLIENTS: { label: "유튜브 클라이언트 차례", help: "쉼표로 적어요. 앞에서부터 시도하고 실패하면 뒤로 넘어가요. 비우면 yt-dlp 기본값.\n예: visionos,web_embedded,tv_embedded" },
  YTDLP_CLIENT_WINDOW: { label: "최근 몇 번을 보고 판단할지", help: "클라이언트가 막혔는지 볼 때 최근 몇 번의 결과를 볼지." },
  YTDLP_CLIENT_FAILS: { label: "그중 몇 번 실패하면 건너뛸지", help: "위 횟수 가운데 이만큼 실패하면 그 클라이언트를 한동안 건너뛰어요." },
  YTDLP_CLIENT_RETRY_MINUTES: { label: "건너뛴 클라이언트를 다시 시험하기까지(분)", help: "0 이면 봇을 다시 시작하거나 클라이언트 설정을 저장할 때까지 건너뛰어요." },
  COOKIES_SOURCE: { label: "쿠키 출처", help: "연령 제한 영상에만 써요. file 이면 이 탭의 유튜브 쿠키 카드에 넣은 것을,\n브라우저 이름이면 그 브라우저에서 가져와요(brave · chrome · chromium · edge · firefox · opera · safari · vivaldi · whale, chrome:Profile 1 처럼 프로필도). 비우면 쓰지 않아요." },
  BGUTIL_ENABLED: { label: "POToken 서버 쓰기", help: "설치돼 있을 때 켜면 봇과 함께 POToken 서버를 띄워요. mweb · tv_simply 클라이언트에 필요해요." },
  SPONSORBLOCK_ENABLED: { label: "SponsorBlock 쓰기", help: "끄면 조회 · 캐시를 아예 하지 않아요. 상업적으로 쓰면 꺼 두길 권해요(데이터 라이선스가 비상업)." },
  SPONSORBLOCK_CATEGORIES: { label: "기본으로 건너뛸 구간", help: "서버 설정이 없을 때 쓰는 구간. 쉼표로 적어요.\n고를 수 있는 것: music_offtopic · intro · outro · sponsor · selfpromo · interaction · preview · hook · filler" },
  SPONSORBLOCK_API_BASE: { label: "API 주소", help: "미러 · 직접 띄운 서버를 쓸 때만 바꿔요." },
  SPONSORBLOCK_HASH_PREFIX: { label: "해시 앞머리 길이", help: "4~32. 짧을수록 어떤 영상을 묻는지 덜 드러나고 응답은 커져요." },
  SPONSORBLOCK_TIMEOUT_MS: { label: "조회 시간 한도(ms)", help: "넘으면 받아 둔 구간을 쓰거나 건너뛰기 없이 틀어요." },
  CACHE_MAX_SIZE_MB: { label: "최대 용량(MB)", help: "넘으면 오래 · 덜 들은 곡부터 지워요." },
  CACHE_MAX_FILES: { label: "최대 파일 수", help: "" },
  CACHE_MIN_FREE_DISK_MB: { label: "디스크 최소 여유(MB)", help: "드라이브 여유가 이보다 적으면 상한과 상관없이 지워요." },
  CACHE_EVICT_TARGET_PERCENT: { label: "지울 때 내려갈 선(%)", help: "상한을 넘으면 상한의 이 비율까지 지워요(50~99). 여유를 두어 곧바로 다시 넘지 않게 해요." },
  CACHE_EVICT_INTERVAL_HOURS: { label: "정기 정리 간격(시간)", help: "" },
  CACHE_MAX_TRACK_MINUTES: { label: "캐시하지 않을 긴 곡(분)", help: "이보다 긴 곡은 받지 않고 스트림으로만 틀어요. 0 이면 상한 없음. 6시간짜리 곡은 받는 동안 800MB 가까이 써요." },
  STREAM_CHUNK_KB: { label: "청크 크기(KB)", help: "유튜브 스트림을 나눠 받는 크기. 1024KB 면 약 1분 분량. 권장 256~4096." },
  RATE_LIMIT_WINDOW_SEC: { label: "요청을 세는 구간(초)", help: "아래 두 값을 세는 구간." },
  RATE_LIMIT_API_MAX: { label: "구간당 일반 요청 수", help: "실시간 갱신 연결은 세지 않아요. 정상 사용에서 걸리면 늘리세요." },
  RATE_LIMIT_QUEUE_MAX: { label: "구간당 곡 추가 요청 수", help: "곡 추가는 yt-dlp 를 부르므로 따로 조여요." },
  RATE_LIMIT_AUTH_WINDOW_SEC: { label: "로그인 시도를 세는 구간(초)", help: "" },
  RATE_LIMIT_AUTH_MAX: { label: "그 구간당 로그인 요청 수", help: "" },
  SSE_HEARTBEAT_SEC: { label: "실시간 연결 신호 간격(초)", help: "연결이 끊기지 않게 보내는 신호 간격(5~300)." },
  SSE_MAX_CONNECTIONS: { label: "사용자당 실시간 연결 수", help: "탭 · 창마다 하나. 플레이어 화면과 로그를 따로 세요." },
  SSE_COALESCE_MS: { label: "알림 합치기 창(ms)", help: "같은 서버의 바뀜 알림을 이 시간 안에서 하나로 합쳐요." },
};

const title = "운영 조절값";
const desc = "비운 칸은 기본값을 써요. 저장하면 바로 적용되고, 표시된 칸은 봇을 다시 시작해야 적용돼요.";
const defaultWith = (value: string) => (value ? `기본값 ${value}` : "기본값: 비움");
const restartTip = "기동 때 한 번 정하는 값이라 봇을 다시 시작해야 적용돼요.";
const pending = "저장함 · 다시 시작하면 적용";
const restartBadge = "다시 시작해야 적용";
const pickColor = "색 고르기";
const on = "켬";
const off = "끔";
const savedDone = "운영 조절값을 저장했어요";
/** names: 다시 시작해야 먹는 칸의 이름(· 로 이음) */
const savedRestart = (names: string) => `봇을 다시 시작해야 적용돼요: ${names}`;
const saveFailed = "운영 조절값을 저장하지 못했어요.";
const loadFailed = "운영 조절값을 읽지 못했어요.";

export { groups, fields, title, desc, defaultWith, restartTip, pending, restartBadge, pickColor, on, off, savedDone, savedRestart, saveFailed, loadFailed };
