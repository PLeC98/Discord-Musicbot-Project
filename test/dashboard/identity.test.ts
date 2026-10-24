// src/dashboard/routes/identity.ts — 지금 로그인한 사람(/api/me)과 로그인 전 화면이 쓰는 봇 정보(/api/bot)

process.env.OWNER_ID = "owner";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fakeBot } from "../helpers/fake.ts";
import { signedInAs } from "../helpers/dashboard.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";

const { identityRouter } = await import("../../src/dashboard/routes/identity.ts");
const config = (await import("../../src/config/index.ts")).default;
const { faviconVersion } = await import("../../src/dashboard/appearance.ts");

let user: object | null = null;
let botUser: object | null = null;
const app = express();
app.use(signedInAs(() => user));
app.locals.bot = fakeBot({
  client: {
    get user() {
      return botUser;
    },
  },
});
app.use("/api", identityRouter);
const server = await listenForFetch(app);
after(() => server.close());
const get = async (urlPath: string) => {
  const res = await fetch(baseUrl(server) + urlPath, { signal: AbortSignal.timeout(3000) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

test("/api/me: 로그인 전에는 401, 로그인했으면 그 사람과 운영자인지", async () => {
  user = null;
  const out = await get("/api/me");
  assert.deepEqual([out.status, out.json.code], [401, "login-required"]);

  user = { id: "u1", username: "사용자" };
  const me = await get("/api/me");
  assert.equal(me.status, 200);
  assert.deepEqual([me.json.id, me.json.isOwner, me.json.isRealOwner], ["u1", false, false]);

  user = { id: "owner", username: "운영자" };
  const owner = await get("/api/me");
  assert.deepEqual([owner.json.isOwner, owner.json.isRealOwner], [true, true]);
  assert.equal(owner.json.avatarUrl, null, "프로필 그림이 없으면 null");

  user = { id: "u2", username: "그림", avatar: "abc" };
  const drawn = await get("/api/me");
  assert.equal(drawn.json.avatarUrl, "https://cdn.discordapp.com/avatars/u2/abc.webp?size=64", "그림 주소는 서버가 만든다");

  user = { id: "u3", username: "움직임", avatar: "a_abc" };
  const animated = await get("/api/me");
  assert.equal(animated.json.avatarUrl, "https://cdn.discordapp.com/avatars/u3/a_abc.gif?size=64", "움직이는 그림은 gif 그대로");
});

test("/api/bot: 소스 저장소는 늘(AGPL 고지), 이름 · 그림은 봇이 준비되면", async () => {
  botUser = null;
  const early = await get("/api/bot");
  assert.equal(early.status, 200);
  assert.deepEqual(early.json, { name: null, avatarUrl: null, sourceRepo: config.bot.sourceRepo, projectRepo: config.bot.projectRepo, brandColor: config.bot.embedColor, faviconVersion: faviconVersion() }, "준비 전에도 소스 링크 · 임베드 색 · 파비콘 버전이 있다");

  let asked: object | null = null;
  botUser = {
    username: "봇",
    avatarURL: (options: object) => {
      asked = options;
      return "https://cdn/avatar.webp";
    },
  };
  const ready = await get("/api/bot");
  assert.equal(ready.status, 200);
  assert.deepEqual(ready.json, { name: "봇", avatarUrl: "https://cdn/avatar.webp", sourceRepo: config.bot.sourceRepo, projectRepo: config.bot.projectRepo, brandColor: config.bot.embedColor, faviconVersion: faviconVersion() });
  assert.deepEqual(asked, { size: 1024, extension: "webp" }, "로그인 화면 배경으로도 쓰는 큰 그림");
});

test("/api/me: 세션 사용자에 무엇이 더 붙어도 Me 의 필드만 보낸다", async () => {
  user = { id: "u1", username: "사용자", globalName: "사용자", avatar: null, guilds: [{ id: "g1" }], token: "새면 안 되는 값" };
  const me = await get("/api/me");
  assert.deepEqual(Object.keys(me.json).sort(), ["avatar", "avatarUrl", "canInvite", "globalName", "id", "isOwner", "isRealOwner", "username", "viewAs"]);
});

test("/api/me: canInvite 는 공개 봇이면 누구나, 아니면 앱 소유자 · 팀원만. code grant 를 요구하거나 앱 정보를 모르면 아무도", async () => {
  const { _setAppInfo } = await import("../../src/dashboard/invite.ts");
  const canInvite = async (id: string) => {
    user = { id, username: id };
    return (await get("/api/me")).json.canInvite;
  };
  try {
    _setAppInfo(null);
    assert.equal(await canInvite("u1"), false, "앱 정보를 아직 못 받았다");
    _setAppInfo({ botPublic: true, requireCodeGrant: false, ownerIds: [] });
    assert.equal(await canInvite("u1"), true);
    _setAppInfo({ botPublic: false, requireCodeGrant: false, ownerIds: ["u9", "u8"] });
    assert.deepEqual([await canInvite("u1"), await canInvite("u9"), await canInvite("u8")], [false, true, true], "앱 소유자 · 팀원");
    _setAppInfo({ botPublic: true, requireCodeGrant: true, ownerIds: ["u9"] });
    assert.deepEqual([await canInvite("u1"), await canInvite("u9")], [false, false], "초대 링크만으로는 봇이 들어오지 않는다");
  } finally {
    _setAppInfo(null);
  }
});
