// src/player/session-restore.ts: 기동 시 저장 세션의 길드 확보와 복원.
//
// 지키는 것 1: 길드 조회가 계속 실패해도 정해진 횟수 뒤 끝낸다(실패를 삼키면 1초 간격 무한 루프로 기동이 멈춘다).
// 지키는 것 2: 일시적 조회 실패에는 저장 세션을 지우지 않는다.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { codedError } from "../../src/rules/error-kind.ts";
import sink from "../../src/infra/log/sink.ts";
import { RESTJSONErrorCodes } from "discord.js";
import { resolveGuildForRestore, restoreSessions, restoreGuild, waitForRestore } from "../../src/player/session-restore.ts";
import { beginShutdown, _resetShutdown } from "../../src/infra/shutdown-state.ts";
import { useLaneSizes } from "../../src/sources/ytdlp-spawn.ts";
import { sessions } from "../../src/store/player-sessions.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import type { Client, Guild } from "discord.js";
import type { Player } from "../../src/player/player.ts";
import { fake } from "../helpers/fake.ts";

// 재시도 대기는 0으로 둔다. 검증 대상은 시도 횟수지 대기 시간이 아니다
const NOW = { attempts: 3, delayMs: 0 };

function makeClient(fetchImpl: (n: number) => unknown, cache = new Map<string, unknown>()) {
  const calls: string[] = [];
  const client = fake<Client>({
    guilds: {
      cache,
      fetch: async (id: string) => {
        calls.push(id);
        return fetchImpl(calls.length);
      },
    },
  });
  return Object.assign(client, { calls });
}

function apiError(code: number) {
  return Object.assign(new Error(`api ${code}`), { code });
}

test("fetch가 계속 실패해도 정확히 N회 뒤 종료한다", { timeout: 3000 }, async () => {
  const client = makeClient(() => {
    throw new Error("ECONNRESET");
  });

  const res = await resolveGuildForRestore(client, "g1", NOW);

  assert.equal(client.calls.length, 3, "시도 횟수가 반복마다 반드시 증가해야 한다");
  assert.equal(res.guild, null);
  assert.equal(res.gone, false, "일시적 실패는 '길드 없음'이 아니다");
});

test("fetch가 null을 돌려줘도 무한히 돌지 않는다", { timeout: 3000 }, async () => {
  const client = makeClient(() => null);
  const res = await resolveGuildForRestore(client, "g1", NOW);

  assert.equal(client.calls.length, 3);
  assert.equal(res.guild, null);
  assert.equal(res.gone, false);
});

test("길드가 실제로 사라졌을 때만 gone. 재시도 없이 즉시", async () => {
  for (const code of [RESTJSONErrorCodes.UnknownGuild, RESTJSONErrorCodes.MissingAccess]) {
    const client = makeClient(() => {
      throw apiError(code);
    });

    const res = await resolveGuildForRestore(client, "g1", NOW);
    assert.equal(res.gone, true, `code ${code}`);
    assert.equal(client.calls.length, 1, "확답을 받았으면 더 두드릴 이유가 없다");
  }
});

test("네트워크, 레이트리밋 실패는 세션을 삭제하지 않는다", async () => {
  for (const err of [new Error("getaddrinfo ENOTFOUND"), Object.assign(new Error("429 Too Many Requests"), { status: 429 }), Object.assign(new Error("500 Internal Server Error"), { status: 500 })]) {
    const client = makeClient(() => {
      throw err;
    });
    assert.equal((await resolveGuildForRestore(client, "g1", NOW)).gone, false, err.message);
  }
});

test("재시도 중 성공하면 그 길드를 돌려준다", async () => {
  const guild = { id: "g1", name: "복구됨" };
  const client = makeClient((n: number) => {
    if (n < 3) throw new Error("일시적");
    return guild;
  });

  const res = await resolveGuildForRestore(client, "g1", NOW);
  assert.equal(res.guild, guild);
  assert.equal(client.calls.length, 3);
});

