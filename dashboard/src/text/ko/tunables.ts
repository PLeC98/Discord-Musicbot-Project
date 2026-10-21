// 운영자 패널: 일반 · 유튜브 · 디스플레이 탭(과 AI 보조 탭의 리퀘스트 로그)의 운영 조절값(옛 .env 의 같은 이름. 칸 목록은 src/rules/tunables.ts)

/** 묶음마다 제목 · 아이콘 · 설명 */
const groups = {
  queue: { title: "대기열 · 나가기", icon: "queue_music", desc: "" },
  look: { title: "디스코드", icon: "forum", desc: "" },
  youtube: { title: "유튜브", icon: "smart_display", desc: "" },
  sponsorblock: { title: "SponsorBlock", icon: "fact_check", desc: "비음악 구간을 건너뛰어요. 구간 데이터: sponsor.ajay.app (CC BY-NC-SA 4.0)" },
  cache: { title: "오디오 캐시", icon: "hard_drive", desc: "" },
  stream: { title: "재생 스트림", icon: "graphic_eq", desc: "" },
  dashboard: { title: "대시보드 요청 제한 · 실시간 연결", icon: "dashboard", desc: "" },
  ailog: { title: "기록 설정", icon: "settings", desc: "" },
} as const;

/** 칸마다 이름표 · 설명(툴팁) */
const fields: Record<string, { label: string; help: string }> = {
  QUEUE_MAX_TRACKS: { label: "대기열 곡 수 상한", help: "재생 중인 곡은 빼고 세요. 0 이면 끔, 켜면 25 이상.\n곡이 수천 개면 셔플처럼 대기열 전체를 다시 쓰는 조작 동안 봇 전체가 잠깐 멈출 수 있어요. 1,000곡 안쪽을 권해요." },
  LEAVE_DELAY_QUEUE_EMPTY_SECONDS: { label: "대기열이 비면 나가기까지(초)", help: "대기열을 모두 재생한 뒤 음성 채널을 나가기까지 기다리는 시간. 0 이면 바로 나가요." },
  LEAVE_DELAY_ALONE_SECONDS: { label: "혼자 남으면 나가기까지(초)", help: "음성 채널에 봇만 남았을 때 나가기까지 기다리는 시간." },
  EMBED_COLOR: { label: "임베드 색", help: "왼쪽 동그라미를 눌러 선택하거나 #RRGGBB 형식으로 입력해요. 대시보드의 기본 색으로도 써요." },
  WEBSITE: { label: "봇 웹사이트 주소", help: "비우면 /help 에서 링크를 빼요. http · https 주소만." },
  VOICE_PLAYING_PREFIX: { label: "음성 상태: 재생 중 접두어", help: "음성 채널 상태에 곡 이름 앞에 붙여요. 띄어 쓰려면 끝에 공백까지 입력해요. 예: 📻 " },
  VOICE_PAUSED_PREFIX: { label: "음성 상태: 일시정지 접두어", help: "일시정지 중일 때 곡 이름 앞에 붙여요. 띄어 쓰려면 끝에 공백까지 입력해요. 예: ⏸ " },
  VOICE_IDLE_STATUS: { label: "음성 상태: 대기 중 문구", help: "재생할 곡이 없을 때 음성 채널 상태에 표시해요." },
  YTDLP_PLAYER_CLIENTS: { label: "유튜브 클라이언트 순서", help: "쉼표로 구분해 입력해요. 앞에서부터 시도하고 실패하면 뒤로 넘어가요. 비우면 yt-dlp 기본값.\n예: visionos,tv_simply,web_embedded,mweb" },
  YTDLP_CLIENT_WINDOW: { label: "최근 몇 번을 보고 판단할지", help: "클라이언트가 막혔는지 볼 때 최근 몇 번의 결과를 볼지." },
  YTDLP_CLIENT_FAILS: { label: "그중 몇 번 실패하면 건너뛸지", help: "위 횟수 가운데 이만큼 실패하면 그 클라이언트를 한동안 건너뛰어요." },
  YTDLP_CLIENT_RETRY_MINUTES: { label: "건너뛴 클라이언트를 다시 테스트하기까지(분)", help: "0 이면 봇을 다시 시작하거나 클라이언트 설정을 저장할 때까지 건너뛰어요." },
  YTDLP_LOOKUP_SLOTS: { label: "동시에 곡을 찾는 yt-dlp 수", help: "곡 찾기 · 검색 · 재생 주소처럼 사용자가 기다리는 일. 하나가 메모리를 수백 MB 써요(리눅스 노트북에서 약 400MB).\n0 이면 메모리 2GB마다 하나(2~8)." },
  YTDLP_BACKGROUND_SLOTS: { label: "동시에 다운로드 · 미리 받는 yt-dlp 수", help: "캐시 다운로드와 다음 곡 미리 받기. 0 이면 메모리 4GB마다 하나(2~4)." },
  COOKIES_SOURCE: { label: "쿠키 출처", help: "연령 제한 영상에만 써요. 쿠키 직접 입력이면 아래 유튜브 쿠키 카드에 입력한 쿠키를, 브라우저면 그 브라우저에서 가져와요.\n브라우저 프로필 등을 지정하려면 기타를 선택하고 yt-dlp 형식으로 입력해요(chrome:Profile 1 · firefox::컨테이너)." },
  BGUTIL_ENABLED: { label: "POToken 서버 사용", help: "설치돼 있을 때 켜면 봇과 함께 POToken 서버를 실행해요. mweb · tv_simply 클라이언트에 필요해요." },
  SPONSORBLOCK_ENABLED: { label: "SponsorBlock 사용", help: "끄면 조회 · 캐시를 아예 하지 않아요. 상업적으로 쓰면 꺼 두길 권해요(데이터 라이선스가 비상업)." },
  SPONSORBLOCK_CATEGORIES: { label: "기본으로 건너뛸 구간(서버 설정이 없을 때)", help: "" },
  SPONSORBLOCK_API_BASE: { label: "API 주소", help: "미러 · 직접 실행한 서버를 쓸 때만 바꿔요." },
  SPONSORBLOCK_HASH_PREFIX: { label: "해시 접두어 길이", help: "4~32. 짧을수록 어떤 영상을 조회하는지 덜 드러나고 응답은 커져요." },
  SPONSORBLOCK_TIMEOUT_MS: { label: "조회 제한 시간(ms)", help: "넘으면 저장해 둔 구간을 쓰거나 건너뛰기 없이 재생해요." },
  CACHE_MAX_SIZE_MB: { label: "최대 용량(MB)", help: "넘으면 오래 · 덜 들은 곡부터 지워요." },
  CACHE_MAX_FILES: { label: "최대 파일 수", help: "" },
  CACHE_MIN_FREE_DISK_MB: { label: "디스크 최소 여유(MB)", help: "드라이브 여유가 이보다 적으면 상한과 상관없이 지워요." },
  CACHE_EVICT_TARGET_PERCENT: { label: "정리 후 목표 비율(%)", help: "상한을 넘으면 상한의 이 비율까지 지워요(50~99). 여유를 두어 곧바로 다시 넘지 않게 해요." },
  CACHE_EVICT_INTERVAL_HOURS: { label: "정기 정리 간격(시간)", help: "" },
  CACHE_MAX_TRACK_MINUTES: { label: "캐시하지 않을 긴 곡(분)", help: "이보다 긴 곡은 다운로드하지 않고 스트리밍으로만 재생해요. 0 이면 상한 없음. 6시간짜리 곡은 다운로드하는 동안 800MB 가까이 써요." },
  STREAM_CHUNK_KB: { label: "청크 크기(KB)", help: "유튜브 스트림을 나눠 받는 크기. 1024KB 면 약 1분 분량. 권장 256~4096." },
  RATE_LIMIT_WINDOW_SEC: { label: "요청을 세는 구간(초)", help: "아래 값들을 세는 구간. 로그인 시도는 따로 세요." },
  RATE_LIMIT_API_MAX: { label: "구간당 일반 요청 수", help: "실시간 갱신 연결은 세지 않아요. 정상 사용에서 걸리면 늘리세요." },
  RATE_LIMIT_QUEUE_MAX: { label: "구간당 곡 추가 · 재생 테스트 요청 수", help: "둘 다 yt-dlp 를 실행하므로 따로 제한해요." },
  RATE_LIMIT_PUBLIC_MAX: { label: "구간당 로그인 없이 받는 요청 수(IP 마다)", help: "화면 파일 · 파비콘 · 로그인 배경 영상. 화면을 한 번 여는 데 100개 안쪽이에요. 한 공유기 뒤의 여러 사람은 한 IP 로 세요." },
  RATE_LIMIT_AUTH_WINDOW_SEC: { label: "로그인 시도를 세는 구간(초)", help: "" },
  RATE_LIMIT_AUTH_MAX: { label: "그 구간당 로그인 요청 수", help: "" },
  SSE_HEARTBEAT_SEC: { label: "실시간 연결 신호 간격(초)", help: "연결이 끊기지 않게 보내는 신호 간격(5~300)." },
  SSE_MAX_CONNECTIONS: { label: "사용자당 실시간 연결 수", help: "탭 · 창마다 하나. 플레이어 화면과 로그를 따로 세요." },
  SSE_COALESCE_MS: { label: "알림 합치기 간격(ms)", help: "같은 서버의 변경 알림을 이 시간 안에서 하나로 합쳐요." },
  AI_LOG_ENABLED: { label: "리퀘스트 로그 기록", help: "끄면 새 요청을 기록하지 않아요. 사용량 통계도 함께 멈춰요." },
  AI_LOG_MAX_MB: { label: "로그 저장 용량(MB)", help: "넘으면 오래된 로그부터 지워요. 사용량 통계는 지우지 않아요." },
};

