const path = require("path");
const fs = require("fs");

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일은 사용자가 직접 수정하기 위한 설정 파일이 아닙니다. `.env` 파일을 편집하십시오.
// ─────────────────────────────────────────────────────────────────────────────

const ENV_PATH = path.join(__dirname, ".env");
if (!fs.existsSync(ENV_PATH)) {
  console.error("❌ [config] .env 파일이 없습니다.");
  console.error("   프로젝트 루트의 .env.example 을 .env 로 복사한 뒤, 파일 안의 주석을 참고해 값을 채우세요.");
  process.exit(1);
}
require("dotenv").config({ path: ENV_PATH, quiet: true });

// .env 값 읽기 — 키가 없거나 공백뿐이면 def 반환
function env(key, def = null) {
  const v = process.env[key];
  return v !== undefined && v.trim() !== "" ? v : def;
}

// env()의 정수 버전 — 값이 숫자가 아니거나 허용 범위를 벗어나면 경고 후 def 반환
// (오타를 조용히 삼키지 않음 — 1ms급 타이머·무효 포트·음수 캐시 한도 같은 오설정 방지)
function envInt(key, def, { min, max } = {}) {
  const v = env(key);
  if (v === null) return def;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) {
    console.warn(`⚠️  [config] ${key}=${v} 이/가 숫자가 아닙니다 — 기본값 ${def}을(를) 사용합니다.`);
    return def;
  }
  if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
    console.warn(`⚠️  [config] ${key}=${n} 이/가 허용 범위(${min ?? "-∞"}~${max ?? "∞"})를 벗어납니다 — 기본값 ${def}을(를) 사용합니다.`);
    return def;
  }
  return n;
}

function resolveFromRoot(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(__dirname, p);
}

// SponsorBlock skip 지원 카테고리 (권위 목록 — src/SponsorBlock.js의 SKIP_CATEGORIES와 동기 유지)
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
  console.error("❌ [config] DISCORD_TOKEN 또는 CLIENT_ID가 비어 있습니다.");
  console.error("   .env.example 의 주석을 참고해 .env 에 값을 채운 뒤 다시 실행하세요.");
  console.error("   (발급: https://discord.com/developers/applications)");
  process.exit(1);
}
if (!env("CLIENT_SECRET")) {
  console.warn("⚠️  [config] CLIENT_SECRET 미설정 — 대시보드의 Discord 로그인(OAuth)이 동작하지 않습니다.");
}
if (!env("SPOTIFY_CLIENT_ID") || !env("SPOTIFY_CLIENT_SECRET")) {
  console.warn("⚠️  [config] Spotify API 키 미설정 — Spotify 검색/링크 기능이 비활성화됩니다.");
}

const dashboardPort = envInt("DASHBOARD_PORT", 33333, { min: 1, max: 65535 });