test("캐시에 있으면 REST를 부르지 않는다", async () => {
  const guild = { id: "g1" };
  const client = makeClient(
    () => {
      throw new Error("불려서는 안 된다");
    },
    new Map([["g1", guild]]),
  );

  const res = await resolveGuildForRestore(client, "g1", NOW);
  assert.equal(res.guild, guild);
  assert.equal(client.calls.length, 0);
});

// ── 기동 시 저장 세션 모두 복원 ───────────────────────────────────────────

const store = openTempStore("session-restore-");
after(() => store.close());

// 기동 복원은 yt-dlp 곡 찾기 줄의 슬롯 수보다 하나 적게 동시에 돈다. 돌리는 컴퓨터의 메모리와 상관없이 2곳씩 돌게 슬롯을 3개로 고정한다
useLaneSizes({ lookup: 3, background: 2 });
after(() => useLaneSizes(null));

const channel = (id: string, kind: "voice" | "text") => ({ id, isVoiceBased: () => kind === "voice", isTextBased: () => kind === "text" });

function saved(guildId: string, { voice = "vc1", text = "tc1", autoResume = true }: { voice?: string | null; text?: string; autoResume?: boolean } = {}) {
  sessions().saveSession(guildId, { voiceChannelId: voice, textChannelId: text, autoResume });
}

function guildWith(id: string, chans = [channel("vc1", "voice"), channel("tc1", "text")]) {
  const cache = new Map(chans.map((c) => [c.id, c]));
  return fake<Guild>({ id, name: `서버 ${id}`, channels: { cache, fetch: async () => null } });
}

// 플레이어 대신. 무엇으로 만들었고 무엇을 불렀는지 남긴다
// gate: 서버마다 복원을 붙잡아 둔다(동시에 몇 곳이 도는지 보려고)
function fakePlayerClass({ restoreFails = false as boolean | Error, gate = null as ((guildId: string) => Promise<void>) | null } = {}) {
  const made: FakePlayer[] = [];
  class FakePlayer {
    guild: Guild;
    text: { id: string };
    voice: { id: string };
    calls: string[] = [];

    constructor(guild: Guild, text: { id: string }, voice: { id: string }) {
      this.guild = guild;
      this.text = text;
      this.voice = voice;
      made.push(this);
    }
    persistence = {
      restoreSession: async (record: { guildId: string }) => {
        this.calls.push(`restore:${record.guildId}`);
        await gate?.(record.guildId);
        if (restoreFails) throw restoreFails === true ? new Error("복원 실패") : restoreFails;
      },
    };
    async dispose(o: { reason: string; session: string }) {
      this.calls.push(`dispose:${o.reason}:${o.session}`);
    }
  }
  // 플레이어를 만드는 곳에 넘긴다. 복원이 부르는 것(persistence.restoreSession, dispose)만 갖췄다
  return { FakePlayer: fake<PlayerClass>(FakePlayer), made };
}

type PlayerClass = Parameters<typeof restoreSessions>[2];

// 서버들을 아는 클라이언트와 빈 레지스트리
function clientWith(guilds: Guild[], fetch: (id: string) => Promise<unknown> = async () => null) {
  const players = new Map<string, Player>();
  return { client: fake<Client>({ guilds: { cache: new Map(guilds.map((g) => [g.id, g])), fetch } }), players };
}

const remaining = () =>
  sessions()
    .loadAll()
    .map((r) => r.guildId);

test("복원: 채널이 멀쩡하면 플레이어를 만들어 등록하고 저장 상태로 복원한다", async () => {
  saved("r1");
  const { client, players } = clientWith([guildWith("r1")]);
  const { FakePlayer, made } = fakePlayerClass();

  await restoreSessions(client, players, FakePlayer);

  assert.equal(made.length, 1);
  assert.equal(made[0].voice.id, "vc1");
  assert.equal(made[0].text.id, "tc1");
  assert.deepEqual(made[0].calls, ["restore:r1"]);
  assert.equal(players.get("r1"), made[0]);
  sessions().removeSession("r1");
});

