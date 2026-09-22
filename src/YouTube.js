const path = require("path");
const log = require("./logger").child({ category: "youtube" });
const fs = require("fs");
// youtube-dl-exec 직접 호출 금지. spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
const youtubedl = require("./ytdlp");
const config = require("../config");
const CacheManager = require("./CacheManager");
const { ffmpegPath } = require("./ffmpegPath");

// yt-dlp의 --plugin-dirs는 하위 디렉터리마다 yt_dlp_plugins가 들어 있는 루트를 기대한다
// (`<지정한 경로>/<아무 이름>/yt_dlp_plugins/...`). yt_dlp_plugins를 직접 담은 디렉터리를 주면
// 한 단계 더 들어가 찾다가 아무것도 못 찾고 조용히 넘어간다. 오류도 경고도 없다.
// 그래서 plugin/ 이 아니라 그 부모인 저장소 루트를 넘긴다.
const BGUTIL_DIR = path.join(__dirname, "..", "bgutil-ytdlp-pot-provider");

// 있는지 확인하는 것으로 그치지 않고 yt-dlp의 규칙 그대로 훑는다.
// 경로만 확인하면 상대 위치가 또 어긋났을 때 다시 조용히 죽는다. 그 사고가 이미 한 번 났다.
function findPluginRoot(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null; // 설치 안 됨
  }
  for (const e of entries) {
    if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, "yt_dlp_plugins"))) return path.join(dir, e.name, "yt_dlp_plugins");
  }
  return null;
}

const BGUTIL_PLUGIN_ROOT = findPluginRoot(BGUTIL_DIR);
const BGUTIL_AVAILABLE = BGUTIL_PLUGIN_ROOT !== null;

const { PlayerClients, NEEDS_POT, KNOWN } = require("./PlayerClients");
const playerClients = new PlayerClients(config.ytdlp.playerClients, { window: config.ytdlp.clientWindow, fails: config.ytdlp.clientFails });

// 어긋난 미디어 주소를 다시 받기 전에 잠깐 쉰다. 곧바로 다시 물으면 같은 것을 받기 쉽다.
const STALE_RETRY_MS = 700;

// 쓸 때 부른다. configDataLoader 가 autoplaySources 를 거쳐 이 파일로 돌아오는 길이 있다
const configData = () => require("./configDataLoader");

// 지금 쿠키 파일을 쥔 채 도는 yt-dlp 가 몇 개인가. 대시보드가 쿠키를 갈아 끼울 때 본다.
// yt-dlp 는 끝나면서 쿠키 항아리를 그 파일에 되쓰므로, 도는 중에 갈아 끼우면 옛것으로 되돌아간다.
let cookieRuns = 0;

class YouTube {
  // yt-dlp용 공통 매개변수를 반환하는 헬퍼 함수
  static getYtDlpOptions(extraOptions = {}, { forceCookies = false } = {}) {
    const baseOptions = {
      // noWarnings를 켜지 않는다. yt-dlp의 경고에는 우리가 봐야 할 것이 섞여 있다
      // ("이 클라이언트는 POToken이 필요하다" 등). 평상시 경고량은 0건으로 실측했다
      // (2026-09-11, 제목조회·스트림URL·검색·실다운로드 13회). ERROR는 원래 이 옵션과 무관하다.
      retries: 3,
      fragmentRetries: 3,
      // 재생과 같은 ffmpeg를 쓰게 한다. 지정하지 않으면 yt-dlp가 PATH에서 제멋대로 찾아
      // 재생(ffmpegPath 해석기)과 캐시 변환이 서로 다른 바이너리를 쓰게 된다. 실제로 그래왔다.
      ffmpegLocation: ffmpegPath(),
      jsRuntimes: `node:${process.execPath}`,
      // User-Agent를 우리가 덮지 않는다. yt-dlp는 클라이언트마다 다른 값을 골라 주고, 그 값이
      // http_headers로 실려 와 재생 요청 헤더가 된다. 우리가 덮으면 그게 낡은 단일 값으로 뭉개진다.
      ...(YouTube.potEnabled() && { pluginDirs: BGUTIL_DIR }),
      ...extraOptions,
    };

    // 인증 모델: 평상시 쿠키 없이, 연령 제한에만 쿠키. bgutil 유무와 무관하다.
    // 쿠키는 계정 밴 위험이 있다. 노출 지점을 연령 제한 한 곳으로 묶는다.
    //    "player_client=ios 강제" 폴백은 금지. ios는 자체 POT 없이 포맷을 안 주고
    //    bgutil도 ios용 POT은 못 만들어 전 영상 재생 불능이 됐다.
    if (forceCookies) {
      if (config.ytdlp.cookiesFromBrowser) {
        baseOptions.cookiesFromBrowser = config.ytdlp.cookiesFromBrowser;
      } else if (config.ytdlp.useCookieFile && configData().cookiesReady()) {
        baseOptions.cookies = configData().cookiesPath();
      }
    }

    return baseOptions;
  }

