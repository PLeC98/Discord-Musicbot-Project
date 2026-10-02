// interactions/controlAnswers.ts — 음량은 명령과 입력 창이 한 절차. 시간이 걸리는 조작(처음부터 · 위치 이동)은 받아들이면 "하는 중" 을 Components V2 로 먼저 보내고 결과로 고친다.
// 거절은 본인에게만 안내. 받아들인 뒤에 던지면 그 자리를 안내로 바꾼다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags, type Guild, type GuildMember } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { answerReplay, answerSeek, answerVolume } from "../../interactions/controlAnswers.ts";
import { failureShow } from "../../src/ui/failureNotice.ts";
import * as errors from "../../src/ui/text/ko/errors.ts";
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
    ["editReply", ["### 🔄 곡을 되감았어요!\n**[곡](https://u.test)**을 처음부터 재생할게요.", "-# 👤 요청한 사람 <@u1>"], CV2],
  ]);
});

test("위치 이동: 하는 중을 먼저, 옮긴 위치를 작은 글씨로. 곡 길이를 넘으면 받아들이지 않고 안내", async () => {
  const { it, log } = asked();
  const { p, seeks } = player();
  await answerSeek(it, p, 90_000);
  assert.deepEqual(seeks, ["90000:seek"]);
  assert.deepEqual(log, [
    ["reply", ["⏩ 위치를 옮기는 중..."], MINE],
    ["editReply", ["### ⏩ 위치를 옮겼어요!\n⏱️ 옮긴 위치: `1:30`"], CV2],
  ]);

  const beyond = asked();
  await answerSeek(beyond.it, p, 400_000);
  assert.deepEqual(beyond.log, [["reply", ["### ✏️ 곡이 그만큼 길지 않아요!\n곡 길이(5:00)보다 뒤로 이동할 수는 없어요."], MINE]]);
  assert.equal(failureShow(beyond.it), null, "받아들이지 않았으면 자리를 바꿀 안내도 없다");
});

test("음량: 바꾼 결과를 본인에게만. 명령과 패널의 입력 창이 이 하나를 부른다", async () => {
  const { it, log } = asked();
  const levels: number[] = [];
  const { p } = player({ volume: 80, setVolume: (v: number) => (levels.push(v), v) });
  await answerVolume(it, p, 35);
  assert.deepEqual(levels, [35]);
  assert.deepEqual(log, [["reply", ["### 🔊 볼륨을 조절했어요!\n**80%** → **35%**", "-# 👤 요청한 사람 <@u1>"], MINE]]);

  const root = path.join(import.meta.dirname, "..", "..");
  for (const file of ["commands/volume.ts", "interactions/modalHandler.ts"]) assert.match(fs.readFileSync(path.join(root, file), "utf8"), /answerVolume\(/, file);
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
  assert.deepEqual(log.at(-1), ["editReply", ["### ❌ 예상치 못한 오류예요!\n처리 중에 오류가 발생했어요. 오류가 반복되면 봇 운영자에게 알려주세요."], CV2]);
});
