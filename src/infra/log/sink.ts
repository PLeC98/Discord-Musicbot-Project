// 로그 싱크(LogManager). 모든 로그 레코드가 지나는 한 곳.
// 입력 레코드(pino JSON 부분집합): { level:number, time:number, msg:string, ...bindings }
//   - bindings 예: category, err(stack 문자열) 등
// 순서: 가리기(redact) → 터미널 출력 → 줄 버퍼 → SSE → destinations(파일)
// 들어오는 길은 둘: (1) logger.ts facade  (2) 아래 console 브리지(서드파티 console.* 를 받는다)

import util from "util";
import config from "../../config/index.ts";
import { styleText } from "node:util";
import { LEVELS, KEPT_LINES, levelNameOf, wireFields, type LevelName, type LogGap, type WireEntry } from "./levels.ts";

// 터미널 출력은 늘 가로채기 전의 console 로 한다. 가로챈 console 로 찍으면 다시 여기로 들어온다.
const REAL = { log: console.log.bind(console), error: console.error.bind(console) };

// 호출부가 이미 색을 넣었는지 본다(색 지우기는 levels 의 wireFields 가 한다)
const HAS_ANSI = /\x1B\[/;

/** 로그 레코드(pino JSON 부분집합). 바인딩(category, sub, tags, err …)이 같이 실린다 */
export type LogRecord = { level: number; time: number; msg?: unknown; category?: string; sub?: string; tags?: string[]; [field: string]: unknown };
/** 레코드를 받는 곳(파일 등) */
type Destination = (rec: LogRecord) => void;
/** 로그 스트림을 받는 HTTP 응답. 여기서 쓰는 것만 */
type SseClient = {
  write(chunk: string): boolean;
  /** 아직 보내지 못하고 쌓인 바이트 */
  readonly writableLength: number;
  end(): void;
  /** 소켓까지 강제로 닫는다(읽지 않는 클라이언트는 end()만으로는 닫히지 않는다) */
  destroy(): unknown;
  on(event: "close" | "error", fn: () => void): unknown;
  writeHead(code: number, headers: Record<string, string>): unknown;
  flushHeaders(): void;
};

// 브리지: console 메서드 → pino 레벨(숫자). log는 debug로 내린다. 여기 걸리는 건 전부 서드파티라
// info 레벨을 채우면 우리 로그가 묻힌다. 대시보드도 DEBUG 알약에서 본다.
const CONSOLE_LEVEL: Record<"log" | "info" | "warn" | "error", number> = { log: 20, info: 30, warn: 40, error: 50 };
// 로그 스트림에 보내지 못하고 쌓인 양이 이만큼을 넘으면 읽지 않는 소비자로 보고 끊는다.
// 붙을 때 쌓인 줄(KEPT_LINES, 2000줄 약 0.5MB)을 보내는 동안 write 가 false 를 돌려주는 것은 정상이라 그것만으로는 끊지 않는다
const MAX_PENDING_BYTES = 1024 * 1024;

// 색 입히기. 칠할지는 sink 가 정하므로(useColor) 스트림을 보지 않는다
type Style = Parameters<typeof styleText>[0];
const style = (format: Style) => (text: string) => styleText(format, text, { validateStream: false });

// 레벨 라벨 색.
const LEVEL_COLOR: Record<LevelName, (text: string) => string> = {
  trace: style("gray"),
  debug: style("gray"),
  info: style("cyan"),
  warn: style("yellow"),
  error: style("red"),
  fatal: style(["bgRed", "white"]),
};

// 본문 색도 sink가 레벨로 칠한다. 부르는 쪽은 색을 붙이지 않는다.
const TEXT_COLOR: Record<LevelName, (text: string) => string> = {
  trace: style("gray"),
  debug: style("gray"),
  info: (s) => s,
  warn: style("yellow"),
  error: style("red"),
  fatal: style(["red", "bold"]),
};

// 카테고리 배지 색. 이름 해시로 정한다(대시보드 뷰어의 catColor와 같은 방식).
// 전부 회색이면 [player]와 [voice]가 눈에 안 들어온다. 스무 종을 색으로 구분하는 편이
// 이모지로 구분하는 것보다 확실하고, cmd에서 깨지지도 않는다.
const CAT_COLORS = (["magenta", "blue", "green", "yellow", "cyan", "redBright", "blueBright", "greenBright"] as const).map(style);
function catColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CAT_COLORS[h % CAT_COLORS.length];
}