  /** POToken 공급자를 실제로 쓰는가. 설치돼 있고 + 켜져 있을 때만 */
  static potEnabled() {
    return BGUTIL_AVAILABLE && config.bgutil.enabled;
  }

  /**
   * 기동 시 한 줄로 인증 상태를 남긴다. "지금 무엇으로 유튜브에 붙고 있나"를 한눈에.
   */
  static logAuthMode() {
    const clients = config.ytdlp.playerClients;
    const pot = this.potEnabled() ? "사용" : config.bgutil.enabled ? "설정됨(설치 없음)" : "미사용";
    // 파일 방식인데 아직 안 올렸으면 그렇다고 적는다. 연령 제한 영상이 나오고서야 아는 것보다 낫다
    const cookie = config.ytdlp.cookiesFromBrowser ? `브라우저 ${config.ytdlp.cookiesFromBrowser}(연령 제한 폴백 전용)` : config.ytdlp.useCookieFile ? (configData().cookiesReady() ? "파일(연령 제한 폴백 전용)" : "파일(아직 비어 있음. 대시보드에서 넣으세요)") : "없음";
    log.info({ tags: ["startup"] }, `재생 인증: 클라이언트=${clients.length ? clients.join(",") : "yt-dlp 기본값"} | POToken=${pot} | 쿠키=${cookie}`);

    // POToken이 있어야 제대로 도는 클라이언트를 적어놓고 공급자를 안 켰으면 알려준다.
    // 막지는 않는다. 이 표는 오늘의 유튜브일 뿐이고, 진짜 판정은 실행이 한다.
    const needy = clients.filter((c) => NEEDS_POT.includes(c));
    if (needy.length && !this.potEnabled()) {
      log.warn(`${needy.join(", ")} 은(는) POToken이 있어야 제대로 동작합니다. BGUTIL_ENABLED=true로 켜거나 목록에서 빼세요`);
    }

    // 우리가 아는 목록에 없는 이름. 걸러내지 않는다. yt-dlp가 새로 추가한 것일 수 있고,
    // 유효한지는 yt-dlp가 판단한다. 알고 넣은 사람은 이 줄을 무시하면 되고,
    // 오타였다면 "넣으라는 대로 넣었는데 왜?"의 답이 여기 있다.
    const unknown = clients.filter((c) => !KNOWN.includes(c));
    if (unknown.length) {
      log.warn(`${unknown.join(", ")} 은(는) 확인된 클라이언트 목록에 없습니다. yt-dlp가 받아들이면 그대로 동작하고, 아니면 아래에 경고가 뜹니다`);
    }
  }

  /**
   * 대시보드용. 지금 유튜브에 어떻게 붙고 있고, 어느 경로가 살아 있나.
   * 기동 로그는 시작 시점의 설정만 보여주지만 여기는 실행 중 바뀌는 상태(제외된 경로)를 담는다.
   */
  static statusSnapshot() {
    const snap = playerClients.snapshot();
    const fails = (h) => (h || []).filter((x) => x === "ng").length;
    return {
      pot: this.potEnabled() ? "on" : config.bgutil.enabled ? "missing" : "off",
      cookies: config.ytdlp.cookiesFromBrowser ? "browser" : config.ytdlp.useCookieFile ? "file" : "none",
      configured: snap.order.length > 0,
      clients: snap.order.map((name) => ({
        name,
        excluded: snap.excluded.includes(name),
        tried: (snap.history[name] || []).length,
        failed: fails(snap.history[name]),
        needsPot: NEEDS_POT.includes(name),
        known: KNOWN.includes(name),
      })),
    };
  }

  /**
   * 쿠키(브라우저/파일)를 지금 쓸 수 있는가. 연령 제한 폴백 가능 여부.
   *
   * 파일 쪽은 기동 시점이 아니라 물어볼 때마다 본다. 대시보드로 갈아 끼우면 봇을 다시 띄우지
   * 않아도 다음 판정부터 반영돼야 한다. 빈도가 낮아(연령 제한에서만 불린다) stat 값이 아깝지 않다.
   */
  static cookiesConfigured() {
    if (config.ytdlp.cookiesFromBrowser) return true;
    return config.ytdlp.useCookieFile && configData().cookiesReady();
  }

  /** 쿠키 파일을 쥔 채 도는 yt-dlp 수. 0이 아니면 지금 갈아 끼운 것이 되돌아갈 수 있다 */
  static cookieRunsInFlight() {
    return cookieRuns;
  }

