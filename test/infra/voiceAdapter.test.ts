// src/infra/voiceAdapter.ts — 참가 요청을 잠깐 붙잡아, 그사이 봇이 옮겨졌다고 알려 오면 그 채널로 고쳐 보낸다.

import { test } from "node:test";
import type { TestContext } from "node:test";
import type { DiscordGatewayAdapterCreator, DiscordGatewayAdapterLibraryMethods } from "@discordjs/voice";
import assert from "node:assert/strict";
import { holdingAdapterCreator, HOLD_MS } from "../../src/infra/voiceAdapter.ts";

type VoiceState = Parameters<DiscordGatewayAdapterLibraryMethods["onVoiceStateUpdate"]>[0];
// 게이트웨이로 보낸 것. 여기서 보는 칸만
type Payload = { op: number; d: { channel_id: string | null } };

// 디스코드 쪽 어댑터 대신. 보낸 것을 적고, 게이트웨이 알림을 흘려 넣을 수 있게 한다
function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sent: Payload[] = [];
  const seen: VoiceState[] = [];
  let gateway: DiscordGatewayAdapterLibraryMethods | null = null;
  let destroyed = false;
  const creator: DiscordGatewayAdapterCreator = (methods) => {
    gateway = methods;
    return { sendPayload: (p) => (sent.push(p), true), destroy: () => (destroyed = true) };
  };
  const rewrites: string[] = [];
  const adapter = holdingAdapterCreator(creator, { onRewrite: (from, to) => rewrites.push(`${from}->${to}`) })({
    onVoiceStateUpdate: (d) => seen.push(d),
    onVoiceServerUpdate() {},
    destroy() {},
  });
  // 알림은 봇의 채널만 본다. 나머지 칸은 비운다
  const state = (channelId: string, extra = {}) => gateway!.onVoiceStateUpdate({ channel_id: channelId, ...extra } as VoiceState);
  return { adapter, sent, seen, state, rewrites, destroyed: () => destroyed };
}

const join = (channelId: string) => ({ op: 4, d: { guild_id: "g1", channel_id: channelId, self_deaf: false, self_mute: false } });

test("참가 요청은 잠깐 붙잡았다 그대로 보낸다", (t) => {
  const { adapter, sent } = setup(t);
  assert.equal(adapter.sendPayload(join("a")), true);
  assert.equal(sent.length, 0);
  t.mock.timers.tick(HOLD_MS);
  assert.deepEqual(sent, [join("a")]);
});

test("붙잡은 사이 봇이 다른 채널로 옮겨졌다고 오면 그 채널로 고쳐 보낸다(옛 채널로 끌려가지 않게)", (t) => {
  const { adapter, sent, seen, state, rewrites } = setup(t);
  state("a"); // 봇은 a 에 있다
  adapter.sendPayload(join("a")); // 라이브러리가 옛 설정으로 다시 참가하려 한다
  state("b"); // 사람이 봇을 b 로 불러왔다
  t.mock.timers.tick(HOLD_MS);
  assert.equal(sent[0].d.channel_id, "b");
  assert.deepEqual(rewrites, ["a->b"]);
  assert.equal(seen.length, 2, "알림은 라이브러리에 그대로 넘긴다");
});

test("채널이 그대로인 알림(음소거 등)은 우리가 요청한 이동을 되돌리지 않는다", (t) => {
  const { adapter, sent, state } = setup(t);
  state("a");
  adapter.sendPayload(join("b")); // 우리가 b 로 옮긴다
  state("a", { self_mute: true });
  t.mock.timers.tick(HOLD_MS);
  assert.equal(sent[0].d.channel_id, "b");
});

test("나가기(채널 없음)는 붙잡지 않고, 붙잡아 둔 참가가 있으면 먼저 보낸다", (t) => {
  const { adapter, sent } = setup(t);
  adapter.sendPayload(join("a"));
  adapter.sendPayload({ op: 4, d: { guild_id: "g1", channel_id: null } });
  assert.deepEqual(
    sent.map((p) => p.d.channel_id),
    ["a", null],
  );
});

test("새 참가 요청이 붙잡아 둔 옛 것을 대신한다", (t) => {
  const { adapter, sent } = setup(t);
  adapter.sendPayload(join("a"));
  adapter.sendPayload(join("b"));
  t.mock.timers.tick(HOLD_MS);
  assert.deepEqual(
    sent.map((p) => p.d.channel_id),
    ["b"],
  );
});

test("부수면 붙잡아 둔 것을 버리고 디스코드 쪽 어댑터도 부순다", (t) => {
  const { adapter, sent, destroyed } = setup(t);
  adapter.sendPayload(join("a"));
  adapter.destroy();
  t.mock.timers.tick(HOLD_MS);
  assert.equal(sent.length, 0);
  assert.equal(destroyed(), true);
});
