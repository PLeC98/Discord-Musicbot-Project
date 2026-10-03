// src/discord/interactions/control-answers.ts — 음량은 명령과 입력 창이 한 절차. 시간이 걸리는 조작(처음부터 · 위치 이동)은 받아들이면 "하는 중" 을 Components V2 로 먼저 보내고 결과로 고친다.
// 거절은 본인에게만 안내. 받아들인 뒤에 던지면 그 자리를 안내로 바꾼다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags, type Guild, type GuildMember } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { answerReplay, answerSeek, answerStop, answerVolume } from "../../src/discord/interactions/control-answers.ts";
import { LIFETIME, lifetimesOf } from "../../src/ui/delivery.ts";
import { command, run } from "../helpers/commands.ts";
import { failureShow } from "../../src/ui/failure-notice.ts";
import * as errors from "../../src/ui/text/ko/errors.ts";
import { textsOf } from "../helpers/cv2.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { useExampleConfig } from "../helpers/example-config.ts";
import { interactionKind } from "../helpers/interaction-kind.ts";

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
    ...interactionKind("command"),
    member,
    replied: false,
    reply: async (p: Payload) => {
      log.push(["reply", textsOf(p), p.flags]);
      it.replied = true;
      return { resource: { message: { id: "r1" } } };
    },
    editReply: async (p: Payload) => log.push(["editReply", textsOf(p), p.flags]),
    deleteReply: async () => log.push(["deleteReply", [], null]),
    channel: { send: async (p: Payload) => (log.push(["send", textsOf(p), p.flags]), { id: "c1", delete: async () => {} }) },
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

test("처음부터: 하는 중을 본인에게만 먼저 보내고, 처음으로 옮긴 뒤 그 자리를 지우고 결과는 모두에게 새로", async () => {
  const { it, log } = asked();
  const { p, seeks } = player();
  await answerReplay(it, p);
  assert.deepEqual(seeks, ["0:replay"]);
  assert.deepEqual(log, [
    ["reply", ["🔄 처음부터 다시 트는 중..."], MINE],
    ["deleteReply", [], null],
    ["send", ["### 🔄 곡을 되감았어요!\n**[곡](https://u.test)**을 처음부터 재생할게요.", "-# 👤 요청한 사람 <@u1>"], CV2],
  ]);
  assert.deepEqual(lifetimesOf(it), [LIFETIME.result]);
});

test("위치 이동: 하는 중을 먼저, 옮긴 위치를 작은 글씨로. 곡 길이를 넘으면 받아들이지 않고 안내", async () => {
  const { it, log } = asked();
  const { p, seeks } = player();
  await answerSeek(it, p, 90_000);
  assert.deepEqual(seeks, ["90000:seek"]);
  assert.deepEqual(log, [
    ["reply", ["⏩ 위치를 옮기는 중..."], MINE],
    ["deleteReply", [], null],
    ["send", ["### ⏩ 위치를 옮겼어요!\n⏱️ 옮긴 위치: `1:30`"], CV2],
  ]);

  const beyond = asked();
  await answerSeek(beyond.it, p, 400_000);
  assert.deepEqual(beyond.log, [["reply", ["### ✏️ 곡이 그만큼 길지 않아요!\n곡 길이(5:00)보다 뒤로 이동할 수는 없어요."], MINE]]);
  assert.equal(failureShow(beyond.it), null, "받아들이지 않았으면 자리를 바꿀 안내도 없다");
  assert.deepEqual(lifetimesOf(beyond.it), [LIFETIME.warning], "거절은 경고 수명");
});

test("음량: 바꾼 결과를 모두에게. 명령과 패널의 입력 창이 이 하나를 부른다", async () => {
  const { it, log } = asked();
  const levels: number[] = [];
  const { p } = player({ volume: 80, setVolume: (v: number) => (levels.push(v), v) });
  await answerVolume(it, p, 35);
  assert.deepEqual(levels, [35]);
  assert.deepEqual(log, [["reply", ["### 🔊 볼륨을 조절했어요!\n**80%** → **35%**", "-# 👤 요청한 사람 <@u1>"], CV2]]);

  const root = path.join(import.meta.dirname, "..", "..");
  for (const file of ["src/discord/commands/volume.ts", "src/discord/interactions/modal-handler.ts"]) assert.match(fs.readFileSync(path.join(root, file), "utf8"), /answerVolume\(/, file);
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
  await show(errors.notice("processing-failed"));
  assert.deepEqual(log.at(-1), ["editReply", ["### ❌ 예상치 못한 오류예요!\n처리 중에 오류가 발생했어요. 오류가 반복되면 봇 운영자에게 알려주세요."], CV2]);
  assert.deepEqual(lifetimesOf(it), [LIFETIME.error], "오류로 바꾼 자리는 오류 수명");
});

test("수명: 조작 결과는 결과 수명, 정지 · 나가기는 더 오래", async () => {
  const volume = asked();
  await answerVolume(volume.it, player({ volume: 80, setVolume: (v: number) => v }).p, 35);
  assert.deepEqual(lifetimesOf(volume.it), [LIFETIME.result]);

  const stop = asked();
  await answerStop(stop.it, player({ queue: [], _trackLabel: () => "곡", dispose: async () => {} }).p);
  assert.deepEqual(lifetimesOf(stop.it), [LIFETIME.farewell]);

  const leave = asked();
  const { p } = player({ queue: [], getCurrentTime: () => 0, dispose: async () => {} });
  await run(await command("leave"), Object.assign(leave.it, { guild }), { players: new Map([["g1", p]]) });
  assert.deepEqual(lifetimesOf(leave.it), [LIFETIME.farewell]);
  assert.ok(LIFETIME.farewell > LIFETIME.result);
});
