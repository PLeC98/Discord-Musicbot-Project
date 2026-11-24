// pino와 표면이 같은 얇은 facade. 앱 코드는 이걸로 로그를 찍고, 저장, 렌더, 배포는 sink(LogSink)가 한다.
//
//   log.warn({ guildId }, L.<이름공간>.<키>({ 값 }));
//   const yt = logger.child({ category: "youtube" });
//   yt.error(err, L.youtube.<키>());
//
// 지켜야 할 표면:
//   - 레벨: trace/debug/info/warn/error/fatal (10~60). logger.level을 바꿀 수 있고 그보다 낮은 레벨은 찍지 않는다
//   - 호출: fn(문구) | fn(바인딩, 문구) | fn(err, 문구), 문구 뒤에 값 하나. 문구는 서술자(infra/log/text의 L)이고 레코드에 msg(그린 글), event, args로 나눠 싣는다.
//     글(fn("글"), fn(바인딩, "글"))과 오류만 넘기는 fn(err)는 타입이 받지 않는다(새 로그 줄이 문구표를 건너뛰지 않게). 실행 중에는 타입을 거치지 않은 호출도 글로 남긴다(buildRecord)
//   - child(bindings): bindings 병합된 자식 (카테고리도 그냥 바인딩이다)
//   - pino에 없는 logger.log()는 노출하지 않는다 (서드파티의 console.* 는 sink의 console 브리지가 받는다)

import util from "util";
import sink from "./sink.ts";
import type { LogRecord } from "./sink.ts";
import { LEVELS, isLevel, levelNameOf, type LevelName } from "./levels.ts";
import { isLogText, recordArgs, renderLogText, type LogArgs, type LogBindings, type LogText } from "./log-text.ts";

/** 레벨마다 찍는 함수. 문구(서술자)만 받고, 문구 뒤에는 값 하나를 받는다(형식 문자열로 쓰지 않고 inspect해 뒤에 붙인다) */
interface LogFn {
  (text: LogText): void;
  (bindings: LogBindings, text: LogText): void;
  (err: Error, text: LogText): void;
  // 문구 뒤의 값 하나(대개 catch의 오류): 글 형식의 util.format처럼 inspect해 뒤에 붙인다(Error는 err로도)
  (text: LogText, value: unknown): void;
  (bindings: LogBindings, text: LogText, value: unknown): void;
}

/** 레벨마다 찍는 함수, 자식 만들기, 레벨(읽으면 이름, 쓸 때는 레벨 이름 글자를 받고 모르는 이름은 무시한다) */
export interface Logger extends Record<LevelName, LogFn> {
  get level(): LevelName;
  set level(value: string);
  child(bindings: Record<string, unknown>): Logger;
}

// 문구(서술자)를 넘긴 호출: (문구), (바인딩, 문구), (err, 문구). 글은 여기서 그린다(레벨 검사를 지난 뒤라 걸러지는 줄은 그리지 않는다).
// 문구 뒤에 값이 오면 형식 문자열로 쓰지 않고 inspect해서 뒤에 붙인다(글 형식의 util.format과 같은 글). Error는 err로도 올린다.
// inspected: 뒤에 온 Error를 글에 이미 붙였다(코드, 원인까지. err의 스택을 다시 붙이지 않는다)
function textRecord(args: unknown[]): { merge: Record<string, unknown> | null; msg: string; text: LogText; inspected: boolean } | null {
  const at = isLogText(args[0]) ? 0 : args.length > 1 && isLogText(args[1]) && typeof args[0] === "object" && args[0] !== null ? 1 : -1;
  if (at < 0) return null;
  const text = args[at] as LogText;
  const lead = at === 1 ? args[0] : null;
  const merge: Record<string, unknown> | null = lead instanceof Error ? { err: lead } : lead ? { ...(lead as Record<string, unknown>) } : null;
  let msg = renderLogText(text);
  const extra = args.slice(at + 1);
  const error = extra.find((value) => value instanceof Error);
  const rest = extra.map((value) => (typeof value === "string" ? value : util.inspect(value)));
  if (rest.length) msg = `${msg} ${rest.join(" ")}`;
  const attach = error && !merge?.err;
  return { merge: attach ? { ...merge, err: error } : merge, msg, text, inspected: Boolean(attach) };
}

