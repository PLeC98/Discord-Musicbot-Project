const path = require("path");
const log = require("./src/logger").child({ category: "config" });
const fs = require("fs");
const { parseClients } = require("./src/PlayerClients");

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일은 사용자가 직접 수정하기 위한 설정 파일이 아닙니다. `.env` 파일을 편집하십시오.
// ─────────────────────────────────────────────────────────────────────────────

const ENV_PATH = path.join(__dirname, ".env");
if (!fs.existsSync(ENV_PATH)) {
  log.error(".env 파일이 없습니다. 프로젝트 루트의 .env.example 을 .env 로 복사한 뒤, 파일 안의 주석을 참고해 값을 채우세요.");
  process.exit(1);
}
require("dotenv").config({ path: ENV_PATH, quiet: true });

// .env 값 읽기. 키가 없거나 공백뿐이면 def 반환
function env(key, def = null) {
  const v = process.env[key];
  return v !== undefined && v.trim() !== "" ? v : def;
}

/**
 * 잘못 적은 설정값은 기동을 멈춘다.
 *
 * 조용히 기본값으로 돌면 "왜 내가 설정한 값이 안 먹지"가 되고, 경고만 남기면 로그를 보지 않는
 * 사이 의도하지 않은 값으로 계속 돈다. 비워 두는 것은 "기본값을 쓰겠다"는 뜻이라 통과시킨다.
 */
function invalid(key, value, reason) {
  log.error(`.env의 ${key} 값이 잘못됐습니다 (${value}): ${reason}. 고친 뒤 다시 실행하세요.`);
  process.exit(1);
}

function envEnum(key, def, allowed) {
  const v = env(key);
  if (v === null) return def;
  const lower = String(v).trim().toLowerCase();
  if (allowed.includes(lower)) return lower;
  invalid(key, v, `${allowed.join("·")} 중 하나여야 합니다`);
}

// parseInt는 "120junk"를 120으로 삼킨다. 숫자만 있는지 먼저 보고, 범위와 안전 정수까지 확인한다.
function envInt(key, def, { min, max } = {}) {
  const v = env(key);
  if (v === null) return def;

  const raw = String(v).trim();
  if (!/^-?\d+$/.test(raw)) invalid(key, v, "정수만 쓸 수 있습니다");

  const n = Number(raw);
  if (!Number.isSafeInteger(n)) invalid(key, v, "다룰 수 있는 범위를 넘는 수입니다");
  if (min !== undefined && n < min) invalid(key, v, `${min} 이상이어야 합니다`);
  if (max !== undefined && n > max) invalid(key, v, `${max} 이하여야 합니다`);
  return n;
}

// 링크로 내보내는 주소. 형식이 깨졌거나 javascript: 같은 스킴이면 기동을 멈춘다.
function envUrl(key, def = null) {
  const v = env(key);
  if (v === null) return def;

  let parsed;
  try {
    parsed = new URL(v);
  } catch {
    invalid(key, v, "주소 형식이 아닙니다 (예: https://example.com)");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") invalid(key, v, "http·https 주소만 쓸 수 있습니다");
  return v;
}

// 대기열 상한. 0이면 끔. 켜면 하한이 있다: 그 아래는 사전 캐싱(앞 5곡) 버퍼밖에 안 된다
const QUEUE_MAX_FLOOR = 25;
function envQueueMax(key, def) {
  const n = envInt(key, def, { min: 0 });
  if (n !== 0 && n < QUEUE_MAX_FLOOR) invalid(key, n, `0(끔)이거나 ${QUEUE_MAX_FLOOR} 이상이어야 합니다`);
  return n;
}

function resolveFromRoot(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(__dirname, p);
}

// SponsorBlock skip 지원 카테고리 (권위 목록. src/SponsorBlock.js의 SKIP_CATEGORIES와 동기 유지)
const SB_SKIP_CATEGORIES = ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "hook", "filler", "music_offtopic"];
// 콤마 구분 문자열 → 유효 카테고리 배열 (오타·미지원 값은 조용히 제거, 원칙 4: 형식 오류는 걸러냄)
function parseSbCategories(raw) {
  const valid = new Set(SB_SKIP_CATEGORIES);
  return [
    ...new Set(
      String(raw)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => valid.has(s)),
    ),
  ];
}