// 가리기(redact). 레코드가 터미널, 버퍼, SSE, 파일로 나가기 전 한 곳에서 한다.
// 맨 위 키 이름과 메시지 패턴만 본다(중첩된 필드는 보지 않는다).
const REDACT_KEYS = new Set(["authorization", "cookie", "password", "secret", "client_secret", "clientsecret", "access_token", "accesstoken", "refresh_token", "refreshtoken", "token", "totp", "totpserver", "apikey", "api_key"]);
const MSG_PATTERNS = [
  { re: /(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, repl: "$1[REDACTED]" },
  { re: /((?:access_?token|client_?secret|refresh_?token|api_?key)["'`\s:=]{1,4}["'`]?)[A-Za-z0-9._~+/=-]{6,}/gi, repl: "$1[REDACTED]" },
  // JSON 으로 실린 토큰, 암호 키(음성 연결의 진행 줄: 참가, 세션 설명, 상태 바뀜). 값은 글, 배열, 객체(Uint8Array)
  { re: /"(token|secret_?key)":("[^"]*"|\[[^\]]*\]|\{[^}]*\})/gi, repl: '"$1":"[REDACTED]"' },
];

/** 지난 1시간 경고, 오류. fatal 은 오류로 */
type Problem = { ts: number; level: "warn" | "error"; text: string };
const PROBLEM_WINDOW_MS = 60 * 60_000;
const MAX_PROBLEMS = 2000;

class LogManager {
  maxLines: number;
  consoleLevel: number;
  buffer: WireEntry[];
  problems: Problem[];
  lastId: number;
  boot: number;
  clients: Set<SseClient>;
  _owners: Map<SseClient, string>;
  _cleanups: WeakMap<SseClient, () => void>;
  _heartbeat: NodeJS.Timeout | null;
  _heartbeatMs: number;
  destinations: Destination[];
  earlyRecords: LogRecord[];
  isTTY: boolean;
  useColor: boolean;
  terminal: (rec: LogRecord) => void;

  /** terminal: 터미널에 찍는 함수. 생략하면 _renderTerminal */
  constructor({ maxLines = KEPT_LINES, intercept = true, terminal }: { maxLines?: number; intercept?: boolean; terminal?: (rec: LogRecord) => void } = {}) {
    this.maxLines = maxLines;
    this.terminal = terminal ?? ((rec) => this._renderTerminal(rec));
    // 터미널에만 적용하는 하한. 파일, 대시보드는 레코드가 오는 대로 다 받는다.
    // 조사 중 debug를 켜도 터미널은 조용하게 둘 수 있어야 한다.
    this.consoleLevel = 0;
    this.buffer = [];
    this.problems = [];
    this.lastId = 0;
    // 기동 시각. 줄 번호는 다시 시작하면 처음부터라, 이어 받을 번호가 이 실행의 것인지 구분한다
    this.boot = Date.now();
    this.clients = new Set();
    this._owners = new Map(); // res -> 연 사람(상한을 사람마다 센다)
    this._cleanups = new WeakMap(); // res -> 한 번만 도는 정리 함수 (close, error, 쓰기 실패 공용)
    this._heartbeat = null; // 연결 모두에 한 타이머로 보낸다. 첫 연결 때 건다
    this._heartbeatMs = 0;
    this.destinations = []; // file(file.ts) 등 레코드를 받는 함수
    // destination이 붙기 전에 지나간 레코드. 파일 로그는 설정을 읽은 뒤에야 열 수 있는데,
    // 설정 경고와 기동 오류가 바로 그 전에 나온다. 첫 destination이 붙을 때 흘려보내고 모으기를 멈춘다.
    this.earlyRecords = [];

    // 터미널 사정(색, TTY)은 여기서만 본다.
    this.isTTY = !!process.stdout.isTTY;
    this.useColor = this.isTTY;

    if (intercept) this._intercept();
  }

  // console.* 가로채기: 우리 코드는 전부 logger.*를 쓰므로, 여기 걸리는 것은 서드파티, 의존성의 console.* 다.
  // category "external" 로 받아 터미널 형식을 맞추고 대시보드에도 싣는다.
  _intercept() {
    for (const method of ["log", "info", "warn", "error"] as const) {
      console[method] = (...args: unknown[]) => {
        this.record({
          level: CONSOLE_LEVEL[method],
          time: Date.now(),
          msg: util.format(...args), // console 과 같은 형식(%s, 객체 inspect, Error stack)
          category: "external",
        });
      };
    }
  }

  // facade와 브리지가 공통으로 부르는 진입점.
  record(rec: LogRecord) {
    const safe = this._redact(rec);
    if (safe.level >= this.consoleLevel) this.terminal(safe);

    const entry = this._toWire(safe);
    if (safe.level >= LEVELS.warn) this._keepProblem(entry);
    this.buffer.push(entry);
    if (this.buffer.length > this.maxLines) this.buffer.shift();

    const payload = this._frameOf(entry);
    for (const res of this.clients) {
      try {
        // 읽지 않는 소비자를 붙들고 있으면 메모리가 는다. 쌓인 양이 상한을 넘으면 끊는다(다시 열면 마지막 번호 뒤부터 받는다).
        // end()만으로는 읽지 않는 소켓과 쌓인 바이트가 남으므로 소켓을 강제로 닫는다
        if (res.writableLength > MAX_PENDING_BYTES) {
          this._dropClient(res);
          res.destroy();
          continue;
        }
        res.write(payload);
      } catch {
        this._dropClient(res);
      }
    }

    if (this.destinations.length === 0) {
      if (this.earlyRecords.length < this.maxLines) this.earlyRecords.push(safe);
    } else {
      for (const dest of this.destinations) {
        try {
          dest(safe); // destination 은 가리기만 한 레코드를 그대로 받는다(ANSI 도 그대로)
        } catch {
          /* destination 오류가 로깅을 막지 않도록 삼킴 */
        }
      }
    }
  }

  // destination 등록. 첫 등록에 한해 그 이전 레코드를 재생한다(위 earlyRecords 설명).
  addDestination(dest: Destination) {
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

  _redact(rec: LogRecord): LogRecord {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k === "msg" || k === "level" || k === "time") {
        out[k] = v;
        continue;
      }
      out[k] = REDACT_KEYS.has(String(k).toLowerCase()) ? "[REDACTED]" : v;
    }
    if (typeof out.msg === "string") {
      let msg = out.msg;
      for (const { re, repl } of MSG_PATTERNS) msg = msg.replace(re, repl);
      out.msg = msg;
    }
    return out as LogRecord;
  }

  /** 터미널 출력 하한 설정. 이름(info 등)이나 빈 값(=제한 없음). */
  setConsoleLevel(name: string) {
    this.consoleLevel = LEVELS[name as LevelName] ?? 0;
  }

  _renderTerminal(rec: LogRecord) {
    const name = levelNameOf(rec.level) || "info";
    const paint = (fn: ((text: string) => string) | undefined, text: string) => (this.useColor && fn ? fn(text) : text);

    const tag = paint(LEVEL_COLOR[name], name.toUpperCase().padEnd(5));
    // 카테고리 배지: sub 바인딩(하위 카테고리, pino child) 있으면 [category/sub]
    const catLabel = rec.category ? (rec.sub ? `${rec.category}/${rec.sub}` : rec.category) : rec.sub || "";
    const cat = catLabel ? paint(catColor(rec.category || rec.sub || ""), ` [${catLabel}]`) : "";
    // 태그(카테고리와 따로 붙는 라벨)는 배지 뒤에 #tag 로
    const tagsRaw = Array.isArray(rec.tags) && rec.tags.length ? " " + rec.tags.map((t) => `#${t}`).join(" ") : "";
    const tags = tagsRaw ? paint(style("gray"), tagsRaw) : "";

    const raw = typeof rec.msg === "string" ? rec.msg : String(rec.msg ?? "");
    // 호출부가 이미 색을 넣었으면 덧칠하지 않는다(ANSI가 겹치면 리셋 위치가 어긋난다).
    const msg = HAS_ANSI.test(raw) ? raw : paint(TEXT_COLOR[name], raw);

    (rec.level >= LEVELS.error ? REAL.error : REAL.log)(`${tag}${cat}${tags} ${msg}`);
  }

  _toWire(rec: LogRecord): WireEntry {
    return { id: ++this.lastId, ...wireFields(rec) };
  }

  // 경고, 오류는 지난 1시간을 따로 둔다(봇 상태 탭). 줄 버퍼는 debug 를 켜면 몇 분 만에 넘친다
  _keepProblem(entry: WireEntry) {
    this.problems.push({ ts: entry.ts, level: entry.level === "warn" ? "warn" : "error", text: entry.text });
    const since = entry.ts - PROBLEM_WINDOW_MS;
    while (this.problems.length > MAX_PROBLEMS || (this.problems[0] && this.problems[0].ts < since)) this.problems.shift();
  }

  /** 지난 1시간의 경고, 오류(오래된 것부터) */
  recentProblems(now = Date.now()) {
    return this.problems.filter((one) => now - one.ts <= PROBLEM_WINDOW_MS);
  }

  /**
   * 관리자 로그 스트림 구독. 연결 상한, 하트비트는 대시보드 SSE와 같은 설정을 쓴다
   * (`SSE_MAX_CONNECTIONS`, `SSE_HEARTBEAT_SEC`). 상한은 대시보드 SSE 처럼 사용자마다 센다(userKey: 디스코드 사용자 id).
   * after: 화면이 마지막으로 받은 줄의 SSE id("기동시각.번호"). 이 실행의 것이면 그 뒤 줄만 보낸다. 다른 실행의 것이면(봇을 다시 시작함)
   * reset 을 먼저 보내고 전부. 없으면(처음 연결) 전부. 이어 받을 줄이 쌓아 둔 줄 밖으로 이미 밀려났으면 gap(받지 못한 줄 수)을 줄보다 먼저 보낸다.
   *
   * 상한을 넘으면 아무것도 쓰지 않고 false(답은 부른 경로가 문제 응답으로 쓴다). 느린 소비자는 record 가 정리한다(쌓인 양을 본다).
   */
  addClient(res: SseClient, userKey: string, after = "") {
    const { maxPerUser } = config.dashboard.sse;
    if ([...this._owners.values()].filter((key) => key === userKey).length >= maxPerUser) return false;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      // 끊을 때 이 연결의 소켓을 강제로 닫으므로 재사용하지 않게 한다
      Connection: "close",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const [boot, seqText] = after.split(".");
    const seq = Number(seqText);
    const resuming = boot === String(this.boot) && Number.isInteger(seq);
    if (after && !resuming) res.write("event: reset\ndata: {}\n\n");
    // 이어 받을 첫 줄(이 실행의 seq 다음, 다시 시작했으면 1번)보다 쌓아 둔 첫 줄이 뒤면 그 사이를 못 받았다. 처음 연결은 이어 받는 것이 아니라 알리지 않는다
    const wanted = resuming ? seq + 1 : 1;
    const first = this.buffer[0]?.id;
    if (after && first !== undefined && first > wanted) res.write(`event: gap\ndata: ${JSON.stringify({ missed: first - wanted } satisfies LogGap)}\n\n`);
    for (const entry of this.buffer) {
      if (!resuming || entry.id > seq) res.write(this._frameOf(entry));
    }

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      this.clients.delete(res);
      this._owners.delete(res);
    };

    this.clients.add(res);
    this._owners.set(res, userKey);
    this._cleanups.set(res, cleanup);
    this.syncHeartbeat();
    res.on("close", cleanup);
    res.on("error", cleanup);
    return true;
  }

  // SSE 한 줄. id 를 실어 브라우저가 재연결할 때 마지막 id(Last-Event-ID)를 보내게 한다
  _frameOf(entry: WireEntry) {
    return `id: ${this.boot}.${entry.id}\ndata: ${JSON.stringify(entry)}\n\n`;
  }

  /**
   * 유휴 연결이 프록시 타임아웃에 끊기지 않게 주석 프레임을 보낸다(대시보드 SSE와 같은 방식).
   * 간격이 바뀌었으면 다시 건다(운영 조절값을 저장하면 조립이 부른다). 아직 연결이 없었으면 걸지 않는다
   */
  syncHeartbeat() {
    const ms = config.dashboard.sse.heartbeatMs;
    if (!this.clients.size && !this._heartbeat) return;
    if (this._heartbeat && ms === this._heartbeatMs) return;
    if (this._heartbeat) clearInterval(this._heartbeat);
    this._heartbeatMs = ms;
    this._heartbeat = setInterval(() => this._pingAll(), ms);
    this._heartbeat.unref?.();
  }

  _pingAll() {
    for (const res of [...this.clients]) {
      try {
        res.write(": ping\n\n");
      } catch {
        this._dropClient(res);
      }
    }
  }

  /** 연결 하나를 뺀다(세션이 끝나 끊을 때). 닫힘을 기다리지 않는다 */
  drop(res: SseClient) {
    this._dropClient(res);
  }

  /** 연결 정리. 쓰기 실패 경로에서도 함께 제거한다. */
  _dropClient(res: SseClient) {
    const cleanup = this._cleanups.get(res);
    if (cleanup) cleanup();
    else this.clients.delete(res);
  }
}

const singleton = Object.assign(new LogManager(), {
  LogManager, // 테스트용 클래스(격리 인스턴스 생성)
  _internals: { CONSOLE_LEVEL, REDACT_KEYS, MSG_PATTERNS },
});
export default singleton;
