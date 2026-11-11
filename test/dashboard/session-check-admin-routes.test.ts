// src/dashboard/routes/admin.ts, app-emojis.ts, track-cache.ts, reset.ts: 운영자 경로가 상태를 바꾸기 직전에 로그인 세션을 확인하는 연결.
// 실제 세션 저장소를 거친다(test/helpers/real-session). 확인 바로 앞에서 도는 가짜(공지 채널 찾기, 앱 이모지 조작)나 정리 잠금을 기다리는 사이에
// 그 세션을 다른 기기에서 끝내면 경로는 401 login-required로 답하고 아무것도 바꾸지 않는다. 앱 이모지 조작 안의 실제 확인 자리는 app-emojis 테스트가 본다

process.env.OWNER_ID = "owner";

import fs from "node:fs";
import path from "node:path";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import sharp from "sharp";
import type { Device, Reply } from "../helpers/real-session.ts";

const { fakeBot } = await import("../helpers/fake.ts");
const { openTempStore, setGuild } = await import("../helpers/temp-store.ts");
const { realSessionApp, endOnce } = await import("../helpers/real-session.ts");
const { bodyLimit } = await import("../../src/dashboard/body-limit.ts");
const { adminRouter } = await import("../../src/dashboard/routes/admin.ts");
const { appEmojisRouter } = await import("../../src/dashboard/routes/app-emojis.ts");
const { trackCacheRouter } = await import("../../src/dashboard/routes/track-cache.ts");
const { resetRouter } = await import("../../src/dashboard/routes/reset.ts");
const { _useDir } = await import("../../src/dashboard/app-emoji-glyphs.ts");
const { useAppEmojis } = await import("../../src/store/app-emoji-book.ts");
const audioCache = await import("../../src/store/audio-cache.ts");

const store = openTempStore("session-check-admin-");
_useDir(path.join(store.dir, "app-emojis"));
const PARTY = { id: "111111111111111111", name: "party", animated: false };
useAppEmojis([PARTY]);

const GUILD_ID = "100";
const BOT_CHANNEL = "c1";
setGuild(GUILD_ID, { botChannel: BOT_CHANNEL });

// 세션을 끝낼 자리. 테스트마다 하나를 건다
const at = { channel: endOnce(), emoji: endOnce() };
// 바뀐 것(공지 보내기, 앱 이모지 조작)
const changes: string[] = [];

// 공지를 보낼 전용 채널
const channel = {
  id: BOT_CHANNEL,
  position: 0,
  isTextBased: () => true,
  isThread: () => false,
  permissionsFor: () => ({ has: () => true }),
  send: async () => void changes.push("send"),
};
const guild = {
  id: GUILD_ID,
  name: "서버",
  systemChannel: null,
  members: { me: {} },
  // 전용 채널 찾기
  channels: {
    cache: Object.assign(new Map([[BOT_CHANNEL, channel]]), {
      get(this: Map<string, unknown>, id: string) {
        at.channel.now();
        return Map.prototype.get.call(this, id);
      },
    }),
  },
};

// 앱 이모지 조작은 가짜(app/app-emojis의 AppEmojis 대신). 넘겨받은 확인을 부른 뒤에 바꾼다
const appEmojis = {
  room: () => 7,
  async add(name: string, _image: Buffer, check?: () => void) {
    at.emoji.now();
    check?.();
    changes.push(`add ${name}`);
    return { id: PARTY.id, name, animated: false, mine: true };
  },
  async rename(id: string, name: string, check?: () => void) {
    at.emoji.now();
    check?.();
    changes.push(`rename ${id} ${name}`);
  },
  async remove(id: string, check?: () => void) {
    at.emoji.now();
    check?.();
    changes.push(`remove ${id}`);
  },
};

// 요청이 라우터에 들어갔다(그 뒤 정리 잠금을 기다린다). 라우터를 부른 뒤에 알린다
let arrived: () => void = () => {};
const marker = (_req: Request, _res: Response, next: NextFunction) => {
  next();
  arrived();
};

const real = await realSessionApp("session-check-admin-", (app) => {
  app.locals.bot = Object.assign(fakeBot({ client: { isReady: () => true, user: { username: "테스트 봇" }, guilds: { cache: new Map([[GUILD_ID, guild]]) } } }), { appEmojis });
  app.locals.restart = null;
  app.use(bodyLimit());
  app.use("/api/admin/track-cache", marker, trackCacheRouter);
  app.use("/api/admin/reset", marker, resetRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/app-emojis", appEmojisRouter);
});
after(() => {
  real.close();
  useAppEmojis([]);
  audioCache._setRemoval();
  store.close();
});
afterEach(() => {
  for (const one of Object.values(at)) one.reset();
  changes.length = 0;
  audioCache._setRemoval();
});

async function endingAt(where: ReturnType<typeof endOnce>) {
  const who = await real.signedIn("owner");
  where.arm(() => real.end(who));
  return who;
}
const outcome = (status: number, json: { code?: string } | null) => ({ status, code: json?.code, changes: [...changes] });
const ENDED = { status: 401, code: "login-required", changes: [] };

test("전체 공지: 보낼 채널을 찾는 사이 세션이 끝나면 401이고 보내지 않는다", async () => {
  const who = await endingAt(at.channel);
  const r = await who.call("POST", "/api/admin/broadcast", { message: "점검 안내" });
  assert.ok(at.channel.fired, "채널 찾기에서 세션을 끝냈다");
  assert.deepEqual(outcome(r.status, r.json), ENDED);
});

test("앱 이모지 올리기: 조작이 확인을 부르기 전에 세션이 끝나면 401이고 올리지 않는다", async () => {
  const who = await endingAt(at.emoji);
  const image = await sharp({ create: { width: 200, height: 100, channels: 4, background: "#e8417a" } })
    .png()
    .toBuffer();
  const res = await who.go("/api/app-emojis?name=party_two&rotate=0&left=0&top=0&side=100", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array(image) });
  assert.ok(at.emoji.fired, "조작 안에서 세션을 끝냈다");
  assert.deepEqual(outcome(res.status, (await res.json()) as { code?: string }), ENDED);
});

