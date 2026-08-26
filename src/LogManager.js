"use strict";

// LogSink — 로그 레코드의 "진짜 매니저".
// 입력 레코드(pino JSON 부분집합): { level:number, time:number, msg:string, ...bindings }
//   - bindings 예: category, err(stack 문자열) 등
//   - 브리지 레거시 레코드는 wireLevel(원본 console 메서드명)을 실어 대시보드 칩 하위호환 유지
// 책임: 레드액션 → 터미널 렌더(단독) → 링버퍼 → SSE → destinations(미래 file/ipc)
// 생산자는 두 갈래: (1) src/logger.js facade  (2) 아래 console 브리지(레거시 console.* 흡수)

const util = require("util");
const chalk = require("chalk");

// 터미널 출력은 항상 "가로채기 이전의 진짜 console"으로 — 몽키패치 순서와 무관하게 재귀 차단.
const REAL = { log: console.log.bind(console), error: console.error.bind(console) };

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

// pino와 동일한 레벨 체계
const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const LEVEL_NAMES = { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal" };
// SSE 와이어 하위호환: 대시보드가 아는 옛 칩 이름(log/info/warn/error)으로 역매핑
const WIRE_LEVEL = { 10: "log", 20: "log", 30: "info", 40: "warn", 50: "error", 60: "error" };
// 브리지: 레거시 console 메서드 → pino 레벨(숫자)
const CONSOLE_LEVEL = { log: 30, info: 30, warn: 40, error: 50 };

const LEVEL_COLOR = {
  trace: chalk.gray,
  debug: chalk.gray,
  info: chalk.cyan,
  warn: chalk.yellow,
  error: chalk.red,
  fatal: chalk.bgRed.white,
};

// 레드액션(민감정보 마스킹) — 레코드가 버퍼/터미널/SSE로 나가기 직전 단일 지점.
// Phase 0은 "최소 규칙"만. 본격 경로기반 redact는 pino 도입(Phase 3)에서 승계.
const REDACT_KEYS = new Set([
  "authorization", "cookie", "password", "secret", "client_secret", "clientsecret",
  "access_token", "accesstoken", "refresh_token", "refreshtoken",
  "token", "totp", "totpserver", "apikey", "api_key",
]);
const MSG_PATTERNS = [
  { re: /(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, repl: "$1[REDACTED]" },
  { re: /((?:access_?token|client_?secret|refresh_?token|api_?key)["'`\s:=]{1,4}["'`]?)[A-Za-z0-9._~+/=-]{6,}/gi, repl: "$1[REDACTED]" },
];

class LogManager {
  constructor({ maxLines = 500, intercept = true } = {}) {
    this.maxLines = maxLines;
    this.buffer = [];
    this.clients = new Set();
    this.destinations = []; // 미래: file 스트림, 샤드 ipc-forward 등 (레코드를 받는 함수)

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
          wireLevel: method, // 대시보드 칩 하위호환
          category: "external",
        });
      };
    }
  }

  // facade와 브리지가 공통으로 부르는 입구.
  record(rec) {
    const safe = this._redact(rec);
    this._renderTerminal(safe);

    const entry = this._toWire(safe);
    this.buffer.push(entry);
    if (this.buffer.length > this.maxLines) this.buffer.shift();

    const payload = `data: ${JSON.stringify(entry)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }

    for (const dest of this.destinations) {
      try {
        dest(safe); // destinations는 리치 레코드를 받음(구조화 소비 대비)
      } catch {
        /* destination 오류가 로깅을 막지 않도록 삼킴 */
      }
    }
  }

  _redact(rec) {
    const out = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k === "msg" || k === "level" || k === "time" || k === "wireLevel") {
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

  _renderTerminal(rec) {
    const name = LEVEL_NAMES[rec.level] || "info";
    const label = name.toUpperCase().padEnd(5);
    const tag = this.useColor && LEVEL_COLOR[name] ? LEVEL_COLOR[name](label) : label;
    // 카테고리 배지: sub 바인딩(하위 카테고리, pino child) 있으면 [category/sub]
    const catLabel = rec.category ? (rec.sub ? `${rec.category}/${rec.sub}` : rec.category) : rec.sub || "";
    const cat = catLabel ? (this.useColor ? chalk.gray(` [${catLabel}]`) : ` [${catLabel}]`) : "";
    // 태그: 교차 성질(직교) 라벨 집합 → 배지 뒤 #tag
    const tagsRaw = Array.isArray(rec.tags) && rec.tags.length ? " " + rec.tags.map((t) => `#${t}`).join(" ") : "";
    const tags = tagsRaw ? (this.useColor ? chalk.gray(tagsRaw) : tagsRaw) : "";
    const msg = typeof rec.msg === "string" ? rec.msg : String(rec.msg ?? "");
    const line = `${tag}${cat}${tags} ${msg}`;
    (rec.level >= LEVELS.error ? REAL.error : REAL.log)(line);
  }

  _toWire(rec) {
    const entry = {
      ts: rec.time,
      level: rec.wireLevel || WIRE_LEVEL[rec.level] || "info",
      text: this._strip(rec.msg),
    };
    if (rec.category) entry.category = rec.category; // 있을 때만(레거시 브리지 로그엔 없음)
    if (rec.sub) entry.sub = rec.sub; // 하위 카테고리(pino child 바인딩)
    if (Array.isArray(rec.tags) && rec.tags.length) entry.tags = rec.tags; // 교차 태그
    return entry;
  }

  _strip(s) {
    return typeof s === "string" ? s.replace(ANSI_RE, "") : String(s ?? "");
  }

  addClient(res) {
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

    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }
}

const singleton = new LogManager();
singleton.LogManager = LogManager; // 테스트용 클래스(격리 인스턴스 생성)
singleton._internals = { LEVELS, LEVEL_NAMES, WIRE_LEVEL, CONSOLE_LEVEL, REDACT_KEYS, MSG_PATTERNS };
module.exports = singleton;
