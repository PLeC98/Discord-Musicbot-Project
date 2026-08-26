"use strict";

// logger — pino와 "표면이 동일한" 얇은 facade (A안: pino 도입 시 이 파일만 버리고 갈아끼움).
// 앱 코드는 이걸 통해 로그를 찍고, 실제 저장/렌더/배포는 sink(LogManager)가 담당.
//
//   const logger = require("./logger");
//   logger.info("메시지");
//   logger.warn({ guildId }, "무언가 %s", x);
//   const yt = logger.child({ category: "youtube" });
//   yt.error(err, "다운로드 실패");
//
// pino 표면 계약:
//   - 레벨: trace/debug/info/warn/error/fatal (10~60), logger.level 가변 + 게이팅
//   - 호출: fn(mergingObj?, msg?, ...interp) | fn(err) | fn(msg, ...interp)
//   - child(bindings): bindings 병합된 자식 (카테고리 = 그냥 바인딩)
//   ⚠ pino엔 없는 logger.log()는 노출하지 않음 (레거시 console.log은 LogManager 브리지가 흡수)

const util = require("util");
const sink = require("./LogManager"); // 속성 접근으로 호출(sink.record) → 테스트에서 스텁 가능

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

function createLogger(bindings = {}, levelName = "info") {
  let levelNum = LEVELS[levelName] ?? LEVELS.info;

  const api = {
    get level() {
      return LEVEL_NAMES[levelNum];
    },
    set level(v) {
      if (LEVELS[v] != null) levelNum = LEVELS[v];
    },
    child(childBindings) {
      return createLogger({ ...bindings, ...childBindings }, LEVEL_NAMES[levelNum]);
    },
  };

  for (const [name, num] of Object.entries(LEVELS)) {
    api[name] = (...args) => {
      if (num < levelNum) return; // 레벨 게이팅
      sink.record(buildRecord(num, bindings, args));
    };
  }

  return api;
}

const root = createLogger();
root._internals = { LEVELS, LEVEL_NAMES, buildRecord, createLogger };
module.exports = root;