  /**
   * yt-dlp 오류를 로그에 남길 만큼으로 줄인다.
   *
   * yt-dlp는 안에서 여러 번 재시도하고 그때마다 같은 경고를 stderr에 다시 쓴다. 그대로 부으면
   * 한 번 실패에 같은 줄이 대여섯 개씩 쌓여 그 위의 재생 로그를 덮는다.
   *
   * 겹친 줄만 접고 내용은 지우지 않는다. 원인이 WARNING에, 결과가 ERROR에 나뉘어 적히는 경우가
   * 있어서다(쿠키가 무효 → 연령 확인을 요구받음). 한쪽만 남기면 왜 실패했는지를 잃는다.
   */
  static briefError(error, maxLines = 4) {
    const raw = (error && (error.stderr || error.message)) || String(error || "");
    const seen = new Set();
    const lines = [];
    for (const one of String(raw).split(/\r?\n/)) {
      const line = one.trim();
      if (!line || seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
    if (lines.length <= maxLines) return lines.join("\n");
    return `${lines.slice(0, maxLines).join("\n")}\n(외 ${lines.length - maxLines}줄)`;
  }

  /** yt-dlp 오류가 연령 제한(로그인 필요)인지 판별 */
  static isAgeRestrictedError(error) {
    const msg = (error && (error.stderr || error.message)) || String(error || "");
    return /confirm your age|inappropriate for some users/i.test(msg);
  }

  /**
   * yt-dlp 오류가 "영상 자체가 내려감/삭제/비공개"인지 판별.
   * 캐시된 매핑의 영상이 사라진 경우 재검색으로 보내기 위한 신호.
   *   일시적 네트워크·봇 감지·연령 제한과는 구별(그것들은 재검색 대상 아님).
   */
  static isVideoUnavailableError(error) {
    // 연령 제한을 먼저 뺀다. 쿠키가 무효일 때 yt-dlp 가 내는 "cookies are no longer valid" 가
    // 아래의 "no longer available" 과 한 단어 차이라, 정규식이 넓어지는 순간 살아 있는 영상이
    // 내려간 것으로 분류된다. 자동재생은 그 판정으로 곡을 영구히 버리므로(markDead) 대가가 크다.
    // 옆의 isClientFault·isStaleMediaError 도 같은 가드를 갖고 있다.
    if (this.isAgeRestrictedError(error)) return false;

    const msg = (error && (error.stderr || error.message)) || String(error || "");
    return /video unavailable|no longer available|has been removed|removed by (the )?(uploader|user)|private video|account associated with this video has been terminated|this video is not available|content isn.?t available|violat(?:ing|ion) of youtube/i.test(msg);
  }

  /**
   * ytsearch 결과 항목이 "재생 가능한 단일 비디오"인지 판별.
   * yt-dlp flat 검색은 채널/재생목록/핸들을 섞어 반환하므로 이들을 제외한다.
   * 비디오 id는 11자, 채널은 UC…(24자)·/channel//@handle//playlist 형태.
   */
  /**
   * yt-dlp 응답이 "지금 진행 중이거나 예정된 라이브"인지 판별.
   * 라이브는 끝이 없어 캐시 다운로드가 무한히 커지고(yt-dlp가 ffmpeg를 외부 다운로더로 띄운다),
   * Spotify 동등물 후보로서는 언제나 오답이다. flat 검색 항목/상세 정보 양쪽에 같은 필드가 온다.
   */
  static _detectLive(item) {
    if (!item) return false;
    return Boolean(item.is_live) || item.live_status === "is_live" || item.live_status === "is_upcoming";
  }

  /**
   * 라이브의 종류를 가린다. `_detectLive`는 "라이브 계열인가"만 보지만,
   * 재생은 방송 중(is_live)과 시작 전(is_upcoming)을 다르게 다뤄야 한다. 틀 것이 없는 쪽은 거절한다.
   * @returns {"is_live"|"is_upcoming"|null}
   */
  static liveStatusOf(item) {
    if (!item) return null;
    if (item.live_status === "is_live" || item.live_status === "is_upcoming") return item.live_status;
    // 구버전 응답이나 flat 검색 항목에는 live_status 없이 is_live만 올 수 있다.
    if (item.live_status === undefined && item.is_live) return "is_live";
    return null;
  }

  /**
   * 표시용 제목. 라이브는 yt-dlp가 `title` 뒤에 조회 시각을 붙여 준다(예: `제목 2026-01-02 03:04`).
   * 조회할 때마다 달라지는 값이라 캐시·매칭에도 나쁘다. `fulltitle`이 그게 빠진 원제이고,
   * 라이브가 아니면 둘이 같다.
   */
  static titleOf(item) {
    if (!item) return null;
    const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
    const full = text(item.fulltitle);
    const title = text(item.title);
    if (YouTube.liveStatusOf(item) && full) return full;
    return title || full;
  }

  static _isVideoEntry(item) {
    if (!item) return false;
    if (item.ie_key && item.ie_key !== "Youtube") return false; // YoutubeTab(채널/재생목록) 등
    const u = item.webpage_url || item.url || "";
    if (/youtube\.com\/(channel\/|@|playlist|user\/|results)/i.test(u)) return false;
    if (item.id && /^[A-Za-z0-9_-]{11}$/.test(item.id)) return true; // 비디오 id
    if (/[?&]v=[A-Za-z0-9_-]{11}/.test(u)) return true; // watch?v= URL
    return false;
  }

  /**
   * yt-dlp 호출을 연령 제한 폴백과 함께 실행.
   *  - 해당 videoId가 이미 연령 제한으로 알려져 있으면 처음부터 쿠키 사용(실패 시도 생략 → 영상당 실패 1회 보장).
   *  - 평상시(bgutil) 시도가 연령 제한으로 실패하면 videoId를 기록하고 쿠키로 1회 재시도.
   * @param {string} url
   * @param {(forceCookies:boolean)=>object} buildOptions  forceCookies를 받아 yt-dlp 옵션을 만드는 함수
   */
  static async runYtDlp(url, buildOptions) {
    const videoId = this.extractVideoId(url);
    let known = false;
    try {
      known = videoId ? CacheManager.isAgeRestricted(videoId) : false;
    } catch {
      /* 캐시 미초기화 등. 기본값 false */
    }

    try {
      return await this._runWithClients(url, buildOptions, known);
    } catch (error) {
      if (!known && videoId && this.isAgeRestrictedError(error) && this.cookiesConfigured()) {
        try {
          CacheManager.markAgeRestricted(videoId);
        } catch {
          /* 기록 실패는 무시 */
        }
        log.warn({ tags: ["retry", "fallback"] }, `연령 제한 감지 (${videoId}). 쿠키로 재시도합니다`);
        return await this._runWithClients(url, buildOptions, true);
      }

      // 서명된 미디어 주소가 어긋난 경우. 한 번 더 받아 새 주소를 얻는다.
      // 클라이언트 목록을 안 쓰는 설치에서는 이 재시도가 유일한 회복 수단이다.
      if (this.isStaleMediaError(error)) {
        log.warn({ tags: ["retry"] }, `미디어 주소가 어긋났습니다 (${videoId || url}). 다시 받습니다`);
        await new Promise((done) => setTimeout(done, STALE_RETRY_MS));
        return await this._runWithClients(url, buildOptions, known);
      }

      throw error;
    }
  }

  /**
   * player_client를 순서대로 시도한다. 지정이 없으면 호출 한 번으로 끝. 기존과 동일하다.
   *
   * 클라이언트 탓으로 보이는 실패에서만 다음으로 넘어가고 빈도를 기록한다. 영상이 없어졌거나
   * 연령 제한이거나 네트워크가 끊긴 것은 클라이언트 잘못이 아니므로 그대로 위로 던진다.
   * 그걸 섞어 세면 멀쩡한 클라이언트가 제외된다.
   */
  static async _runWithClients(url, buildOptions, forceCookies) {
    const clients = playerClients.idle ? [] : playerClients.list();

    if (clients.length === 0) {
      if (!playerClients.idle) playerClients.noteExhausted(); // 지정은 했는데 전부 제외됨
      return this._runOnce(url, buildOptions(forceCookies), null);
    }

    let lastError = null;
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      try {
        const result = await this._runOnce(url, buildOptions(forceCookies), client);
        playerClients.record(client, true);
        return result;
      } catch (error) {
        if (!this.isClientFault(error)) throw error; // 영상·네트워크 문제. 클라이언트 바꿔봐야 소용없다
        lastError = error;
        playerClients.record(client, false);
        const next = clients[i + 1];
        log.warn({ tags: ["fallback"] }, `${client} 실패 (${this._faultReason(error)})${next ? `. ${next} 로 전환합니다` : ""}`);
      }
    }

    // 지정한 것이 다 안 됐다. yt-dlp 기본값에 한 번 맡겨 본다. 유지보수되는 쪽이 더 나을 수 있다.
    log.warn({ tags: ["fallback"] }, `지정한 클라이언트를 모두 시도했습니다. yt-dlp 기본값으로 마지막 시도를 합니다`);
    try {
      return await this._runOnce(url, buildOptions(forceCookies), null);
    } catch {
      throw lastError; // 원인 파악에는 클라이언트별 실패가 더 유용하다
    }
  }

  /**
   * 한 번 호출 + 경고 훑기.
   * 호출부가 extractorArgs를 직접 넘겼으면 그쪽이 이긴다. 명시적 지정을 폴백이 덮지 않는다.
   * 클라이언트를 하나씩만 넘기는 이유는 _runWithClients 머리말 참조.
   */
  static async _runOnce(url, options, client) {
    const opts = client && !options.extractorArgs ? { ...options, extractorArgs: `youtube:player_client=${client}` } : options;
    // 쿠키 파일이 실제로 넘어간 호출만 센다. 무쿠키 캐싱까지 세면 경고가 거짓이 된다
    const holdsCookieFile = !!opts.cookies;
    if (holdsCookieFile) cookieRuns++;
    try {
      const result = await youtubedl(url, opts);
      this._inspectWarnings(result?._stderr, client);
      return result;
    } finally {
      if (holdsCookieFile) cookieRuns--;
    }
  }

  /**
   * 성공했어도 경고는 볼 값어치가 있다. 특히 "POToken이 필요하다"는, 안 쓰던 클라이언트가
   * 쓰기 시작했다는 신호다. 유튜브가 조이는 것을 우리가 제일 먼저 아는 지점이다.
   */
  static _inspectWarnings(stderr, client) {
    if (!stderr) return;
    for (const line of String(stderr).split("\n")) {
      if (!/^WARNING/i.test(line)) continue;
      // yt-dlp가 모르는 이름은 실패가 아니라 기본 클라이언트로 조용히 떨어져 성공한다.
      // 그러면 우리 폴백 루프가 첫 항목에서 끝나 뒤 목록이 통째로 사문화된다. 이건 알려야 한다.
      const skipped = line.match(/Skipping unsupported client "?([\w-]+)"?/i);
      if (skipped) {
        log.warn(`${skipped[1]} 은(는) 이 yt-dlp가 모르는 클라이언트입니다. 건너뛰고 yt-dlp 기본값으로 재생했습니다. .env에서 고쳐 주세요`);
        continue;
      }
      if (/require[sd]? a .*PO Token|PO Token which was not provided/i.test(line)) {
        // 요구한 클라이언트 이름은 경고 본문에 적혀 온다("web_creator client https formats require...").
        // 우리가 지정한 값을 쓰면 안 된다. 연령 제한 영상에서는 우리가 고르지 않은 web_creator 가
        // yt-dlp 판단으로 끼어들기 때문에, 지정값으로 찍으면 엉뚱한 이름이 남는다.
        const named = line.match(/\b([a-z][\w-]*) client\b/i);
        const asked = named ? named[1] : client;
        const who = asked || "기본 클라이언트";
        if (NEEDS_POT.includes(asked)) log.debug(`${who}: POToken을 요구했습니다 (알려진 특성)`);
        else log.warn({ tags: ["youtube-change"] }, `${who}가 POToken을 요구했습니다. 유튜브 정책이 바뀐 것으로 보입니다`);
        continue;
      }
      log.debug(`yt-dlp 경고${client ? ` (${client})` : ""}: ${line.replace(/^WARNING:\s*/i, "").trim()}`);
    }
  }

  /**
   * yt-dlp 가 그 클라이언트를 아예 실행하지 않았는가.
   *
   * 쿠키를 붙이면 쓸 수 있는 클라이언트 집합이 바뀐다. 쿠키를 못 받는 것들(visionos·android·
   * tv_simply 등)은 건너뛰어지고, 남은 것이 없으면 "Requested format is not available" 로 끝난다.
   * 그 메시지만 보면 클라이언트가 실패한 것처럼 보이지만 돌아 본 적조차 없다.
   *
   * 어느 클라이언트가 쿠키를 지원하는지는 우리가 표로 들고 있지 않는다. yt-dlp 가 건너뛰면서
   * 이유를 적어 주므로 그것을 읽는다. 표를 박아 두면 유튜브나 yt-dlp 가 바뀔 때 먼저 어긋난다.
   */
  static isSkippedClientError(error) {
    const msg = (error && (error.stderr || error.message)) || String(error || "");
    return /Skipping client "[\w-]+"/i.test(msg);
  }

  /** 이 실패가 클라이언트 탓으로 보이는가 (영상·네트워크 문제와 구별) */
  static isClientFault(error) {
    const msg = (error && (error.stderr || error.message)) || String(error || "");
    if (this.isVideoUnavailableError(error) || this.isAgeRestrictedError(error)) return false;
    // 실행조차 안 된 것을 실패로 세면 멀쩡한 클라이언트가 제외된다. 연령 제한 영상 몇 편이면
    // 주력 경로가 세션 내내 빠지고, 그때부터 평상시 재생까지 기본값으로 떨어진다.
    if (this.isSkippedClientError(error)) return false;
    return /requested format is not available|only images are available|no video formats found|PO Token|nsig extraction failed/i.test(msg) || this.isStaleMediaError(error);
  }

  /**
   * 포맷 주소를 받아 놓고 내려받다가 막힌 것인가.
   *
   * 유튜브가 발급한 미디어 주소를 그 CDN이 거절하는 일이 간헐적으로 있다. yt-dlp 자신이 같은
   * 주소로 세 번 재시도해도(retries:3) 계속 403인데, 주소를 새로 받으면 풀린다. 주소 자체가
   * 처음부터 거절당한 것이지 통신이 끊긴 게 아니다.
   *
   * 저쪽 사정이고 우리 쪽에 고칠 것이 없다(yt-dlp #17395. 간헐적이고, OS·VPN·쿠키와 무관하며,
   * 실패한 요청에 siu=1 이 붙는다는 관찰이 있다. 2026.08.19 기준 고쳐진 바 없다).
   * 그래서 여기서는 다시 받는 것만 한다.
   */
  static isStaleMediaError(error) {
    const msg = (error && (error.stderr || error.message)) || String(error || "");
    if (this.isVideoUnavailableError(error) || this.isAgeRestrictedError(error)) return false;
    // "unable to download video data" 만으로는 안 된다. 네트워크 타임아웃도 같은 문구로 온다.
    // 유튜브가 거절한 것(403/429)과 조각이 어긋난 것만 본다.
    return /HTTP Error (?:403|429)|unable to download fragment|fragment .{0,20}not found/i.test(msg);
  }

  static _faultReason(error) {
    const msg = (error && (error.stderr || error.message)) || String(error || "");
    if (/PO Token/i.test(msg)) return "POToken 필요";
    if (/only images are available/i.test(msg)) return "재생 가능한 포맷 없음";
    if (/requested format is not available/i.test(msg)) return "요청한 포맷 없음";
    return "포맷 획득 실패";
  }

  static async search(query, limit = 1) {
    try {
      // 이미 YouTube URL인 경우 직접 정보를 가져옴
      if (this.isYouTubeURL(query)) {
        const info = await this.getInfo(query);
        return info ? [info] : [];
      }

      // 유튜브 검색에 yt-dlp 사용
      const searchQuery = `ytsearch${limit}:${query}`;

      const results = await youtubedl(
        searchQuery,
        this.getYtDlpOptions({
          dumpSingleJson: true,
          flatPlaylist: true,
        }),
      );

      if (!results || !results.entries) {
        return [];
      }

      const tracks = [];
      // 비디오가 아닌 검색 결과(채널·재생목록·핸들)를 제외. ytsearch가 이들을 섞어 반환하는데,
      // 재생 불가능한 채널 URL이 후보로 들어가면 매칭이 오염된다(예: 제목이 기호뿐인 곡에서 채널이 순위로 우승).
      const videoEntries = results.entries.filter((e) => YouTube._isVideoEntry(e)).slice(0, limit);
      for (const item of videoEntries) {
        try {
          // 디버그: 항목 구조 기록

          const unknownTitle = "알 수 없는 제목";
          const unknownArtist = "알 수 없는 아티스트";

          const track = {
            title: YouTube.titleOf(item) || unknownTitle,
            artist: item.uploader || item.channel || unknownArtist,
            url: item.webpage_url || item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : null),
            duration: item.duration || 0,
            thumbnail: item.thumbnail || item.thumbnails?.[0]?.url,
            platform: "youtube",
            type: "track",
            id: item.id,
            views: item.view_count,
            uploadDate: item.upload_date,
            description: item.description,
            isLive: YouTube._detectLive(item),
            liveStatus: YouTube.liveStatusOf(item),
          };

          // 검색 결과에 길이가 없으면 getInfo에서 가져오기 시도
          // (라이브는 여기서 duration이 늘 0이라 이 분기를 타고, 상세 정보로 isLive가 확정된다.)
          if (!track.duration || track.duration === 0) {
            const detailedInfo = await this.getInfo(track.url);
            if (detailedInfo && detailedInfo.duration) {
              track.duration = detailedInfo.duration;
            }
            if (detailedInfo && detailedInfo.isLive) {
              track.isLive = true;
              track.liveStatus = detailedInfo.liveStatus;
            }
          }

          tracks.push(track);
        } catch (error) {
          continue;
        }
      }

      return tracks;
    } catch (error) {
      log.error("유튜브 검색 실패:", error.message || error);
      return [];
    }
  }