test("기동 복원은 /join으로만 이어 듣게 남긴 세션(/leave, 혼자 남아 나감)에 붙지 않고 세션을 남긴다. 서버 하나 다시 시작은 복원한다", async () => {
  saved("j1", { autoResume: false });
  saved("j2");
  const { client, players } = clientWith([guildWith("j1"), guildWith("j2")]);
  const { FakePlayer, made } = fakePlayerClass();
  const from = sink.buffer.length;

  const touched = await restoreSessions(client, players, FakePlayer);

  assert.deepEqual(
    made.map((p) => p.guild.id),
    ["j2"],
  );
  assert.deepEqual(touched, ["j2"], '손대지 않은 서버는 이어받기가 "세션은 남기고 나가기"로 받는다');
  assert.ok(remaining().includes("j1"), "세션은 남는다(/join이 이어 튼다)");
  assert.ok(sink.buffer.slice(from).some((e) => e.text.includes("/join으로만 이어 듣는 세션 1개")));

  await restoreGuild(client, players, FakePlayer, "j1");
  assert.deepEqual(
    made.map((p) => p.guild.id),
    ["j2", "j1"],
  );
  sessions().removeSession("j1");
  sessions().removeSession("j2");
});

test("복원하지 않기(짧게 끊긴 실행이 이어짐): 플레이어를 만들지 않고 세션은 남긴다", async () => {
  saved("r9");
  const { client, players } = clientWith([guildWith("r9")]);
  const { FakePlayer, made } = fakePlayerClass();

  assert.deepEqual(await restoreSessions(client, players, FakePlayer, { skip: true }), [], "손댄 서버가 없다(음성에 남은 봇은 이어받기가 뺀다)");

  assert.equal(made.length, 0);
  assert.deepEqual(remaining(), ["r9"]);
  sessions().removeSession("r9");
});

test("복원: 저장 상태를 복원하지 못하면(음성 연결 실패 등) 플레이어는 버리되 세션은 남긴다. 다음 기동, /join이 다시 해 본다", async () => {
  saved("r2");
  const { client, players } = clientWith([guildWith("r2")]);
  const { FakePlayer, made } = fakePlayerClass({ restoreFails: true });

  await restoreSessions(client, players, FakePlayer);

  assert.deepEqual(made[0].calls, ["restore:r2", "dispose:세션 복원 실패:keep"]);
  assert.deepEqual(remaining(), ["r2"]);
  sessions().removeSession("r2");
});

test("복원: 텍스트 채널 기록이 없는 세션(전용 채널 없이 대시보드로 시작)도 복원한다. 텍스트 채널 없이", async () => {
  sessions().saveSession("r6", { voiceChannelId: "vc1", textChannelId: null });
  const { client, players } = clientWith([guildWith("r6")]);
  const { FakePlayer, made } = fakePlayerClass();

  await restoreSessions(client, players, FakePlayer);

  assert.deepEqual(
    made.map((p) => [p.voice.id, p.text, p.calls]),
    [["vc1", null, ["restore:r6"]]],
  );
  sessions().removeSession("r6");
});

test("복원: 채널을 잠깐 못 불러왔으면(네트워크, 5xx) 세션을 남기고, 없다는 확답(10003, 50001)이면 지운다", async () => {
  const failing = (code: unknown) => fake<Guild>({ id: `c${String(code)}`, name: "서버", channels: { cache: new Map(), fetch: async () => Promise.reject(Object.assign(new Error("조회 실패"), { code })) } });
  const guilds = [failing("ECONNRESET"), failing(500), failing(RESTJSONErrorCodes.UnknownChannel), failing(RESTJSONErrorCodes.MissingAccess)];
  for (const g of guilds) saved(g.id);
  const { client, players } = clientWith(guilds);
  const { FakePlayer, made } = fakePlayerClass();

  await restoreSessions(client, players, FakePlayer);

  assert.equal(made.length, 0);
  assert.deepEqual(remaining().sort(), ["c500", "cECONNRESET"]);
  for (const id of remaining()) sessions().removeSession(id);
});

