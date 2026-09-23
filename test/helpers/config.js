"use strict";

// 테스트가 설정값을 잠깐 바꾸는 창구.
//
//   await withConfig({ bot: { maxQueueSize: 2 } }, async () => { … });
//
// 준 칸만 바꾸고(안쪽 객체는 합친다) 시험이 끝나면 되돌린다. 던져도 되돌린다. 없던 칸은 지운다.
// config 값은 모듈이 쓰는 순간에 읽으므로(계획서 §3.3) 모듈을 다시 불러오지 않아도 바뀐 값이 보인다.
// 같은 파일 안의 시험은 차례로 돈다. 동시에 도는 시험(concurrency)에서는 쓰지 않는다.

const config = require("../../config");

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function withConfig(overrides, fn) {
  const undo = [];
  const apply = (target, patch) => {
    for (const [key, value] of Object.entries(patch)) {
      if (isPlainObject(value) && isPlainObject(target[key])) {
        apply(target[key], value);
        continue;
      }
      undo.push([target, key, Object.hasOwn(target, key), target[key]]);
      target[key] = value;
    }
  };
  const restore = () => {
    for (const [target, key, had, old] of undo.reverse()) {
      if (had) target[key] = old;
      else delete target[key];
    }
  };

  apply(config, overrides);
  let result;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === "function") return result.finally(restore);
  restore();
  return result;
}

module.exports = { withConfig };
