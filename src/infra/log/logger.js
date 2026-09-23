"use strict";

// pino와 표면이 같은 얇은 facade. 앱 코드는 이걸로 로그를 찍고, 저장·렌더·배포는 sink(LogManager)가 한다.
// 나중에 pino를 넣으면 이 파일만 갈아끼운다.
//
//   logger.warn({ guildId }, "무언가 %s", x);
//   const yt = logger.child({ category: "youtube" });
//   yt.error(err, "다운로드 실패");
//
// 지켜야 할 표면:
//   - 레벨: trace/debug/info/warn/error/fatal (10~60), logger.level 가변 + 게이팅
//   - 호출: fn(mergingObj?, msg?, ...interp) | fn(err) | fn(msg, ...interp)
//   - child(bindings): bindings 병합된 자식 (카테고리도 그냥 바인딩이다)
//   - pino에 없는 logger.log()는 노출하지 않는다 (레거시 console.log은 LogManager 브리지가 흡수)

const util = require("util");
const sink = require("./sink"); // 속성 접근으로 호출(sink.record) → 테스트에서 스텁 가능

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const LEVEL_NAMES = { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal" };

// pino 호환 인자 → sink 레코드로 정규화.
function buildRecord(levelNum, bindings, args) {
  let merge = null;
  let msg; // 아래 if/else-if/else 세 갈래가 모두 할당(exhaustive)

  if (args.length && args[0] instanceof Error) {
    // logger.error(err) / logger.error(err, "msg", ...)
    merge = { err: args[0] };
    msg = args.length > 1 ? util.format(args[1], ...args.slice(2)) : args[0].message;
  } else if (args.length && typeof args[0] === "object" && args[0] !== null) {
    // logger.info(obj, "msg", ...) / logger.info(obj)
    merge = args[0];
    msg = args.length > 1 ? util.format(args[1], ...args.slice(2)) : "";
  } else {
    // logger.info("msg", ...)
    msg = util.format(...args);
  }

  const rec = { level: levelNum, time: Date.now(), ...bindings, ...(merge || {}) };

  // err 가시화: 구조화 필드(rec.err)는 유지하되 터미널/SSE에 보이도록 stack을 msg에 접붙임.
  const err = rec.err || rec.error;
  if (err instanceof Error) {
    const stack = err.stack || err.message;
    rec.err = stack;
    msg = msg ? `${msg} ${stack}` : stack;
  }

  rec.msg = msg;
  return rec;
}

// 루트 레벨은 공유 상태다. 각 파일이 require 시점에 `child()`로 로거를 만들어 두는데,
// 레벨을 그때 복사해 버리면 나중에(config를 읽은 뒤) 루트 레벨을 바꿔도 이미 만들어진
// 자식들에게 닿지 않는다. 설정이 아무 효과가 없어진다. pino의 자식도 부모 레벨을 따른다.
let rootLevelNum = LEVELS.info;

function createLogger(bindings = {}, ownLevel = null) {
  let ownLevelNum = ownLevel != null ? (LEVELS[ownLevel] ?? null) : null;
  const isRoot = arguments.length === 0;
  const effective = () => ownLevelNum ?? rootLevelNum;

  const api = {
    get level() {
      return LEVEL_NAMES[effective()];
    },
    set level(v) {
      if (LEVELS[v] == null) return;
      // 루트에 설정하면 전체 기본이 바뀐다. 자식에 설정하면 그 자식만 따로 논다.
      if (isRoot) rootLevelNum = LEVELS[v];
      else ownLevelNum = LEVELS[v];
    },
    child(childBindings) {
      return createLogger({ ...bindings, ...childBindings }, ownLevelNum != null ? LEVEL_NAMES[ownLevelNum] : null);
    },
  };

  for (const [name, num] of Object.entries(LEVELS)) {
    api[name] = (...args) => {
      if (num < effective()) return; // 레벨 게이팅
      sink.record(buildRecord(num, bindings, args));
    };
  }

  return api;
}

const root = createLogger();
root._internals = { LEVELS, LEVEL_NAMES, buildRecord, createLogger };
module.exports = root;