// 오리지널 프로젝트의 공개 저장소 — AGPL 소스 고지의 기본값 (사용자 설정 아님).
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

  // 봇 설정
  bot: {
    defaultVolume: 100,
    maxQueueSize: 100,
    maxPlaylistSize: 50,
    embedColor: env("EMBED_COLOR", "#2743D2"),
    supportServer: env("SUPPORT_SERVER"),
    website: env("WEBSITE"),
    projectRepo: PROJECT_REPO,
    sourceRepo: env("SOURCE_REPO_URL", PROJECT_REPO),
    invite: "https://discord.com/oauth2/authorize?client_id=" + env("CLIENT_ID") + "&permissions=8&scope=bot%20applications.commands",
    leaveDelayQueueEmptyMs: envInt("LEAVE_DELAY_QUEUE_EMPTY_SECONDS", 600, { min: 0, max: 86400 }) * 1000,
    leaveDelayAloneMs: envInt("LEAVE_DELAY_ALONE_SECONDS", 120, { min: 0, max: 86400 }) * 1000,
  },

  // 사전 로드 설정 — MusicPlayer/MusicEmbedManager가 공유 (내부 튜닝 상수, .env 대상 아님)
  preload: {
    ahead: 5, // 대기열 앞쪽 몇 곡을 미리 준비할지 (한 번에 전부는 YouTube에 부담)
    gapMs: 3000, // 사전 로드 사이 간격 (YouTube 속도 제한 회피)
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
  },

  // 대시보드 설정
  dashboard: {
    port: dashboardPort,
    url: env("DASHBOARD_URL", `http://localhost:${dashboardPort}`),
    ownerId: env("OWNER_ID"),
    // 세션 쿠키 서명 비밀. 미설정 시 기동마다 랜덤 생성(보안은 유지되나 재시작 시 대시보드 로그인 풀림) — 기동 로그에 경고
    sessionSecret: env("SESSION_SECRET"),
    // API 요청 제한 (config.js 기본값 + .env 오버라이드). 정상 사용(5초 폴링=12/분, 플레이리스트도 1요청)을
    // 넉넉히 넘는 값 — 도배만 차단.
    rateLimit: {
      windowMs: envInt("RATE_LIMIT_WINDOW_SEC", 60, { min: 1, max: 3600 }) * 1000,
      apiMax: envInt("RATE_LIMIT_API_MAX", 120, { min: 1 }), // 일반 인증 API (/api/*)
      queueMax: envInt("RATE_LIMIT_QUEUE_MAX", 20, { min: 1 }), // 곡 추가 (POST /player/queue)
      authWindowMs: envInt("RATE_LIMIT_AUTH_WINDOW_SEC", 600, { min: 1, max: 86400 }) * 1000,
      authMax: envInt("RATE_LIMIT_AUTH_MAX", 30, { min: 1 }), // 로그인/OAuth (/auth/*)
    },
    // 실시간 갱신(SSE) — 플레이어 상태 변화 넛지. 값은 config.js 기본값 + .env 오버라이드.
    sse: {
      heartbeatMs: envInt("SSE_HEARTBEAT_SEC", 20, { min: 5, max: 300 }) * 1000, // 유휴 연결 keepalive
      maxPerUser: envInt("SSE_MAX_CONNECTIONS", 5, { min: 1, max: 100 }), // 세션당 동시 연결 캡
      coalesceMs: envInt("SSE_COALESCE_MS", 300, { min: 0, max: 5000 }), // 길드당 넛지 합치기 창
    },
  },

  // 오디오 캐시 설정
  cache: {
    maxSizeBytes: envInt("CACHE_MAX_SIZE_MB", 1024, { min: 1 }) * 1024 * 1024,
    maxFiles: envInt("CACHE_MAX_FILES", 500, { min: 1 }),
    minFreeDiskBytes: envInt("CACHE_MIN_FREE_DISK_MB", 2048, { min: 0 }) * 1024 * 1024,
    evictIntervalMs: envInt("CACHE_EVICT_INTERVAL_HOURS", 4, { min: 1, max: 168 }) * 3600 * 1000,
  },

  // SponsorBlock — 비음악 구간 자동 스킵 (src/SponsorBlock.js). 세그먼트 데이터: sponsor.ajay.app (CC BY-NC-SA 4.0).
  // enabled=false 면 API 호출·캐싱이 전부 무동작 — 상업적 이용 시 데이터 라이선스(비상업)를 피하는 마스터 스위치.
  sponsorblock: {
    enabled: env("SPONSORBLOCK_ENABLED", "true") !== "false",
    apiBase: (env("SPONSORBLOCK_API_BASE", "https://sponsor.ajay.app") || "").replace(/\/+$/, ""),
    hashPrefixLen: envInt("SPONSORBLOCK_HASH_PREFIX", 5, { min: 4, max: 32 }),
    timeoutMs: envInt("SPONSORBLOCK_TIMEOUT_MS", 1000, { min: 100, max: 10000 }),
    // 서버별 미설정 시 기본으로 자동 스킵할 카테고리 (서버별 설정이 오버라이드 — 후속 PR)
    categories: parseSbCategories(env("SPONSORBLOCK_CATEGORIES", "music_offtopic,intro,outro")),
  },

  // 음성 채널 상태 설정
  voiceStatus: {
    playingPrefix: env("VOICE_PLAYING_PREFIX", ""),
    pausedPrefix: env("VOICE_PAUSED_PREFIX", ""),
    idleText: env("VOICE_IDLE_STATUS", ""),
  },

  // 샤딩 설정 (for bots in 1000+ servers)
  sharding: {
    totalShards: env("TOTAL_SHARDS", "auto"),
    shardList: env("SHARD_LIST", "auto"),
    mode: env("SHARD_MODE", "process"),
    respawn: env("SHARD_RESPAWN", "true") !== "false",
    spawnDelay: envInt("SHARD_SPAWN_DELAY", 5500, { min: 0, max: 60000 }),
    spawnTimeout: envInt("SHARD_SPAWN_TIMEOUT", 30000, { min: -1, max: 600000 }), // -1 = 무제한 (discord.js)
  },
};
