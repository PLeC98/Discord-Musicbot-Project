// dashboard/src/composables/config-folds.ts — 접어 둔 출처 · 프롬프트 섹션과 펼친 출처 상세 기억. 장르 · 출처를 지우거나 차례를 바꾸면 기억이 그 카드를 따라간다

import { test } from "node:test";
import assert from "node:assert/strict";

// 브라우저 저장소 흉내(모듈이 불러올 때 읽는다)
const stored = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) } });
const folds = await import("../../../dashboard/src/composables/config-folds.ts");
const { sourceFoldId: s } = folds;

test("장르를 지우면 뒤 장르의 출처 접힘 · 상세 펼침 기억이 한 칸 당겨지고, 지운 장르의 기억은 버린다", () => {
  folds.toggleFold(s(0, 0));
  folds.toggleFold(s(2, 1));
  folds.toggleDeepOpen(s(1, 0));
  folds.toggleDeepOpen(s(2, 0));
  folds.reorderGenres([0, 2]); // 1번 장르를 지웠다
  assert.deepEqual([s(0, 0), s(1, 1), s(2, 1)].map(folds.isFolded), [true, true, false]);
  assert.deepEqual([s(1, 0)].map(folds.isDeepOpen), [true], "뒤 장르의 상세 펼침이 당겨졌다");
  assert.deepEqual(JSON.parse(stored.get("configGenres.folded") ?? "[]").sort(), [s(0, 0), s(1, 1)].sort(), "저장소에도");
  folds.toggleFold(s(0, 0));
  folds.toggleFold(s(1, 1));
  folds.toggleDeepOpen(s(1, 0));
});

test("장르를 끌어 옮기면 기억도 따라가고, 출처를 지우면 그 장르 안에서만 당겨진다", () => {
  folds.toggleFold(s(0, 0));
  folds.reorderGenres([1, 2, 0]); // 맨 앞 장르를 맨 끝으로
  assert.deepEqual([s(0, 0), s(1, 0), s(2, 0)].map(folds.isFolded), [false, false, true]);
  folds.toggleFold(s(2, 0));

  folds.toggleFold(s(0, 2));
  folds.toggleFold(s(1, 2));
  folds.reorderSources(0, [0, 2]); // 0번 장르의 1번 출처를 지웠다
  assert.deepEqual([s(0, 1), s(0, 2), s(1, 2)].map(folds.isFolded), [true, false, true], "다른 장르의 출처는 그대로");
});

test("프롬프트 섹션을 끌어 옮기면 접힘 기억이 따라가고 출처 기억과 섞이지 않는다", () => {
  const { promptFoldId: p } = folds;
  folds.toggleFold(p(1));
  folds.reorderPrompts([1, 2, 0]); // 1번 섹션이 맨 앞으로
  assert.deepEqual([p(0), p(1), s(0, 1)].map(folds.isFolded), [true, false, true]);
  folds.toggleFold(p(0));
});
