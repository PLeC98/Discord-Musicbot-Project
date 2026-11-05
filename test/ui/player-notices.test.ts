// src/ui/player-notices.ts: 플레이어가 알린 일을 응답 템플릿으로 채널에 보낸다. 안내는 그 경고 수준의 색, 복원은 기본 색

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags, resolveColor } from "discord.js";
import config from "../../src/config/index.ts";
import { sendNotice } from "../../src/ui/player-notices.ts";
import { textsOf } from "../helpers/cv2.ts";
import { fake } from "../helpers/fake.ts";
import type { Player } from "../../src/player/player.ts";

type Sent = { components: Array<{ toJSON(): unknown }>; flags: unknown };

function channel() {
  const sent: Sent[] = [];
  const deleted: number[] = [];
  const player = fake<Pick<Player, "textChannel">>({ textChannel: { send: async (p: Sent) => (sent.push(p), { id: `m${sent.length}`, delete: async () => deleted.push(sent.indexOf(p)) }) } });
  return { player, sent, deleted };
}
const accentOf = (p: Sent) => (p.components[0].toJSON() as { accent_color?: number }).accent_color;

test("그 곡에서 멈춰 둠: 연달아 실패는 오류 색, 헤더 줄, ▶ 줄, 채널 메시지(Components V2)로. 다음 곡도 안 되는 실패는 그 까닭에 한 줄을 더한다", async () => {
  const { player, sent } = channel();
  await sendNotice(player, "parked", { kind: "failures", count: 3 });
  assert.deepEqual(textsOf(sent[0]), ["### ❌ 3곡이 연달아 재생되지 않아 일시정지했어요.\n재생 버튼으로 다시 시도하거나 다음 곡 버튼으로 넘길 수 있어요."]);
  await sendNotice(player, "parked", { kind: "environment", error: Object.assign(new Error("끊김"), { code: "network-error" }) });
  assert.match(textsOf(sent[1])[0], /\n다음 곡으로 넘기지 않고 일시정지했어요\. 재생 버튼을 누르면 다시 시도해요\.$/);
  assert.equal(accentOf(sent[0]), resolveColor("#ED4245"));
  assert.deepEqual(sent[0].flags, [MessageFlags.IsComponentsV2]);
});

test("안내는 그 수준의 수명 뒤 지운다: 멈춰 둠(오류) 15초, 자동재생(경고), 복원 10초", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { player, deleted } = channel();
    await sendNotice(player, "parked", { kind: "failures", count: 3 });
    await sendNotice(player, "autoplay-gave-up", { genre: "jazz" });
    await sendNotice(player, "restored", { title: "곡", atSec: 61, paused: false });
    mock.timers.tick(10_000);
    await new Promise(setImmediate);
    assert.deepEqual(deleted.sort(), [1, 2]);
    mock.timers.tick(5_000);
    await new Promise(setImmediate);
    assert.deepEqual(deleted.sort(), [0, 1, 2]);
  } finally {
    mock.timers.reset();
  }
});

test("자동재생 안내는 경고 색, 복원 안내는 헤더 줄, 본문을 기본 색으로", async () => {
  const { player, sent } = channel();
  await sendNotice(player, "autoplay-gave-up", { genre: "jazz" });
  assert.equal(accentOf(sent[0]), resolveColor("#FEE75C"));
  await sendNotice(player, "restored", { title: "곡", atSec: 61, paused: false });
  assert.deepEqual(textsOf(sent[1]), ["### 🔄 봇이 복구됐어요\n기록된 마지막 재생 상태를 이어갈게요.\n• **곡** (1:01)"]);
  assert.equal(accentOf(sent[1]), resolveColor(config.bot.embedColor));
});
