// 테스트가 설정값을 잠깐 바꾸는 창구.
//
//   await withConfig({ bot: { maxQueueSize: 2 } }, async () => { … });
//
// 준 필드만 바꾸고(안쪽 객체는 합친다) 테스트가 끝나면 되돌린다. 던져도 되돌린다. 없던 필드는 삭제한다.
// config 값은 모듈이 쓰는 순간에 읽으므로(계획서 §3.3) 모듈을 다시 불러오지 않아도 바뀐 값이 보인다.
// 같은 파일 안의 테스트는 순서대로 돈다. 동시에 도는 테스트(concurrency)에서는 쓰지 않는다.

import config from "../../src/config/index.ts";

type Plain = Record<string, unknown>;
const isPlainObject = (v: unknown): v is Plain => v !== null && typeof v === "object" && !Array.isArray(v);

function withConfig<R>(overrides: Plain, fn: () => R): R {
  const undo: Array<[Plain, string, boolean, unknown]> = [];
  const apply = (target: Plain, patch: Plain) => {
    for (const [key, value] of Object.entries(patch)) {
      const inner = target[key];
      if (isPlainObject(value) && isPlainObject(inner)) {
        apply(inner, value);
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
  let result: R;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result instanceof Promise) return result.finally(restore) as R;
  restore();
  return result;
}

export { withConfig };