test("복원: 음성 채널 기록이 없거나 음성 채널이 아니면 세션을 삭제한다", async () => {
  saved("r3", { voice: null });
  saved("r4", { voice: "tc1", text: "vc1" }); // 서로 바뀐 종류
  const { client, players } = clientWith([guildWith("r3"), guildWith("r4")]);
  const { FakePlayer, made } = fakePlayerClass();

  await restoreSessions(client, players, FakePlayer);

  assert.equal(made.length, 0);
  assert.deepEqual(remaining(), []);
});

test("복원: 서버가 사라졌으면 세션을 삭제하고, 잠깐 못 불러온 것이면 남긴다", async () => {
  saved("gone1");
  saved("flaky1");
  const { client, players } = clientWith([], async (id) => {
    if (id === "gone1") throw Object.assign(new Error("Unknown Guild"), { code: RESTJSONErrorCodes.UnknownGuild });
    throw new Error("네트워크");
  });
  const { FakePlayer, made } = fakePlayerClass();

  await restoreSessions(client, players, FakePlayer);

  assert.equal(made.length, 0);
  assert.deepEqual(remaining(), ["flaky1"]);
  sessions().removeSession("flaky1");
});

test("복원: 저장 세션이 없으면 아무것도 안 한다", async () => {
  const { client, players } = clientWith([]);
  const { FakePlayer, made } = fakePlayerClass();
  await restoreSessions(client, players, FakePlayer);
  assert.equal(made.length, 0);
});

test("복원: 기다리는 사이 그 서버에서 재생이 시작됐으면 건드리지 않는다", async () => {
  saved("r5");
  const { client, players } = clientWith([guildWith("r5")]);
  const live = fake<Player>({ live: true });
  players.set("r5", live);
  const { FakePlayer, made } = fakePlayerClass();

  await restoreSessions(client, players, FakePlayer);

  assert.equal(made.length, 0);
  assert.equal(players.get("r5"), live, "지금 도는 플레이어를 교체하지 않는다");
  assert.deepEqual(remaining(), ["r5"], "세션 기록도 그 플레이어의 것이다");
  sessions().removeSession("r5");
});

test("기동 복원을 기다리는 서버에 곡 추가 등이 오면 그 서버를 먼저 복원한다. 기동 복원은 같은 서버를 다시 복원하지 않는다", async (t) => {
  const ids = ["w1", "w2", "w3"];
  for (const id of ids) saved(id);
  const { client, players } = clientWith(ids.map((id) => guildWith(id)));
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  // 실패해도 붙잡아 둔 복원을 풀고 세션을 지운다(남으면 다음 테스트의 기동 복원이 끝나지 않는 이 복원을 기다린다)
  t.after(() => {
    release();
    for (const id of ids) sessions().removeSession(id);
  });
  const { FakePlayer, made } = fakePlayerClass({ gate: async (id) => (id === "w3" ? undefined : held) });

  const boot = restoreSessions(client, players, FakePlayer);
  await waitForRestore("w3"); // w1, w2의 복원이 붙잡혀 있는 동안 w3에 곡을 넣었다
  assert.ok(players.has("w3"), "waitForRestore가 끝나면 w3가 복원돼 있다(곡을 넣을 플레이어가 있다)");
  release();
  await boot;

  assert.deepEqual(made.flatMap((p) => p.calls).sort(), ["restore:w1", "restore:w2", "restore:w3"], "서버마다 한 번씩");
  await waitForRestore("w3"); // 끝난 서버는 아무것도 안 한다
  assert.equal(made.length, 3);
});

