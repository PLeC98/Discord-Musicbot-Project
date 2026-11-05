// src/rules/holds.ts: 지금 음성 상태에서 걸려야 할 억제 사유와 듣는 사람 수

import { test } from "node:test";
import assert from "node:assert/strict";
import { holdsOf, heldBy, listenersIn, HOLDS } from "../../src/rules/holds.ts";

const view = (over = {}) => ({ serverMute: false, suppress: false, onStage: false, listeners: 1, ...over });
const sorted = (set: Set<string>) => [...set].sort();

test("아무 일 없으면 사유가 없다", () => {
  assert.deepEqual(sorted(holdsOf(view())), []);
});

test("서버 음소거, 일반 채널의 말할 수 없음은 mute, 스테이지 청중은 stage", () => {
  assert.deepEqual(sorted(holdsOf(view({ serverMute: true }))), ["mute"]);
  assert.deepEqual(sorted(holdsOf(view({ suppress: true }))), ["mute"], "AFK 채널 등");
  assert.deepEqual(sorted(holdsOf(view({ suppress: true, onStage: true }))), ["stage"]);
  assert.deepEqual(sorted(holdsOf(view({ serverMute: true, suppress: true, onStage: true }))), ["mute", "stage"]);
});

test("듣는 사람이 없으면 alone. 다른 사유와 겹친다", () => {
  assert.deepEqual(sorted(holdsOf(view({ listeners: 0 }))), ["alone"]);
  assert.deepEqual(sorted(holdsOf(view({ listeners: 0, serverMute: true }))), ["alone", "mute"]);
});

test("보여 줄 사유는 표의 차례(mute, stage, alone)의 첫째", () => {
  assert.deepEqual(HOLDS, ["mute", "stage", "alone"]);
  assert.equal(heldBy(new Set(["alone", "mute"])), "mute");
  assert.equal(heldBy(new Set(["alone", "stage"])), "stage");
  assert.equal(heldBy(new Set()), null);
});

test("듣는 사람: 봇과 헤드셋을 끈 사람(스스로, 서버가)은 세지 않는다", () => {
  const member = (bot: boolean, selfDeaf = false, serverDeaf = false) => ({ user: { bot }, voice: { selfDeaf, serverDeaf } });
  assert.equal(listenersIn([member(false), member(false)]), 2);
  assert.equal(listenersIn([member(true), member(false, true), member(false, false, true)]), 0);
  assert.equal(listenersIn([]), 0);
  assert.equal(listenersIn([{ user: { bot: false }, voice: { selfDeaf: null, serverDeaf: null } }]), 1, "모르는 값은 켠 것으로");
});