// ── 기동 검증: 자격증명 ───────────────────────────────────────────────────────
// 필수 자격증명이 없으면 기동 중단. 기능 한정 자격증명은 경고 후 해당 기능만 비활성.

if (!env("DISCORD_TOKEN") || !env("CLIENT_ID")) {
  log.error("DISCORD_TOKEN 또는 CLIENT_ID가 비어 있습니다. .env.example 의 주석을 참고해 .env 에 값을 채운 뒤 다시 실행하세요.");
  process.exit(1);
}
if (!env("CLIENT_SECRET")) {
  log.warn("CLIENT_SECRET 미설정. 대시보드의 Discord 로그인(OAuth)이 동작하지 않습니다.");
}
if (!env("SPOTIFY_CLIENT_ID") || !env("SPOTIFY_CLIENT_SECRET")) {
  log.warn("Spotify API 키 미설정. 트랙/앨범/검색은 비활성, 재생목록/아티스트는 자격증명 없이 동작합니다.");
}

const dashboardPort = envInt("DASHBOARD_PORT", 33333, { min: 1, max: 65535 });

// 오리지널 프로젝트의 공개 저장소. AGPL 소스 고지의 기본값 (사용자 설정 아님).
// 코드를 수정해 운영하는 경우에만 .env의 SOURCE_REPO_URL로 수정본 저장소를 지정해 교체.
const PROJECT_REPO = "https://github.com/PLeC98/Discord-Musicbot-Project";

