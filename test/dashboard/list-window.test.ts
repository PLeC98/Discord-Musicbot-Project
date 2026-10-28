// src/dashboard/list-window.ts — 운영자 화면의 긴 목록 질의 읽기와 자르기.
// 지키는 것: 없는 값 · 잘못된 값은 화면의 처음 값으로(막지 않는다), 개수는 상한까지, states 빈 값은 "아무것도"(없을 때와 다르다).
// 시작이 거른 수를 넘으면 마지막 구간으로 당긴다(나가기 · 거르기로 줄었다)

import { test } from "node:test";
import assert from "node:assert/strict";
import { cut, statusQueryOf } from "../../src/dashboard/list-window.ts";
import { LIST_WINDOW_MAX, Q_MAX, STATUS_QUERY, statusParams } from "../../src/dashboard/contract/admin.ts";

test("질의가 없으면 화면의 처음 값", () => {
  assert.deepEqual(statusQueryOf({}), STATUS_QUERY);
});

test("화면이 보낸 질의를 그대로 읽는다(statusParams 와 맞물린다)", () => {
  const query = { players: { from: 40, count: 25 }, states: ["idle" as const], q: "음악", procs: { from: 0, count: 0 }, sort: "job" as const, desc: false };
  assert.deepEqual(statusQueryOf(statusParams(query)), query);
});

test("잘못된 값은 없는 것으로, 개수는 상한까지, 검색어는 Q_MAX 자까지", () => {
  const read = statusQueryOf({ players: "-1,30", procs: `0,${LIST_WINDOW_MAX + 50}`, sort: "name", desc: "yes", q: "가".repeat(Q_MAX + 5), states: ["playing", "idle"] });
  assert.deepEqual(read.players, STATUS_QUERY.players);
  assert.deepEqual(read.procs, { from: 0, count: LIST_WINDOW_MAX });
  assert.deepEqual([read.sort, read.desc], [STATUS_QUERY.sort, STATUS_QUERY.desc]);
  assert.equal(read.q.length, Q_MAX);
  assert.deepEqual(read.states, STATUS_QUERY.states, "같은 이름이 여럿(배열)이면 없는 것으로");
  assert.deepEqual([statusQueryOf({ players: "1.5,3" }).players, statusQueryOf({ players: "3" }).players], [STATUS_QUERY.players, STATUS_QUERY.players]);
});

test("states: 빈 값은 아무 상태도, 모르는 값은 뺀다", () => {
  assert.deepEqual(statusQueryOf({ states: "" }).states, []);
  assert.deepEqual(statusQueryOf({ states: "idle,stopped,playing" }).states, ["playing", "idle"]);
});

test("자르기: 구간 안이면 그대로, 시작이 거른 수를 넘으면 마지막 구간으로 당긴다, 개수 0 은 행 없이", () => {
  const rows = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(cut(rows, { from: 2, count: 3 }), { from: 2, rows: [2, 3, 4] });
  assert.deepEqual(cut(rows, { from: 8, count: 5 }), { from: 8, rows: [8, 9] }, "끝에 걸치면 당기지 않는다");
  assert.deepEqual(cut(rows, { from: 30, count: 4 }), { from: 6, rows: [6, 7, 8, 9] });
  assert.deepEqual(cut(rows, { from: 30, count: 40 }), { from: 0, rows });
  assert.deepEqual(cut([], { from: 5, count: 3 }), { from: 0, rows: [] });
  assert.deepEqual(cut(rows, { from: 0, count: 0 }), { from: 0, rows: [] });
});