const title = "운영 조절값";
const defaultWith = (value: string) => (value ? `기본값 ${value}` : "기본값: 비움");
const restartTip = "시작할 때 한 번 정하는 값이라 봇을 다시 시작해야 적용돼요.";
const pending = "저장함 · 다시 시작하면 적용";
const restartBadge = "다시 시작해야 적용";
const pickColor = "색 선택";
/** 유튜브 카드 머리의 설명서 단추 */
const youtubeDoc = "클라이언트 설명";
/** 쿠키 출처 고르기 */
const cookies = { none: "사용 안 함", file: "쿠키 직접 입력", browsers: "브라우저", otherGroup: "기타 형식", other: "기타(직접 입력)", otherPlaceholder: "예: chrome:Profile 1" };
const on = "켬";
const off = "끔";
const savedDone = "운영 조절값을 저장했어요";
/** names: 다시 시작해야 먹는 칸의 이름(· 로 이음) */
const savedRestart = (names: string) => `봇을 다시 시작해야 적용돼요: ${names}`;
const saveFailed = "운영 조절값을 저장하지 못했어요.";
const loadFailed = "운영 조절값을 읽지 못했어요.";

export { groups, fields, title, defaultWith, restartTip, pending, restartBadge, pickColor, youtubeDoc, cookies, on, off, savedDone, savedRestart, saveFailed, loadFailed };
