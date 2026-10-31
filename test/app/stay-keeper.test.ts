// src/app/stay-keeper.ts: 24/7 자리 지킴이. 붙어 있지 않은 자리에 다시 붙고, 끝의 종류로 자리를 끄거나 느리게 다시 해 본다

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, PermissionFlagsBits, RESTJSONErrorCodes, type Client, type Guild } from "discord.js";
import { createStayKeeper, BACKOFF_MS } from "../../src/app/stay-keeper.ts";
import * as staySeats from "../../src/store/stay-seats.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { fake } from "../helpers/fake.ts";
import type { PlayerSeats } from "../../src/player/registry.ts";
import type { JoinResult } from "../../src/usecases/join.ts";

const store = openTempStore("stay-keeper-");
after(() => store.close());
afterEach(() => {
  for (const [guildId] of staySeats.all()) staySeats.clear(guildId);
});

// 서버 하나. channels.fetch 의 답과 봇의 채널 권한을 준다
function guildOf(id: string, { fetched = "voice" as "voice" | "gone" | "denied" | "fails" | "stage", allowed = true } = {}) {
  const channel = { id: "vc1", name: "음성", type: fetched === "stage" ? ChannelType.GuildStageVoice : ChannelType.GuildVoice, isVoiceBased: () => true, isThread: () => false, permissionsFor: () => ({ has: (flag: bigint) => allowed && (flag === PermissionFlagsBits.Connect || flag === PermissionFlagsBits.Speak) }) };
  const fetch = async () => {
    if (fetched === "gone") throw Object.assign(new Error("Unknown Channel"), { code: RESTJSONErrorCodes.UnknownChannel });
    if (fetched === "denied") throw Object.assign(new Error("Missing Access"), { code: RESTJSONErrorCodes.MissingAccess });
    if (fetched === "fails") throw new Error("ECONNRESET");
    return channel;
  };
  return fake<Guild>({ id, name: `서버 ${id}`, available: true, channels: { fetch }, members: { me: {} } });
}

// 지킴이와 그가 부른 것. joined: 붙기의 결과
function world(guilds: Guild[], { joined = "joined" as JoinResult["kind"] | "refused-permission" } = {}) {
  const calls: string[] = [];
  const alive = new Set<string>();
  const reconsidered: string[] = [];
  const players = fake<Pick<PlayerSeats, "get" | "set">>({ get: (id: string) => (alive.has(id) ? { voice: { isAlive: () => true } } : undefined), set: () => {} });
  const client = fake<Client>({ guilds: { cache: new Map(guilds.map((g) => [g.id, g])) } });
  const join = async (_bot: unknown, { guild }: { guild: Guild }): Promise<JoinResult> => {
    calls.push(`join:${guild.id}`);
    if (joined === "refused-permission") return { kind: "refused", code: "permission-voice" };
    if (joined === "refused") return { kind: "refused", code: "voice-failed" };
    return { kind: "joined", player: fake({ idle: { reconsider: () => void reconsidered.push(guild.id) } }) } as JoinResult;
  };
  const announce = async (guild: Guild, notice: { title: string }) => void calls.push(`notice:${guild.id}:${notice.title}`);
  const keeper = createStayKeeper({ client, players, join, announce, sleep: async (ms) => void calls.push(`sleep:${ms}`) });
  return { keeper, calls, alive, reconsidered };
}

test("기동: 자리가 있고 붙어 있지 않은 서버만 하나씩, 사이 1초. 붙으면 퇴장 판정을 다시 맞춘다. 비정상 종료가 되풀이된 기동은 붙지 않는다", async (t) => {
  staySeats.set("g1", "vc1");
  staySeats.set("g2", "vc1");
  staySeats.set("g3", "vc1");
  const w = world([guildOf("g1"), guildOf("g2"), guildOf("g3")]);
  t.after(() => w.keeper.stop());
  w.alive.add("g2");
  await w.keeper.boot();
  assert.deepEqual(w.calls, ["join:g1", "sleep:1000", "join:g3"]);
  assert.deepEqual(w.reconsidered, ["g1", "g3"]);

  const skipped = world([guildOf("g1")]);
  await skipped.keeper.boot({ skip: true });
  assert.deepEqual(skipped.calls, []);
  assert.ok(staySeats.seatOf("g1"), "자리는 남긴다");
});

