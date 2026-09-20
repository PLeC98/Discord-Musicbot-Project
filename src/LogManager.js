"use strict";

// LogSink — 로그 레코드의 "진짜 매니저".
// 입력 레코드(pino JSON 부분집합): { level:number, time:number, msg:string, ...bindings }
//   - bindings 예: category, err(stack 문자열) 등
// 책임: 레드액션 → 터미널 렌더(단독) → 링버퍼 → SSE → destinations(미래 file/ipc)
// 생산자는 두 갈래: (1) src/logger.js facade  (2) 아래 console 브리지(서드파티 console.* 흡수)

const util = require("util");
const chalk = require("chalk");

// 터미널 출력은 항상 "가로채기 이전의 진짜 console"으로 — 몽키패치 순서와 무관하게 재귀 차단.
const REAL = { log: console.log.bind(console), error: console.error.bind(console) };

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
// 위 정규식은 /g라 test()가 lastIndex를 들고 다닌다(호출마다 결과가 달라진다) — 검사용은 따로.
const HAS_ANSI = /\x1B\[/;

// pino와 동일한 레벨 체계
const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const LEVEL_NAMES = { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal" };
// SSE 와이어 레벨 = 실제 레벨 이름. 예전엔 대시보드가 아는 네 가지(log/info/warn/error)로
// 접어서 보냈는데, 그러면 debug와 trace가, fatal과 error가 합쳐져 대시보드가 영영 못 가른다.
// 레벨을 실제로 쓰기 시작한 이상 접으면 안 된다.
const WIRE_LEVEL = { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal" };
// 브리지: console 메서드 → pino 레벨(숫자). log는 debug로 내린다 — 여기 걸리는 건 전부 서드파티라
// info 칸을 채우면 우리 로그가 묻힌다. 대시보드도 DEBUG 알약에서 본다.
const CONSOLE_LEVEL = { log: 20, info: 30, warn: 40, error: 50 };

// 레벨 라벨 색.
const LEVEL_COLOR = {
  trace: chalk.gray,
  debug: chalk.gray,
  info: chalk.cyan,
  warn: chalk.yellow,
  error: chalk.red,
  fatal: chalk.bgRed.white,
};

// 본문 색도 sink가 칠한다. 예전엔 호출부가 chalk로 감쌌을 때만 색이 붙어서, 같은 error인데
// 79%가 흰 글씨였다(실측 86건 중 68건). 색이 위험도가 아니라 "그 줄을 쓴 사람이 chalk를 썼는지"를
// 나타내던 셈이다. sink는 레벨을 알고 있으니 여기서 일관되게 칠한다.
const TEXT_COLOR = {
  trace: chalk.gray,
  debug: chalk.gray,
  info: (s) => s,
  warn: chalk.yellow,
  error: chalk.red,
  fatal: chalk.red.bold,
};

// 카테고리 배지 색 — 이름 해시로 고른다(대시보드 뷰어의 catColor와 같은 방식).
// 전부 회색이면 [player]와 [voice]가 눈에 안 들어온다. 스무 종을 색으로 가르는 편이
// 이모지로 가르는 것보다 확실하고, cmd에서 깨지지도 않는다.
const CAT_COLORS = [chalk.magenta, chalk.blue, chalk.green, chalk.yellow, chalk.cyan, chalk.redBright, chalk.blueBright, chalk.greenBright];
function catColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CAT_COLORS[h % CAT_COLORS.length];
}

// 레드액션(민감정보 마스킹) — 레코드가 버퍼/터미널/SSE로 나가기 직전 단일 지점.
// Phase 0은 "최소 규칙"만. 본격 경로기반 redact는 pino 도입(Phase 3)에서 승계.
const REDACT_KEYS = new Set(["authorization", "cookie", "password", "secret", "client_secret", "clientsecret", "access_token", "accesstoken", "refresh_token", "refreshtoken", "token", "totp", "totpserver", "apikey", "api_key"]);
const MSG_PATTERNS = [
  { re: /(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, repl: "$1[REDACTED]" },
  { re: /((?:access_?token|client_?secret|refresh_?token|api_?key)["'`\s:=]{1,4}["'`]?)[A-Za-z0-9._~+/=-]{6,}/gi, repl: "$1[REDACTED]" },
];

class LogManager {
  constructor({ maxLines = 500, intercept = true } = {}) {
    this.maxLines = maxLines;
    // 터미널에만 적용하는 하한. 파일·대시보드는 레코드가 오는 대로 다 받는다 —
    // 조사 중 debug를 켜도 터미널은 조용하게 둘 수 있어야 한다.
    this.consoleLevel = 0;
    this.buffer = [];
    this.clients = new Set();
    this._cleanups = new WeakMap(); // res -> 한 번만 도는 정리 함수 (close·error·쓰기 실패 공용)
    this.destinations = []; // file(logFile.js), 미래의 샤드 ipc-forward 등 (레코드를 받는 함수)
    // destination이 붙기 전에 지나간 레코드. 파일 로그는 config를 읽은 뒤에야 열 수 있는데,
    // config 검증 경고("SPOTIFY 미설정" 등)와 기동 오류가 바로 그 이전에 나온다 — 그게 파일에서
    // 빠지면 정작 필요한 부분이 없다. 첫 destination이 붙을 때 흘려보내고 수집을 멈춘다.
    this.earlyRecords = [];

    // 터미널 사정(코드페이지·색·TTY)의 단일 홈.
    this.isTTY = !!process.stdout.isTTY;
    this.useColor = this.isTTY;
    // TODO(Phase3): Windows cmd 기본 코드페이지(레거시 949/437)에서 UTF-8 깨짐 →
    //   cmd 판별 후 `chcp 65001` 적용 + pino-pretty를 여기 렌더러 자리에 연결.

    if (intercept) this._intercept();
  }

  // console.* catch-net: 우리 코드는 전부 logger.*를 쓰므로, 여기 걸리는 건 곧
  // logger를 우회한 서드파티/의존성/누락 console.* → category:"external"로 태깅해 흡수.
  // (터미널 포맷 일관성 + 대시보드 완결성. pino 시대엔 console.*→pino로 그대로 생존.)
  _intercept() {
    for (const method of ["log", "info", "warn", "error"]) {
      console[method] = (...args) => {
        this.record({
          level: CONSOLE_LEVEL[method],
          time: Date.now(),
          msg: util.format(...args), // console 시맨틱(%s, 객체 inspect, Error stack) 보존
          category: "external",
        });
      };
    }
  }

  // facade와 브리지가 공통으로 부르는 입구.
  record(rec) {
    const safe = this._redact(rec);
    if (safe.level >= this.consoleLevel) this._renderTerminal(safe);

    const entry = this._toWire(safe);
    this.buffer.push(entry);
    if (this.buffer.length > this.maxLines) this.buffer.shift();

    const payload = `data: ${JSON.stringify(entry)}\n\n`;
    for (const res of this.clients) {
      try {
        // write가 false면 커널 버퍼가 찼다는 뜻 — 읽지 않는 소비자를 붙들고 있으면 메모리가 는다.
        // 로그는 지나간 것을 되돌려 줄 성질이 아니므로 기다리지 않고 끊는다(다시 열면 버퍼부터 받는다).
        if (res.write(payload) === false) {
          res.end();
          this._dropClient(res);
        }
      } catch {
        this._dropClient(res);
      }
    }

    if (this.destinations.length === 0) {
      if (this.earlyRecords.length < this.maxLines) this.earlyRecords.push(safe);
    } else {
      for (const dest of this.destinations) {
        try {
          dest(safe); // destinations는 리치 레코드를 받음(구조화 소비 대비 — ANSI도 그대로)
        } catch {
          /* destination 오류가 로깅을 막지 않도록 삼킴 */
        }
      }
    }
  }

  // destination 등록. 첫 등록에 한해 그 이전 레코드를 재생한다(위 earlyRecords 설명).
  addDestination(dest) {
    const first = this.destinations.length === 0;
    this.destinations.push(dest);
    if (!first) return;
    const replay = this.earlyRecords;
    this.earlyRecords = [];
    for (const rec of replay) {
      try {
        dest(rec);
      } catch {
        /* 재생 실패가 기동을 막지 않도록 삼킴 */
      }
    }
  }

  _redact(rec) {
    const out = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k === "msg" || k === "level" || k === "time") {
        out[k] = v;
        continue;
      }
      out[k] = REDACT_KEYS.has(String(k).toLowerCase()) ? "[REDACTED]" : v;
    }
    if (typeof out.msg === "string") {
      for (const { re, repl } of MSG_PATTERNS) out.msg = out.msg.replace(re, repl);
    }
    return out;
  }

  /** 터미널 출력 하한 설정. 이름(info 등)이나 빈 값(=제한 없음). */
  setConsoleLevel(name) {
    this.consoleLevel = LEVELS[name] ?? 0;
  }

  _renderTerminal(rec) {
    const name = LEVEL_NAMES[rec.level] || "info";
    const paint = (fn, text) => (this.useColor && fn ? fn(text) : text);

    const tag = paint(LEVEL_COLOR[name], name.toUpperCase().padEnd(5));
    // 카테고리 배지: sub 바인딩(하위 카테고리, pino child) 있으면 [category/sub]
    const catLabel = rec.category ? (rec.sub ? `${rec.category}/${rec.sub}` : rec.category) : rec.sub || "";
    const cat = catLabel ? paint(catColor(rec.category || rec.sub || ""), ` [${catLabel}]`) : "";
    // 태그: 교차 성질(직교) 라벨 집합 → 배지 뒤 #tag
    const tagsRaw = Array.isArray(rec.tags) && rec.tags.length ? " " + rec.tags.map((t) => `#${t}`).join(" ") : "";
    const tags = tagsRaw ? paint(chalk.gray, tagsRaw) : "";

    const raw = typeof rec.msg === "string" ? rec.msg : String(rec.msg ?? "");
    // 호출부가 이미 색을 넣었으면 덧칠하지 않는다(ANSI가 겹치면 리셋 위치가 어긋난다).
    const msg = HAS_ANSI.test(raw) ? raw : paint(TEXT_COLOR[name], raw);

    (rec.level >= LEVELS.error ? REAL.error : REAL.log)(`${tag}${cat}${tags} ${msg}`);
  }

  _toWire(rec) {
    const entry = {
      ts: rec.time,
      level: WIRE_LEVEL[rec.level] || "info",
      text: this._strip(rec.msg),
    };
    if (rec.category) entry.category = rec.category; // 있을 때만
    if (rec.sub) entry.sub = rec.sub; // 하위 카테고리(pino child 바인딩)
    if (Array.isArray(rec.tags) && rec.tags.length) entry.tags = rec.tags; // 교차 태그
    return entry;
  }

  _strip(s) {
    return typeof s === "string" ? s.replace(ANSI_RE, "") : String(s ?? "");
  }

  /**
   * 관리자 로그 스트림 구독. 연결 상한·하트비트는 대시보드 SSE와 같은 설정을 쓴다
   * (`SSE_MAX_CONNECTIONS`·`SSE_HEARTBEAT_SEC`) — "SSE 연결을 몇 개까지 두느냐"는 한 가지 질문이다.
   *
   * 상한을 넘으면 429. 느린 소비자는 _record가 정리한다(아래 write 반환값 확인).
   */
  addClient(res) {
    const { maxPerUser, heartbeatMs } = require("../config").dashboard.sse;
    if (this.clients.size >= maxPerUser) {
      res.status(429).json({ error: "로그 연결이 너무 많습니다" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    for (const entry of this.buffer) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    // 유휴 연결이 프록시 타임아웃에 끊기지 않게 주석 프레임을 보낸다(대시보드 SSE와 같은 방식).
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        cleanup();
      }
    }, heartbeatMs);
    if (ping.unref) ping.unref();

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      clearInterval(ping);
      this.clients.delete(res);
    };

    this.clients.add(res);
    this._cleanups.set(res, cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  }

  /** 연결 정리 — 쓰기 실패 경로에서도 하트비트까지 함께 걷는다. */
  _dropClient(res) {
    const cleanup = this._cleanups.get(res);
    if (cleanup) cleanup();
    else this.clients.delete(res);
  }
}

const singleton = new LogManager();
singleton.LogManager = LogManager; // 테스트용 클래스(격리 인스턴스 생성)
singleton._internals = { LEVELS, LEVEL_NAMES, WIRE_LEVEL, CONSOLE_LEVEL, REDACT_KEYS, MSG_PATTERNS };
module.exports = singleton;
