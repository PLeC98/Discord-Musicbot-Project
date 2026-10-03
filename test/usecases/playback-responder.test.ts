// src/usecases/responders.ts — 곡 추가 결과를 알리는 매체별 어댑터.
//
// 회귀 대상: 코어가 표현할 수 있는 출력이 "상호작용 응답" 아니면 "텍스트 채널"뿐이라
// 대시보드가 별도 경로로 갈라져 나갔던 문제. silentResponder가 그 세 번째 경우다.

import { test } from "node:test";
import assert from "node:assert/strict";

import { interactionResponder, channelResponder, silentResponder, _internals } from "../../src/usecases/responders.ts";
import type { GuildTextBasedChannel, RepliableInteraction } from "discord.js";
import { frame, post } from "../../src/ui/frame.ts";
import { fake, fakeWith } from "../helpers/fake.ts";

// 보낸 것. 여기서 보는 칸만
type Payload = { flags?: unknown; components?: unknown[]; content?: string };
type Call = [name: string, payload?: Payload];

function fakeInteraction({ deferred = true, replied = false } = {}) {
  const calls: Call[] = [];
  return fakeWith<RepliableInteraction>()({
    calls,
    deferred,
    replied,
    async editReply(payload: Payload) {
      calls.push(["editReply", payload]);
      return { delete: async () => calls.push(["delete"]) };
    },
    async reply(payload: Payload) {
      calls.push(["reply", payload]);
      return { delete: async () => calls.push(["delete"]) };
    },
    async deleteReply() {
      calls.push(["deleteReply"]);
    },
  });
}

function fakeChannel() {
  const calls: Call[] = [];
  return fakeWith<GuildTextBasedChannel>()({
    calls,
    async send(payload: Payload) {
      calls.push(["send", payload]);
      return { delete: async () => {} };
    },
  });
}
const channelOf = (partial: object) => fake<GuildTextBasedChannel>(partial);

// 담은 안내의 화면
const view = frame({ body: "추가됨" });

// ── 공통 계약 ────────────────────────────────────────────────

test("세 어댑터가 같은 계약을 만족한다 (코어는 이 둘만 호출한다)", () => {
  const responders = [interactionResponder(fakeInteraction()), channelResponder(fakeChannel()), silentResponder];
  for (const r of responders) {
    assert.equal(typeof r.notifyQueued, "function");
    assert.equal(typeof r.dismissPlaceholder, "function");
  }
});

test("안내 실패가 재생을 망가뜨리지 않는다 — 던지지 않는다", async () => {
  const broken = channelOf({
    send: async () => {
      throw new Error("채널 권한 없음");
    },
  });
  await channelResponder(broken).notifyQueued(view); // 던지면 여기서 실패

  const brokenInteraction = fakeInteraction();
  brokenInteraction.editReply = async () => {
    throw new Error("만료된 토큰");
  };
  await interactionResponder(brokenInteraction).notifyQueued(view);
});

// ── silentResponder ──────────────────────────────────────────

test("silentResponder는 디스코드를 한 번도 건드리지 않는다 (대시보드가 갈라졌던 이유)", async () => {
  const channel = fakeChannel();
  const interaction = fakeInteraction();

  await silentResponder.notifyQueued(view);
  await silentResponder.dismissPlaceholder();

  assert.deepEqual(channel.calls, []);
  assert.deepEqual(interaction.calls, []);
});

// ── interactionResponder ─────────────────────────────────────

test("상호작용: 담은 안내는 모두에게 채널로 새로(채널에 못 쓰면 공개 후속 메시지), 본인 자리표시자는 명령이 치운다", async () => {
  const sent: Payload[] = [];
  const interaction = Object.assign(fakeInteraction({ deferred: false, replied: true }), { channel: { send: async (p: Payload) => (sent.push(p), { id: "c1", delete: async () => {} }) } });
  await interactionResponder(interaction).notifyQueued(view);
  await interactionResponder(interaction).dismissPlaceholder();
  assert.deepEqual(sent, [post(view)]);
  assert.deepEqual(interaction.calls, [], "자리표시자를 건드리지 않는다");

  const calls: Call[] = [];
  const noChannel = Object.assign(fakeInteraction({ deferred: false, replied: true }), { channel: null, followUp: async (p: Payload) => (calls.push(["followUp", p]), { id: "f1" }) });
  await interactionResponder(noChannel).notifyQueued(view);
  assert.deepEqual(calls, [["followUp", post(view)]]);

  // 채널은 있는데 봇이 글을 쓸 수 없다
  const denied = Object.assign(fakeInteraction({ deferred: false, replied: true }), {
    channel: {
      send: async () => {
        throw new Error("Missing Permissions");
      },
    },
    followUp: async (p: Payload) => (calls.push(["followUp", p]), { id: "f2" }),
  });
  await interactionResponder(denied).notifyQueued(view);
  assert.deepEqual(
    calls,
    [
      ["followUp", post(view)],
      ["followUp", post(view)],
    ],
    "권한이 없으면 공개 후속 메시지로",
  );
});

test("채널: 안내를 CV2 메시지로 보낸다", async () => {
  const channel = fakeChannel();
  await channelResponder(channel).notifyQueued(view);
  assert.deepEqual(channel.calls, [["send", post(view)]]);
});

test("상호작용: 아직 응답 전이면 reply로 확인만 하고 지운다", async () => {
  const interaction = fakeInteraction({ deferred: false, replied: false });
  await interactionResponder(interaction).dismissPlaceholder();
  assert.deepEqual(
    interaction.calls.map(([n]) => n),
    ["reply", "deleteReply"],
  );
});

// ── channelResponder ─────────────────────────────────────────

test("채널: 안내 전에 자리표시자를 먼저 치운다 — 별도 메시지라 덮어쓸 수 없다", async () => {
  const order: string[] = [];
  const channel = channelOf({
    async send() {
      order.push("send");
      return { delete: async () => {} };
    },
  });
  const responder = channelResponder(channel, () => order.push("dismiss"));

  await responder.notifyQueued(view);
  assert.deepEqual(order, ["dismiss", "send"]);
});

test("채널: 보낼 곳이 없으면 조용히 넘어간다", async () => {
  await channelResponder(null).notifyQueued(view);
  await channelResponder(channelOf({})).notifyQueued(view);
});

// ── 멱등성 ───────────────────────────────────────────────────

test("dismissPlaceholder는 멱등 — 코어와 진입점이 모두 불러도 한 번만 실행된다", async () => {
  let count = 0;
  const responder = channelResponder(fakeChannel(), () => count++);

  await responder.dismissPlaceholder();
  await responder.dismissPlaceholder();
  await responder.notifyQueued(view); // 내부에서도 부른다
  assert.equal(count, 1);
});

test("onceDismiss: 정리 함수가 던져도 삼킨다 (이미 삭제된 메시지)", async () => {
  const dismiss = _internals.onceDismiss(() => {
    throw new Error("Unknown Message");
  });
  await dismiss();
});