module.exports = {
  // 디스코드 봇 설정
  discord: {
    token: env("DISCORD_TOKEN"),
    clientId: env("CLIENT_ID"),
    clientSecret: env("CLIENT_SECRET"),
    guildId: env("GUILD_ID"),
  },

  // 스포티파이 API 설정
  spotify: {
    clientId: env("SPOTIFY_CLIENT_ID"),
    clientSecret: env("SPOTIFY_CLIENT_SECRET"),
  },

  // 자동재생 소스 자격증명. 없으면 그 소스만 못 쓴다. config/genres.yaml에서 어느 장르가
  // 그 소스를 쓰는지 보고 기동 시점에 경고하거나 거부한다(src/configDataLoader.js).
  sources: {
    lastfmKey: env("LASTFM_API_KEY"),
    listenbrainzToken: env("LISTENBRAINZ_TOKEN"),
  },

  // 봇 설정
  bot: {
    defaultVolume: 100,
    maxQueueSize: envQueueMax("QUEUE_MAX_TRACKS", 250), // 대기열 곡 수 상한(재생 중인 곡 제외), 0이면 끔
    playlistAddDefault: 50, // 재생목록을 넣을 때 한 번에 들어가는 곡 수. 서버 설정(/setplaylistlimit)이 없을 때
    embedColor: env("EMBED_COLOR", "#2743D2"),
    supportServer: envUrl("SUPPORT_SERVER"),
    website: envUrl("WEBSITE"),
    projectRepo: PROJECT_REPO,
    sourceRepo: envUrl("SOURCE_REPO_URL", PROJECT_REPO),
    invite: "https://discord.com/oauth2/authorize?client_id=" + env("CLIENT_ID") + "&permissions=8&scope=bot%20applications.commands",
    leaveDelayQueueEmptyMs: envInt("LEAVE_DELAY_QUEUE_EMPTY_SECONDS", 600, { min: 0, max: 86400 }) * 1000,
    leaveDelayAloneMs: envInt("LEAVE_DELAY_ALONE_SECONDS", 120, { min: 0, max: 86400 }) * 1000,
  },

  // 사전 로드 설정. MusicPlayer/MusicEmbedManager가 공유 (내부 튜닝 상수, .env 대상 아님)
  preload: {
    ahead: 5, // 대기열 앞쪽 몇 곡을 미리 준비할지 (한 번에 전부는 YouTube에 부담)
    gapMs: 3000, // 사전 로드 사이 간격 (YouTube 속도 제한 회피)
    tickMs: 3000, // 대기열 점검 주기. 실제 반응은 최대 2틱. 조작이 멎은 뒤에 움직이므로
  },

  // 오디오 설정
  audio: {
    quality: "highestaudio",
    format: "mp3",
    bitrate: 320,
    filters: {
      bassboost: "bass=g=20",
      nightcore: "aresample=48000,asetrate=48000*1.25",
      vaporwave: "aresample=48000,asetrate=48000*0.8",
      _8d: "apulsator=hz=0.09",
    },
  },

  // ffmpeg 실행 파일. 미지정이면 src/ffmpegPath.js가 자동 탐색(bin/의 번들 → PATH).
  // macOS는 자동 다운로드 대상이 아니므로 여기로 지정하거나 PATH에 두어야 한다(brew install ffmpeg).
  ffmpeg: {
    path: resolveFromRoot(env("FFMPEG_PATH")),
  },

  ytdl: {
    requestOptions: {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      },
    },
    format: "bestaudio[ext=webm+acodec=opus+asr=48000]/bestaudio",
    filter: "audioonly",
    quality: "highestaudio",
    highWaterMark: 1 << 25,
    cookiesFromBrowser: env("COOKIES_FROM_BROWSER"),
    cookiesFile: resolveFromRoot(env("COOKIES_FILE")),

    // 재생용 player_client 순서. 비우면 지정하지 않는다 = yt-dlp 기본값 그대로.
    // 여러 개를 한 번에 넘기면 yt-dlp가 전부 호출해 병합하므로, 우리가 하나씩 넘긴다(src/YouTube.js).
    playerClients: parseClients(env("YTDLP_PLAYER_CLIENTS")),
    // "최근 window회 중 fails회 실패"면 그 클라이언트를 이번 실행 동안 제외한다.
    // 연속 실패로 세지 않는 이유는 src/PlayerClients.js 머리말 참조.
    clientWindow: envInt("YTDLP_CLIENT_WINDOW", 5, { min: 2, max: 50 }),
    clientFails: envInt("YTDLP_CLIENT_FAILS", 3, { min: 1, max: 50 }),
  },

  // POToken 공급자(bgutil). 설치돼 있어도 이 값이 true일 때만 띄운다.
  // 쓰지 않을 서버를 상시 띄울 이유가 없다(인증 없는 로컬 HTTP 서버라 표면도 는다).
  bgutil: {
    enabled: env("BGUTIL_ENABLED", "false") === "true",
  },

  // 대시보드 설정
  dashboard: {
    port: dashboardPort,
    // 바인딩 주소. 기본은 루프백. 모르는 사이에 외부로 열려 있는 상태를 만들지 않는다.
    // 다른 기기에서 접속하려면 0.0.0.0 (HTTPS 리버스 프록시 뒤에 두는 것을 전제).
    host: env("DASHBOARD_HOST", "127.0.0.1"),
    url: envUrl("DASHBOARD_URL", `http://localhost:${dashboardPort}`),
    ownerId: env("OWNER_ID"),
    // Vite 개발 서버(5173)를 CORS 허용 목록에 넣을지. `pnpm run dev`가 켠다. 평상시 실행은 닫힌다.
    devOrigin: env("DASHBOARD_DEV_ORIGIN") === "true",
    // 세션 쿠키 서명 비밀. 미설정 시 기동마다 랜덤 생성(보안은 유지되나 재시작 시 대시보드 로그인 풀림). 기동 로그에 경고
    sessionSecret: env("SESSION_SECRET"),
    // API 요청 제한 (config.js 기본값 + .env 오버라이드). 정상 사용(5초 폴링=12/분, 플레이리스트도 1요청)을
    // 넉넉히 넘는 값. 도배만 차단.
    rateLimit: {
      windowMs: envInt("RATE_LIMIT_WINDOW_SEC", 60, { min: 1, max: 3600 }) * 1000,
      apiMax: envInt("RATE_LIMIT_API_MAX", 120, { min: 1, max: 100000 }), // 일반 인증 API (/api/*)
      queueMax: envInt("RATE_LIMIT_QUEUE_MAX", 20, { min: 1, max: 100000 }), // 곡 추가 (POST /player/queue)
      authWindowMs: envInt("RATE_LIMIT_AUTH_WINDOW_SEC", 600, { min: 1, max: 86400 }) * 1000,
      authMax: envInt("RATE_LIMIT_AUTH_MAX", 30, { min: 1, max: 100000 }), // 로그인/OAuth (/auth/*)
    },
    // 실시간 갱신(SSE). 플레이어 상태 변화 넛지. 값은 config.js 기본값 + .env 오버라이드.
    sse: {
      heartbeatMs: envInt("SSE_HEARTBEAT_SEC", 20, { min: 5, max: 300 }) * 1000, // 유휴 연결 keepalive
      maxPerUser: envInt("SSE_MAX_CONNECTIONS", 5, { min: 1, max: 100 }), // 세션당 동시 연결 캡
      coalesceMs: envInt("SSE_COALESCE_MS", 300, { min: 0, max: 5000 }), // 서버당 넛지 합치기 창
    },
  },

  // 오디오 캐시 설정
  cache: {
    maxSizeBytes: envInt("CACHE_MAX_SIZE_MB", 1024, { min: 1, max: 1048576 }) * 1024 * 1024,
    maxFiles: envInt("CACHE_MAX_FILES", 500, { min: 1, max: 1000000 }),
    minFreeDiskBytes: envInt("CACHE_MIN_FREE_DISK_MB", 2048, { min: 0, max: 1048576 }) * 1024 * 1024,
    evictIntervalMs: envInt("CACHE_EVICT_INTERVAL_HOURS", 4, { min: 1, max: 168 }) * 3600 * 1000,
  },

  // SponsorBlock. 비음악 구간 자동 스킵 (src/SponsorBlock.js). 세그먼트 데이터: sponsor.ajay.app (CC BY-NC-SA 4.0).
  // enabled=false 면 API 호출·캐싱이 전부 무동작. 상업적 이용 시 데이터 라이선스(비상업)를 피하는 마스터 스위치.
  sponsorblock: {
    enabled: env("SPONSORBLOCK_ENABLED", "true") !== "false",
    apiBase: (env("SPONSORBLOCK_API_BASE", "https://sponsor.ajay.app") || "").replace(/\/+$/, ""),
    hashPrefixLen: envInt("SPONSORBLOCK_HASH_PREFIX", 5, { min: 4, max: 32 }),
    timeoutMs: envInt("SPONSORBLOCK_TIMEOUT_MS", 1000, { min: 100, max: 10000 }),
    // 서버별 미설정 시 기본으로 자동 스킵할 카테고리 (서버별 설정이 오버라이드. 후속 PR)
    categories: parseSbCategories(env("SPONSORBLOCK_CATEGORIES", "music_offtopic,intro,outro")),
  },

  // 음성 채널 상태 설정
  voiceStatus: {
    playingPrefix: env("VOICE_PLAYING_PREFIX", ""),
    pausedPrefix: env("VOICE_PAUSED_PREFIX", ""),
    idleText: env("VOICE_IDLE_STATUS", ""),
  },

  // 재생 스트림 수신. googlevideo는 순차 GET을 재생시간의 약 2배속으로 조인다(src/chunkedStream.js).
  stream: {
    chunkBytes: envInt("STREAM_CHUNK_KB", 1024, { min: 64, max: 65536 }) * 1024,
  },

  // 로그 파일 (NDJSON). 터미널·대시보드와 별개로 디스크에 남긴다. 사후 분석용.
  logging: {
    // 무엇을 기록할 것인가 (터미널·파일·대시보드 전부의 상한).
    // 조사용 로그를 지우지 않고 debug로 내려둔 뒤, 필요할 때만 이걸 낮춰 되살린다.
    level: envEnum("LOG_LEVEL", "info", ["trace", "debug", "info", "warn", "error", "fatal"]),
    // 그중 터미널에 찍을 것. LOG_LEVEL=debug + LOG_CONSOLE_LEVEL=info 로 두면
    // 파일·대시보드는 debug를 받고 터미널만 조용하다.
    consoleLevel: envEnum("LOG_CONSOLE_LEVEL", "", ["", "trace", "debug", "info", "warn", "error", "fatal"]),
    // 기본은 끔. 모든 운영자가 파일 로그를 원하지는 않는다. 필요한 사람이 켠다.
    fileEnabled: env("LOG_FILE_ENABLED", "false") === "true",
    file: resolveFromRoot(env("LOG_FILE", "logs/bot.log")),
    // 두 값 모두 0 = "그 축에는 제한 없음". 크기 0이면 회전하지 않고, 개수 0이면 지우지 않는다.
    maxBytes: envInt("LOG_FILE_MAX_MB", 20, { min: 0, max: 10240 }) * 1024 * 1024,
    keep: envInt("LOG_FILE_KEEP", 5, { min: 0, max: 1000 }),
  },
};