test("기동 복원은 서버마다 복원 직전에 세션을 다시 읽는다. 그사이 지워진 세션은 되살리지 않는다", async (t) => {
  const ids = ["x1", "x2", "x3"];
  for (const id of ids) saved(id);
  t.after(() => {
    for (const id of ids) sessions().removeSession(id);
  });
  const { client, players } = clientWith(ids.map((id) => guildWith(id)));
  const { FakePlayer, made } = fakePlayerClass();

  const boot = restoreSessions(client, players, FakePlayer);
  sessions().removeSession("x3"); // x1, x2를 복원하는 동안 x3의 세션이 지워졌다(새로 틀기 등)
  await boot;

  assert.deepEqual(
    made.map((p) => p.calls),
    [["restore:x1"], ["restore:x2"]],
  );
});

test("기동 복원은 yt-dlp 곡 찾기 줄의 슬롯 수보다 하나 적게 동시에 돈다. 슬롯이 둘이면 한 곳씩, 넉넉해도 세 곳까지만 돌고 CPU 수를 넘지 않는다", async (t) => {
  const ids = ["p1", "p2", "p3", "p4", "p5"];
  const { client, players } = clientWith(ids.map((id) => guildWith(id)));
  t.after(() => {
    useLaneSizes({ lookup: 3, background: 2 });
    for (const id of ids) sessions().removeSession(id);
  });
  let running = 0;
  let most = 0;
  const { FakePlayer, made } = fakePlayerClass({
    gate: async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setImmediate(resolve));
      running--;
    },
  });
  const boot = async (cpus = 8) => {
    for (const id of ids) saved(id);
    most = 0;
    players.clear();
    await restoreSessions(client, players, FakePlayer, { cpus });
    return most;
  };

  assert.equal(await boot(), 2, "슬롯 3개: 2곳씩");
  assert.equal(made.length, 5);
  useLaneSizes({ lookup: 2, background: 2 });
  assert.equal(await boot(), 1, "슬롯 2개: 한 곳씩(남은 슬롯 하나는 그사이 다른 서버의 곡 찾기가 쓴다)");
  assert.equal(made.length, 10);
  useLaneSizes({ lookup: 8, background: 4 });
  assert.equal(await boot(), 3, "슬롯 8개: 3곳까지");
  assert.equal(await boot(2), 2, "슬롯 8개, CPU 2개: 2곳씩");
  assert.equal(await boot(1), 1, "슬롯 8개, CPU 1개: 한 곳씩");
});

test("종료 중이면 기동 복원이 플레이어를 만들지 않는다(세션은 남겨 다음 기동 때 복원한다)", async (t) => {
  t.after(() => _resetShutdown());
  saved("r7");
  const { client, players } = clientWith([guildWith("r7")]);
  const { FakePlayer, made } = fakePlayerClass();
  beginShutdown();
  await restoreSessions(client, players, FakePlayer);
  assert.equal(made.length, 0);
  assert.deepEqual(remaining(), ["r7"]);
  sessions().removeSession("r7");
});

test("서버를 조회하는 사이 종료가 시작되면 플레이어를 만들지 않는다(세션은 남긴다)", async (t) => {
  t.after(() => _resetShutdown());
  saved("r8");
  const { client, players } = clientWith([], async (id) => {
    beginShutdown();
    return guildWith(id);
  });
  const { FakePlayer, made } = fakePlayerClass();
  await restoreSessions(client, players, FakePlayer);
  assert.equal(made.length, 0);
  assert.deepEqual(remaining(), ["r8"]);
  sessions().removeSession("r8");
});

test("복원 중 종료 때문에 붙지 못하면 오류 로그 없이 세션을 남기고 플레이어를 정리한다", async () => {
  saved("r9");
  const { client, players } = clientWith([guildWith("r9")]);
  const { FakePlayer, made } = fakePlayerClass({ restoreFails: codedError("bot-shutting-down", "종료 중") });
  const start = sink.buffer.at(-1)?.id ?? -1;
  await restoreSessions(client, players, FakePlayer);
  assert.deepEqual(made[0].calls, ["restore:r9", "dispose:세션 복원 실패:keep"]);
  assert.deepEqual(remaining(), ["r9"]);
  assert.deepEqual(
    sink.buffer.filter((r) => r.id > start && r.level === "error").map((r) => r.text),
    [],
  );
  sessions().removeSession("r9");
});
