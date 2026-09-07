"use strict";

// src/playbackResponder.js — 곡 추가 결과를 알리는 매체별 어댑터.
//
// 회귀 대상: 코어가 표현할 수 있는 출력이 "상호작용 응답" 아니면 "텍스트 채널"뿐이라
// 대시보드가 별도 경로로 갈라져 나갔던 문제. silentResponder가 그 세 번째 경우다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");

const { interactionResponder, channelResponder, silentResponder, _internals } = require("../src/playbackResponder");

function fakeInteraction({ deferred = true, replied = false } = {}) {
  const calls = [];
  return {
    calls,
    deferred,
    replied,
    async editReply(payload) {
      calls.push(["editReply", payload]);
      return { delete: async () => calls.push(["delete"]) };
    },
    async reply(payload) {
      calls.push(["reply", payload]);
      return { delete: async () => calls.push(["delete"]) };
    },
    async deleteReply() {
      calls.push(["deleteReply"]);
    },
  };
}

function fakeChannel() {
  const calls = [];
  return {
    calls,
    async send(payload) {
      calls.push(["send", payload]);
      return { delete: async () => {} };
    },
  };
}

const embedManager = { createSearchingContainer: (msg) => ({ container: msg }) };

// ── 공통 계약 ────────────────────────────────────────────────

test("세 어댑터가 같은 계약을 만족한다 (코어는 이 둘만 호출한다)", () => {
  const responders = [interactionResponder(fakeInteraction(), embedManager), channelResponder(fakeChannel()), silentResponder];
  for (const r of responders) {
    assert.equal(typeof r.notifyQueued, "function");
    assert.equal(typeof r.dismissPlaceholder, "function");
  }
});

test("안내 실패가 재생을 망가뜨리지 않는다 — 던지지 않는다", async () => {
  const broken = {
    send: async () => {
      throw new Error("채널 권한 없음");
    },
  };
  await channelResponder(broken).notifyQueued("x"); // 던지면 여기서 실패

  const brokenInteraction = fakeInteraction();
  brokenInteraction.editReply = async () => {
    throw new Error("만료된 토큰");
  };
  await interactionResponder(brokenInteraction, embedManager).notifyQueued("x");
});

// ── silentResponder ──────────────────────────────────────────

test("silentResponder는 디스코드를 한 번도 건드리지 않는다 (대시보드가 갈라졌던 이유)", async () => {
  const channel = fakeChannel();
  const interaction = fakeInteraction();

  await silentResponder.notifyQueued("대기열에 추가됨");
  await silentResponder.dismissPlaceholder();

  assert.deepEqual(channel.calls, []);
  assert.deepEqual(interaction.calls, []);
});

// ── interactionResponder ─────────────────────────────────────

test("상호작용: 안내를 CV2 컨테이너로 보낸다 — content는 CV2 메시지에서 거부된다", async () => {
  const interaction = fakeInteraction({ deferred: true });
  await interactionResponder(interaction, embedManager).notifyQueued("추가됨");

  const [name, payload] = interaction.calls[0];
  assert.equal(name, "editReply");
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.deepEqual(payload.components, [{ container: "추가됨" }]);
  assert.ok(!("content" in payload), "CV2 메시지에 content를 넣으면 디스코드가 거부한다");
});

test("상호작용: 아직 응답 전이면 reply로 확인만 하고 지운다", async () => {
  const interaction = fakeInteraction({ deferred: false, replied: false });
  await interactionResponder(interaction, embedManager).dismissPlaceholder();
  assert.deepEqual(
    interaction.calls.map(([n]) => n),
    ["reply", "deleteReply"],
  );
});

// ── channelResponder ─────────────────────────────────────────

test("채널: 안내 전에 자리표시자를 먼저 치운다 — 별도 메시지라 덮어쓸 수 없다", async () => {
  const order = [];
  const channel = {
    async send() {
      order.push("send");
      return { delete: async () => {} };
    },
  };
  const responder = channelResponder(channel, () => order.push("dismiss"));

  await responder.notifyQueued("추가됨");
  assert.deepEqual(order, ["dismiss", "send"]);
});

test("채널: 보낼 곳이 없으면 조용히 넘어간다", async () => {
  await channelResponder(null).notifyQueued("x");
  await channelResponder({}).notifyQueued("x");
});

// ── 멱등성 ───────────────────────────────────────────────────

test("dismissPlaceholder는 멱등 — 코어와 진입점이 모두 불러도 한 번만 실행된다", async () => {
  let count = 0;
  const responder = channelResponder(fakeChannel(), () => count++);

  await responder.dismissPlaceholder();
  await responder.dismissPlaceholder();
  await responder.notifyQueued("x"); // 내부에서도 부른다
  assert.equal(count, 1);
});

test("onceDismiss: 정리 함수가 던져도 삼킨다 (이미 삭제된 메시지)", async () => {
  const dismiss = _internals.onceDismiss(() => {
    throw new Error("Unknown Message");
  });
  await dismiss();
});