  static async getInfo(url) {
    try {
      const info = await this.runYtDlp(url, (forceCookies) =>
        this.getYtDlpOptions(
          {
            dumpSingleJson: true,
            preferFreeFormats: true,
          },
          { forceCookies },
        ),
      );

      if (!info) {
        throw new Error("youtube-dl에서 정보를 반환하지 않음");
      }

      const unknownTitle = "알 수 없는 제목";
      const unknownArtist = "알 수 없는 아티스트";

      const track = {
        title: YouTube.titleOf(info) || unknownTitle,
        artist: info.uploader || info.channel || unknownArtist,
        url: info.webpage_url || url,
        duration: info.duration || 0,
        thumbnail: info.thumbnail || info.thumbnails?.[0]?.url,
        platform: "youtube",
        type: "track",
        id: info.id,
        views: info.view_count,
        uploadDate: info.upload_date,
        description: info.description,
        formats: info.formats,
        isLive: YouTube._detectLive(info),
        liveStatus: YouTube.liveStatusOf(info),
      };

      return track;
    } catch (error) {
      log.error("영상 정보 조회 실패:", this.briefError(error));
      return null;
    }
  }

  static async getStream(url, startSeconds = 0) {
    try {
      if (!url) {
        throw new Error("URL이 필요함");
      }

      // 단순 형식으로 스트림 URL 가져오기
      const info = await this.runYtDlp(url, (forceCookies) =>
        this.getYtDlpOptions(
          {
            dumpSingleJson: true,
            format: "bestaudio/best",
          },
          { forceCookies },
        ),
      );

      if (!info || !info.url) {
        throw new Error("스트림 URL을 찾을 수 없음");
      }

      const baseUrl = info.url;
      // HLS 재생목록 주소에는 `begin=`을 붙일 수 없다. 위치는 ffmpeg의 `-ss`가 정한다.
      const isHls = typeof info.protocol === "string" && info.protocol.startsWith("m3u8");
      const canSeek = !isHls && /googlevideo\.com/i.test(baseUrl);
      let finalUrl = baseUrl;

      const seekSeconds = Math.max(0, Number(startSeconds) || 0);
      if (seekSeconds > 0 && canSeek) {
        const startMs = Math.floor(seekSeconds * 1000);
        const separator = baseUrl.includes("?") ? "&" : "?";
        finalUrl = `${baseUrl}${separator}begin=${startMs}`;
      }

      return {
        url: finalUrl,
        rawUrl: baseUrl,
        // 영상 자체의 제목. 재생목록 페이지가 주는 제목과 다를 수 있고, 이쪽이 정본이다
        // (watch 페이지의 videoDetails.title이라 요청 언어와 무관하게 원제가 온다).
        title: YouTube.titleOf(info),
        type: info.acodec && info.acodec.includes("opus") ? "opus" : "arbitrary",
        duration: info.duration || 0,
        bitrate: info.abr || info.tbr || 0,
        canSeek,
        format: info.format,
        httpHeaders: info.http_headers || {},
        isLive: YouTube._detectLive(info),
        liveStatus: YouTube.liveStatusOf(info),
        // yt-dlp가 알려주는 전송 방식. m3u8 계열은 "받아 둔 바이트"가 아니라 "받아 올 주소"를
        // 줘야 하는 형식이라 파이프로 먹일 수 없다. 재생 쪽이 이 값으로 갈래를 고른다.
        protocol: info.protocol || null,
      };
    } catch (error) {
      log.error("스트림 URL 획득 실패:", this.briefError(error));
      throw error;
    }
  }