// 값 이름 text는 바깥 글을 그대로 내는 문구의 값이다(discord.js, 음성 연결의 진행 줄 등). 글이 msg에 이미 있어 레코드의 값에는 다시 싣지 않는다(양이 많은 trace 줄이 두 배가 되지 않게)
const withoutPassThrough = ({ text: _text, ...rest }: LogArgs): LogArgs => rest;

// pino 호환 인자 → sink 레코드로 정규화.
function buildRecord(levelNum: number, bindings: Record<string, unknown>, args: unknown[]): LogRecord & { msg: string } {
  let merge: Record<string, unknown> | null = null;
  let msg: string; // 아래 if/else-if/else 세 분기가 모두 할당(exhaustive)
  const described = textRecord(args);

  if (described) {
    ({ merge, msg } = described);
  } else if (args.length && args[0] instanceof Error) {
    // logger.error(err) / logger.error(err, "msg", ...)
    merge = { err: args[0] };
    msg = args.length > 1 ? util.format(args[1], ...args.slice(2)) : args[0].message;
  } else if (args.length && typeof args[0] === "object" && args[0] !== null) {
    // logger.info(obj, "msg", ...) / logger.info(obj)
    merge = args[0] as Record<string, unknown>;
    msg = args.length > 1 ? util.format(args[1], ...args.slice(2)) : "";
  } else {
    // logger.info("msg", ...)
    msg = util.format(...args);
  }

  const rec: LogRecord = { level: levelNum, time: Date.now(), ...bindings, ...(merge || {}), ...(described ? { event: described.text.event, args: recordArgs(withoutPassThrough(described.text.args)) } : {}) };

  return Object.assign(rec, { msg: withStack(rec, msg, described?.inspected ?? false) });
}

// err는 rec.err에 stack 글로 남기고, 터미널, SSE에도 보이도록 msg 뒤에 붙인다(inspected: 글에 이미 붙였다). 붙인 msg를 돌려준다
function withStack(rec: LogRecord, msg: string, inspected: boolean): string {
  const err = rec.err || rec.error;
  if (!(err instanceof Error)) return msg;
  const stack = err.stack || err.message;
  rec.err = stack;
  return inspected ? msg : msg ? `${msg} ${stack}` : stack;
}

// 루트 레벨은 공유 상태다. 파일마다 불러올 때 `child()`로 로거를 만들어 두므로, 레벨을 그때 복사하면
// 나중에(설정을 읽은 뒤) 루트 레벨을 바꿔도 이미 만든 자식에게 닿지 않는다. pino의 자식도 부모 레벨을 따른다.
let rootLevelNum = LEVELS.info;

/** record: 레코드를 받는 곳. 생략하면 sink */
function createLogger(bindings: Record<string, unknown> = {}, ownLevel: LevelName | null = null, record: (rec: LogRecord) => void = (rec) => sink.record(rec)): Logger {
  let ownLevelNum: number | null = ownLevel != null ? (LEVELS[ownLevel] ?? null) : null;
  const isRoot = arguments.length === 0;
  const effective = () => ownLevelNum ?? rootLevelNum;

  const api = {
    get level() {
      return levelNameOf(effective()) ?? "info";
    },
    set level(v: string) {
      if (!isLevel(v)) return;
      // 루트에 설정하면 전체 기본이 바뀐다. 자식에 설정하면 그 자식만 따로 논다.
      if (isRoot) rootLevelNum = LEVELS[v];
      else ownLevelNum = LEVELS[v];
    },
    child(childBindings: Record<string, unknown>): Logger {
      return createLogger({ ...bindings, ...childBindings }, ownLevelNum != null ? (levelNameOf(ownLevelNum) ?? null) : null, record);
    },
  } as Logger;

  for (const [name, num] of Object.entries(LEVELS)) {
    api[name as LevelName] = (...args: unknown[]) => {
      if (num < effective()) return;
      record(buildRecord(num, bindings, args));
    };
  }

  return api;
}

const root = Object.assign(createLogger(), { _internals: { LEVELS, buildRecord, createLogger } });
export default root;