test("끝난 실패(디스코드의 확답)는 자리를 끄고 알린다: 채널 없음 · 접근 없음 · 연결 · 말하기 권한 없음 · 붙기가 권한으로 거절됨", async () => {
  const cases = [
    [guildOf("g1", { fetched: "gone" }), "머물던 음성 채널이 삭제돼서 상주 모드를 껐어요."],
    [guildOf("g1", { fetched: "denied" }), "<#vc1>에 들어갈 권한이 없어서 상주 모드를 껐어요."],
    [guildOf("g1", { allowed: false }), "<#vc1>에 들어갈 권한이 없어서 상주 모드를 껐어요."],
  ] as const;
  for (const [guild, title] of cases) {
    staySeats.set("g1", "vc1");
    const w = world([guild]);
    assert.equal(await w.keeper.attempt("g1"), true);
    assert.equal(staySeats.seatOf("g1"), null);
    assert.deepEqual(w.calls, [`notice:g1:${title}`]);
  }
  staySeats.set("g1", "vc1");
  const refused = world([guildOf("g1")], { joined: "refused-permission" });
  await refused.keeper.attempt("g1");
  assert.equal(staySeats.seatOf("g1"), null);
});

test("일시적 실패는 자리를 남기고 1 · 2 · 5 · 10 · 30분(이후 30분마다) 뒤 다시", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  staySeats.set("g1", "vc1");
  const guild = guildOf("g1", { fetched: "fails" });
  let asked = 0;
  const failing = guild.channels.fetch.bind(guild.channels);
  Object.assign(guild.channels, { fetch: (...args: Parameters<typeof failing>) => (asked++, failing(...args)) });
  const w = world([guild]);
  t.after(() => w.keeper.stop());
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  assert.equal(await w.keeper.attempt("g1"), false);
  for (const [i, ms] of [...BACKOFF_MS, BACKOFF_MS.at(-1)!].entries()) {
    t.mock.timers.tick(ms - 1);
    await flush();
    assert.equal(asked, i + 1, `${i + 1}번째 기다림이 끝나기 전`);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(asked, i + 2, `${ms}ms 뒤 다시`);
  }
  assert.ok(staySeats.seatOf("g1"), "자리는 남는다");
});

test("끝의 종류: 자리에서 내보내지면 끄고 알린다. 자리가 아닌 채널에서 끝났거나 복구를 포기했으면 다시, 되풀이 오류는 쉰다, 사람이 끝낸 것은 그대로", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g1 = guildOf("g1");
  const w = world([g1]);
  t.after(() => w.keeper.stop());
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const seatHere = { guild: g1, voiceChannel: { id: "vc1" } } as never;
  const elsewhere = { guild: g1, voiceChannel: { id: "vc9" } } as never;

  staySeats.set("g1", "vc1");
  w.keeper.onDisposed(seatHere, "forced-disconnect");
  await flush();
  assert.equal(staySeats.seatOf("g1"), null);
  assert.deepEqual(w.calls, ["notice:g1:누가 저를 내보내서 상주 모드를 껐어요."]);

  w.calls.length = 0;
  staySeats.set("g1", "vc1");
  w.keeper.onDisposed(elsewhere, "forced-disconnect");
  w.keeper.onDisposed(seatHere, "stop");
  t.mock.timers.tick(BACKOFF_MS[0]);
  await flush();
  assert.deepEqual(w.calls, ["join:g1"], "자리가 아닌 채널에서 내보내지면 자리로 돌아간다");

  w.calls.length = 0;
  w.keeper.onDisposed(seatHere, "fault");
  w.keeper.onDisposed(seatHere, "voice-lost");
  t.mock.timers.tick(BACKOFF_MS[0]);
  await flush();
  assert.deepEqual(w.calls, [], "되풀이 오류로 멈춘 서버는 재접속을 건너뛴다");
  w.keeper.wake("g1");
  assert.equal(await w.keeper.attempt("g1"), true);
  assert.deepEqual(w.calls, ["join:g1"], "사람이 다시 틀면 푼다");
});

test("자리 채널이 지워지면(봇이 없던 동안도) 끄고 한 번만 알린다", async () => {
  staySeats.set("g1", "vc1");
  const g1 = guildOf("g1");
  const w = world([g1]);
  w.keeper.onChannelDeleted(g1, "other");
  w.keeper.onChannelDeleted(g1, "vc1");
  w.keeper.onChannelDeleted(g1, "vc1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(staySeats.seatOf("g1"), null);
  assert.deepEqual(w.calls, ["notice:g1:머물던 음성 채널이 삭제돼서 상주 모드를 껐어요."]);
});