  // offset부터 limit개만 받는다. 유튜브는 시작점까지 이어 받기를 걸어가야 해서 비용이 끝 위치에 비례한다.
  // 총 곡 수(playlist_count)는 구간만 받아도 오지만, 믹스(RD…)는 끝이 없어 null이다.
  static async getPlaylist(url, { offset = 0, limit = config.bot.playlistAddDefault } = {}) {
    try {
      const info = await youtubedl(
        url,
        this.getYtDlpOptions({
          dumpSingleJson: true,
          flatPlaylist: true,
          playlistItems: `${offset + 1}:${offset + limit}`,
        }),
      );

      if (!info) {
        throw new Error("재생목록 정보를 가져올 수 없음");
      }

      if (!info.entries || info.entries.length === 0) {
        throw new Error("재생목록 항목을 찾을 수 없음");
      }

      const unknownTitle = "알 수 없는 제목";
      const unknownArtist = "알 수 없는 아티스트";

      const tracks = [];
      for (const entry of info.entries) {
        if (entry && (entry.id || entry.url)) {
          try {
            const track = {
              title: YouTube.titleOf(entry) || unknownTitle,
              artist: entry.uploader || entry.channel || entry.uploader_id || unknownArtist,
              url: entry.webpage_url || entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null),
              duration: entry.duration || 0,
              thumbnail: entry.thumbnail || entry.thumbnails?.[0]?.url,
              platform: "youtube",
              type: "track",
              id: entry.id,
              isLive: YouTube._detectLive(entry),
              liveStatus: YouTube.liveStatusOf(entry),
            };

            // 이 영상의 제목을 전에 영상 자체에서 확인해 뒀다면 그걸 쓴다(로컬 DB 조회, 왕복 없음).
            // 재생목록 페이지의 제목은 낡을 수 있어서, 이게 없으면 곡이 재생되기 전까지 대기열에
            // 낡은 제목이 그대로 보인다.
            if (track.url) {
              try {
                const known = CacheManager.getVerifiedTitle(track.url);
                if (known) track.title = known;
              } catch {
                /* DB 미초기화 등. 재생목록 제목 그대로 간다 */
              }
              tracks.push(track);
            }
          } catch (entryError) {
            continue;
          }
        }
      }

      if (tracks.length === 0) {
        throw new Error("재생목록에서 유효한 트랙을 찾을 수 없음");
      }

      const unknownPlaylist = "알 수 없는 재생목록";

      return {
        title: info.title || unknownPlaylist,
        tracks: tracks,
        total: info.playlist_count ?? null,
        nextOffset: offset + info.entries.length,
        url: url,
        platform: "youtube",
        type: "playlist",
      };
    } catch (error) {
      log.error("재생목록 조회 실패:", error.message || error);
      return null;
    }
  }

  static _parseYouTubeURL(value) {
    if (typeof value !== "string") return null;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
      if (!["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(hostname)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /** 유튜브 호스트이기만 하면 참. 재생 가능한 형태인지는 보지 않는다(isYouTubeURL이 본다). */
  static isYouTubeHost(value) {
    return this._parseYouTubeURL(value) !== null;
  }

  // /live/ID는 라이브였던 영상의 링크일 뿐 다른 형태와 같은 영상 ID를 쓴다.
  // 지금 라이브인지는 URL이 아니라 메타데이터(is_live)가 정한다. 방송이 끝나면 같은 링크가 VOD가 된다.
  static isYouTubeURL(value) {
    const parsed = this._parseYouTubeURL(value);
    if (!parsed) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname === "youtu.be") return /^\/[a-zA-Z0-9_-]+/.test(parsed.pathname);
    if (parsed.pathname === "/watch") return /^[a-zA-Z0-9_-]+$/.test(parsed.searchParams.get("v") || "");
    if (parsed.pathname === "/playlist") return /^[a-zA-Z0-9_-]+$/.test(parsed.searchParams.get("list") || "");
    return /^\/(embed|v|shorts|live)\/[a-zA-Z0-9_-]+/.test(parsed.pathname);
  }

  static isPlaylist(value) {
    const parsed = this._parseYouTubeURL(value);
    if (!parsed || !/^[a-zA-Z0-9_-]+$/.test(parsed.searchParams.get("list") || "")) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return hostname === "youtu.be" || parsed.pathname === "/playlist" || parsed.pathname === "/watch";
  }

  static parseDuration(durationString) {
    if (!durationString) return 0;

    // "3:45", "1:23:45" 같은 형식 처리
    const parts = durationString.split(":").reverse();
    let seconds = 0;

    for (let i = 0; i < parts.length; i++) {
      seconds += parseInt(parts[i]) * Math.pow(60, i);
    }

    return seconds;
  }

  static extractVideoId(value) {
    const parsed = this._parseYouTubeURL(value);
    if (!parsed) return null;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    let videoId;
    if (hostname === "youtu.be") {
      videoId = parsed.pathname.split("/").filter(Boolean)[0] || null;
    } else if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v");
    } else {
      const match = parsed.pathname.match(/^\/(?:embed|v|shorts|live)\/([a-zA-Z0-9_-]+)/);
      videoId = match?.[1] || null;
    }
    return /^[a-zA-Z0-9_-]+$/.test(videoId || "") ? videoId : null;
  }

  static extractPlaylistId(url) {
    const match = url.match(/[&?]list=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  static createThumbnailUrl(videoId, quality = "maxresdefault") {
    return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
  }

  static createVideoUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  static async validateUrl(url) {
    try {
      if (!this.isYouTubeURL(url)) {
        return false;
      }

      // 검증을 위해 기본 정보 가져오기 시도
      const info = await youtubedl(
        url,
        this.getYtDlpOptions({
          dumpSingleJson: true,
          skipDownload: true,
        }),
      );

      return !!info && !!info.title;
    } catch (error) {
      return false;
    }
  }
}

YouTube._internals = { BGUTIL_DIR, BGUTIL_PLUGIN_ROOT, BGUTIL_AVAILABLE, findPluginRoot, playerClients };

module.exports = YouTube;
