// src/dashboard/routes/player.ts 의 봇 부르기 — 디스코드 /join 과 같은 판정과 일(usecases/join)을 HTTP 로 옮기는지.
// 진짜 Player 를 만들므로 재생 하네스(음성 · ffmpeg 가짜, 임시 DB)를 먼저 부른다. 결과마다의 일은 /join 시험(commands-add)이 본다.

import * as h from "../helpers/player-harness.ts";
const { behavior } = h; // 하네스의 가짜 설정
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import { PlayerRegistry } from "../../src/player/registry.ts";
import { sessions } from "../../src/store/player-sessions.ts";
import * as storeDb from "../../src/store/db.ts";
import * as tracks from "../helpers/tracks.ts";
import { fakeBot } from "../helpers/fake.ts";
import { signedInAs, requestJson, type ProblemReply } from "../helpers/dashboard.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";

const { createGuildsRouter } = await import("../../src/dashboard/routes/guilds.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");

type Reply = ProblemReply & { hasPlayer?: boolean; sameVoice?: boolean; canManage?: boolean };

const voice = (id: string) => ({ id, name: id, permissionsFor: () => ({ has: () => true }) });
let botVoice: string | null = null;
const member = { id: "u1", user: { id: "u1" }, displayName: "사용자", voice: { channel: voice("v1") }, permissions: { has: () => false }, roles: { cache: { has: () => false } } };
const guild = {
  id: "g1",
  name: "서버",
  members: {
    get me() {
      return { id: "bot", voice: { channel: botVoice ? voice(botVoice) : null } };
    },
    fetch: async () => member,
  },
  channels: { cache: new Map() },
  roles: { cache: new Map() },
  voiceStates: { cache: new Map([["u1", { channelId: "v1", channel: { id: "v1" } }]]) },
  voiceAdapterCreator: () => ({}),
};
Object.assign(member, { guild });
const client = { isReady: () => true, user: { id: "bot" }, guilds: { cache: new Map([["g1", guild]]), fetch: async () => null } };
Object.assign(guild, { client });
const players = new PlayerRegistry();
players.followDisposals();
const bot = fakeBot({ client, players, panels: { panelChannel: async () => null, updatePlaying: async () => {}, drawEndedPanel: async () => {}, postPlaying: async () => {}, deleteWebhookCache: () => {} } });

let server: Server;
let base: string;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use(signedInAs(() => ({ id: "u1", username: "사용자", guilds: [] })));
  app.locals.bot = bot;
  app.use("/api/guilds", createGuildsRouter({ stream: createPlayerStream() }));
  server = await listenForFetch(app);
  base = baseUrl(server);
});
after(() => server.close());

beforeEach(() => {
  h.reset();
  storeDb.get().exec("DELETE FROM guild_settings; DELETE FROM player_sessions;");
  botVoice = null;
  const left = players.get("g1");
  if (left) {
    h.dispose(left);
    players.delete("g1");
  }
});

const join = () => requestJson<Reply>(base, "POST", "/api/guilds/g1/player/join", undefined, { timeoutMs: 5000 });

test("부르면 /join 과 같이 붙고, 사람이 채널에 있어도 곡 없이 대기하다 나갈 예약을 건다", async () => {
  const r = await join();
  assert.equal(r.status, 200);
  assert.equal(r.json.hasPlayer, true);
  assert.equal(r.json.canManage, false, "설정 화면 진입 여부도 GET /player 와 같은 칸으로");
  const player = players.get("g1");
  assert.ok(player?.connection, "붙었다");
  assert.ok(player.idle.emptyTimer, "곡 없이 대기");
});

test("봇이 다른 음성 채널에 있으면 409 로 거절하고 플레이어를 만들지 않는다", async () => {
  botVoice = "v2";
  const r = await join();
  assert.deepEqual([r.status, r.json.code], [409, "bot-in-other-voice"]);
  assert.equal(players.has("g1"), false);
});

test("음성 채널에 붙지 못하면 502 이고 플레이어가 남지 않는다", async () => {
  behavior.connect = () => {
    throw new Error("붙지 못함");
  };
  try {
    const r = await join();
    assert.deepEqual([r.status, r.json.code], [502, "voice-failed"]);
  } finally {
    behavior.connect = null;
  }
  assert.equal(players.has("g1"), false);
});

test("저장한 세션이 있으면 되살린다. 되살리다 오류가 나면 500 이고 플레이어가 남지 않는다", async () => {
  const saveSession = () => {
    sessions().saveSession("g1", { voiceChannelId: "v1", textChannelId: "c1", volume: 100, loopMode: "off", autoplay: null, pausedManual: false, positionMs: 0, startOffsetMs: 0, requesterId: "u1" });
    sessions().setCurrent("g1", tracks.youtube("ccccccccccc", { title: "저장된 곡", addedAt: 1 }));
  };
  saveSession();
  behavior.restore = async function () {
    this.currentTrack = tracks.youtube("ccccccccccc", { title: "저장된 곡" });
  };
  try {
    const r = await join();
    assert.equal(r.status, 200);
    assert.equal(players.get("g1")?.currentTrack?.title, "저장된 곡");

    h.dispose(players.get("g1")!);
    players.delete("g1");
    saveSession();
    behavior.restore = async () => {
      throw new Error("복원 실패");
    };
    const failed = await join();
    assert.deepEqual([failed.status, failed.json.code], [500, "restore-failed"]);
    assert.equal(players.has("g1"), false);
  } finally {
    behavior.restore = null;
  }
});
