// interactions/controlAnswers.ts — 시간이 걸리는 조작(처음부터 · 위치 이동)은 받아들이면 "하는 중" 을 Components V2 로 먼저 보내고 결과로 고친다.
// 거절은 본인에게만 안내. 받아들인 뒤에 던지면 그 자리를 안내로 바꾼다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags, type Guild, type GuildMember } from "discord.js";
import { answerReplay, answerSeek } from "../../interactions/controlAnswers.ts";
import { failureShow } from "../../src/ui/failureNotice.ts";
import * as errors from "../../src/ui/text/errors.ts";
import { textsOf } from "../helpers/cv2.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";
import { openTempStore } from "../helpers/tempStore.ts";
import { useExampleConfig } from "../helpers/exampleConfig.ts";

useExampleConfig();
// 권한 판정이 서버 설정(DJ 역할)을 읽는다
const store = openTempStore("control-answers-");
after(() => store.close());

const guild = fake<Guild>({ id: "g1", members: { me: { voice: { channel: { id: "vc1" } } } } });
const member = fake<GuildMember>({ id: "u1", guild, permissions: { has: () => true }, voice: { channel: { id: "vc1" } }, roles: { cache: new Map() }, toString: () => "<@u1>" });

type Payload = { components: Array<{ toJSON(): unknown }>; flags: unknown };

function asked() {
  const log: Array<[string, string[], unknown]> = [];
  const it = {
    member,
    reply: async (p: Payload) => log.push(["reply", textsOf(p), p.flags]),
    editReply: async (p: Payload) => log.push(["editReply", textsOf(p), p.flags]),
  };
  return { it: fake<Parameters<typeof answerReplay>[0]>(it), log };
}

function player(over: object = {}) {
  const seeks: string[] = [];
  const p = fakePlayer({
    guild,
    currentTrack: { title: "곡", pageUrl: "https://u.test", duration: 300, thumbnail: null },
    isLive: false,
    isPlayStarting: false,
    seek: async (ms: number, reason: string) => seeks.push(`${ms}:${reason}`),
    ...over,
  });
  return { p, seeks };
}

const CV2 = [MessageFlags.IsComponentsV2];
const MINE = [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral];

test("처음부터: 하는 중을 본인에게만 먼저 보내고, 처음으로 옮긴 뒤 결과로 고친다", async () => {
  const { it, log } = asked();
  const { p, seeks } = player();
  await answerReplay(it, p);
  assert.deepEqual(seeks, ["0:replay"]);
  assert.deepEqual(log, [
    ["reply", ["🔄 처음부터 다시 트는 중..."], MINE],
    ["editReply", ["### 🔄 처음부터 다시 재생\n**[곡](https://u.test)**", "-# 👤 요청한 사람 <@u1>"], CV2],
  ]);
});

test("위치 이동: 하는 중을 먼저, 옮긴 위치를 작은 글씨로. 곡 길이를 넘으면 받아들이지 않고 안내", async () => {
  const { it, log } = asked();
  const { p, seeks } = player();
  await answerSeek(it, p, 90_000);
  assert.deepEqual(seeks, ["90000:seek"]);
  assert.deepEqual(log, [
    ["reply", ["⏩ 위치를 옮기는 중..."], MINE],
    ["editReply", ["### ⏩ 시간 이동\n**[곡](https://u.test)**", "-# ⏱️ 이동한 위치 `1:30`"], CV2],
  ]);

  const beyond = asked();
  await answerSeek(beyond.it, p, 400_000);
  assert.deepEqual(beyond.log, [["reply", ["### ✏️ 입력한 시간이 곡 길이를 초과합니다. (최대: 5:00)"], MINE]]);
  assert.equal(failureShow(beyond.it), null, "받아들이지 않았으면 자리를 바꿀 안내도 없다");
});

test("받아들인 뒤에 던지면 하는 중 자리를 안내로 바꾼다", async () => {
  const { it, log } = asked();
  const { p } = player({
    seek: async () => {
      throw new Error("boom");
    },
  });
  await assert.rejects(answerReplay(it, p));
  const show = failureShow(it);
  assert.ok(show);
  await show(errors.processingFailed());
  assert.deepEqual(log.at(-1), ["editReply", ["### ❌ 처리 중 오류가 발생했습니다!"], CV2]);
});