test("앱 이모지 이름 바꾸기: 조작이 확인을 부르기 전에 세션이 끝나면 401이고 바꾸지 않는다", async () => {
  const who = await endingAt(at.emoji);
  const r = await who.call("PATCH", `/api/app-emojis/${PARTY.id}`, { name: "celebrate" });
  assert.ok(at.emoji.fired, "조작 안에서 세션을 끝냈다");
  assert.deepEqual(outcome(r.status, r.json), ENDED);
});

test("앱 이모지 지우기: 조작이 확인을 부르기 전에 세션이 끝나면 401이고 지우지 않는다", async () => {
  const who = await endingAt(at.emoji);
  const r = await who.call("DELETE", `/api/app-emojis/${PARTY.id}`);
  assert.ok(at.emoji.fired, "조작 안에서 세션을 끝냈다");
  assert.deepEqual(outcome(r.status, r.json), ENDED);
});

// ── 정리 잠금을 기다리는 사이 ──────────────────────────────

// 캐시 파일과 그 행을 만든다
function seedCached(key: string) {
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
  const file = audioCache.getFilePath(key);
  fs.writeFileSync(file, "x".repeat(1000));
  audioCache.recordDownloadStart(key, { title: key });
  audioCache.recordDownloadComplete(key, file, 1000, { title: key });
  return file;
}

/**
 * 다른 삭제가 정리 잠금을 잡은 사이 요청을 보내고, 요청이 잠금을 기다리는 동안 세션을 끝낸 뒤 잠금을 푼다.
 * 지운 파일 이름 목록과 응답을 돌려준다
 */
async function whileLockHeld(send: (who: Device) => Promise<Reply<{ code?: string } | null>>) {
  const holderFile = seedCached("yt:hhhhhhhhhhh");
  const unlinked: string[] = [];
  let held: () => void = () => {};
  let release: () => void = () => {};
  const holding = new Promise<void>((done) => (held = done));
  const released = new Promise<void>((done) => (release = done));
  audioCache._setRemoval({
    unlink: async (target) => {
      unlinked.push(path.basename(target));
      if (target === path.resolve(holderFile)) {
        held();
        await released;
      }
      await fs.promises.rm(target, { force: true });
    },
  });
  const removing = audioCache.removeCached("yt:hhhhhhhhhhh");
  await holding;
  const who = await real.signedIn("owner");
  const reached = new Promise<void>((done) => (arrived = done));
  const pending = send(who);
  await reached;
  await new Promise((done) => setTimeout(done, 30));
  real.end(who);
  release();
  assert.equal((await removing).ok, true, "잠금을 잡은 삭제는 끝까지 간다");
  const reply = await pending;
  arrived = () => {};
  return { unlinked, reply };
}

// 답과 그 파일, 행이 남았는지를 한데 본다(확인을 빼면 200과 지운 것이 함께 보인다)
const left = (reply: Reply<{ code?: string } | null>, unlinked: string[], file: string, key: string) => ({
  status: reply.status,
  code: reply.json?.code,
  tried: unlinked.includes(path.basename(file)),
  file: fs.existsSync(file),
  row: Boolean(audioCache.lookupByAudioKey(key)),
});
const KEPT = { status: 401, code: "login-required", tried: false, file: true, row: true };

test("캐시 DB 저장: 캐시 파일 삭제가 정리 잠금을 기다리는 사이 세션이 끝나면 401이고 지우지 않는다", async () => {
  const file = seedCached("yt:ttttttttttt");
  const expect = audioCache.lookupByAudioKey("yt:ttttttttttt")?.downloaded_at;
  const { unlinked, reply } = await whileLockHeld((who) => who.call("POST", "/api/admin/track-cache", { ops: [{ op: "deleteFile", audioKey: "yt:ttttttttttt", expect }] }));
  assert.deepEqual(left(reply, unlinked, file, "yt:ttttttttttt"), KEPT);
});

test("오디오 캐시 초기화: 정리 잠금을 기다리는 사이 세션이 끝나면 401이고 지우지 않는다", async () => {
  const file = seedCached("yt:rrrrrrrrrrr");
  const { unlinked, reply } = await whileLockHeld((who) => who.call("POST", "/api/admin/reset", { kind: "audio-cache", parts: ["files"] }));
  assert.deepEqual(left(reply, unlinked, file, "yt:rrrrrrrrrrr"), KEPT);
});
