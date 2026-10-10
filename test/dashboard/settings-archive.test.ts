// src/dashboard/settings-archive.ts · routes/settings-archive.ts — 설정 내보내기 · 가져오기(ZIP).
// 내보낸 것을 그대로 되살리고, 고른 항목만 덮어쓰며, 하나라도 검사에 걸리면 아무것도 바꾸지 않는다

process.env.OWNER_ID = "owner";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { fake } = await import("../helpers/fake.ts");
const { openTempStore } = await import("../helpers/temp-store.ts");
const { useDefaultDocuments } = await import("../helpers/config-docs.ts");
const { zip, unzip } = await import("../../src/infra/zip.ts");
const config = (await import("../../src/config/index.ts")).default;
const documents = await import("../../src/config/documents.ts");
const settingsDocs = await import("../../src/store/settings-docs.ts");
const tunables = await import("../../src/store/tunables.ts");
const guildSettings = await import("../../src/store/guild-settings.ts");
const appearance = await import("../../src/dashboard/appearance.ts");
const snapshots = await import("../../src/store/snapshots.ts");
const { RECENT_LOGIN_MS } = await import("../../src/dashboard/middleware/recent-login.ts");
const { settingsArchiveRouter } = await import("../../src/dashboard/routes/settings-archive.ts");

const store = openTempStore("settings-archive-");
const faviconDir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-archive-favicon-"));
let loginAt = Date.now();
const app = express();
// 로그인한 운영자. 로그인 시각은 시험이 정한다(최근 로그인 시험)
app.use((req, _res, next) => {
  req.session = fake<typeof req.session>({ user: { id: "owner", username: "owner" }, loginAt });
  next();
});
app.use("/api/admin/settings-archive", settingsArchiveRouter);
const server = await listenForFetch(app);
const base = `${baseUrl(server)}/api/admin/settings-archive`;

beforeEach(() => {
  loginAt = Date.now();
  store.settings().exec("DELETE FROM documents; DELETE FROM guild_settings;");
  documents.attach(settingsDocs);
  tunables.load();
  guildSettings._reset();
  appearance._useDir(faviconDir);
  for (const name of fs.readdirSync(faviconDir)) fs.rmSync(path.join(faviconDir, name), { force: true });
});
after(() => {
  server.close();
  store.settings().exec("DELETE FROM documents; DELETE FROM guild_settings;");
  tunables.load();
  useDefaultDocuments();
  store.close();
  fs.rmSync(faviconDir, { recursive: true, force: true });
});

type Row = { item: string; inFile: boolean; same: boolean; problems: string[]; count: number | null };

async function exported() {
  const res = await fetch(`${base}/export`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="musicbot-settings-\d{8}-\d{4}\.zip"/);
  return Buffer.from(await res.arrayBuffer());
}
const send = (route: string, file: Buffer) => fetch(`${base}/${route}`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: file });
async function preview(file: Buffer) {
  const res = await send("preview", file);
  return { status: res.status, json: (await res.json()) as { rows: Row[]; botVersion: string | null; code?: string; detail?: string } };
}
const rowsOf = (json: { rows: Row[] }) => Object.fromEntries(json.rows.map((one) => [one.item, one]));
const settingsOf = (file: Buffer) =>
  JSON.parse(
    unzip(file)
      .find((one) => one.name === "settings.json")
      ?.data.toString("utf8") ?? "null",
  ) as Record<string, unknown>;
// settings.json 만 바꿔 다시 묶는다(그림은 그대로)
const rewrite = (file: Buffer, change: (json: Record<string, unknown>) => void) => {
  const entries = unzip(file);
  const json = settingsOf(file);
  change(json);
  return zip(entries.map((one) => (one.name === "settings.json" ? { name: one.name, data: Buffer.from(JSON.stringify(json)) } : one)));
};
const square = (side: number) =>
  sharp({ create: { width: side, height: side, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 1 } } })
    .png()
    .toBuffer();

test("내보낸 파일: 사람이 읽는 settings.json(형식 · 봇 버전 · 운영 조절값 · 문서 넷 · 서버별 설정 · 그림 목록)과 favicon/ 그림", async () => {
  tunables.save({ QUEUE_MAX_TRACKS: "300" }, 0);
  guildSettings.table.setBotChannel("123456789012345678", "222222222222222222");
  assert.equal((await appearance.addFavicon(await square(32))).ok, true);

  const file = await exported();
  const json = settingsOf(file);
  assert.equal(json.format, 1);
  assert.deepEqual(json.tunables, { QUEUE_MAX_TRACKS: "300" });
  assert.deepEqual(Object.keys(json.documents as object), ["genres", "status", "ai", "ai-prompt"]);
  assert.deepEqual(json.guilds, { "123456789012345678": { botChannelId: "222222222222222222" } });
  assert.deepEqual(json.favicons, ["32.png"]);
  assert.deepEqual(
    unzip(file).map((one) => one.name),
    ["settings.json", "favicon/32.png"],
  );
  assert.match(unzip(file)[0].data.toString("utf8"), /\n {2}"format": 1,/, "들여 쓴 JSON");
});

test("자기 내보내기를 미리 보면 모두 파일에 있고 지금과 같다. 바꾼 뒤에는 바뀐 항목만 다르다", async () => {
  const file = await exported();
  let rows = rowsOf((await preview(file)).json);
  assert.deepEqual(
    Object.values(rows).map((one) => [one.item, one.inFile, one.same, one.problems.length]),
    ["tunables", "genres", "status", "ai", "ai-prompt", "guilds", "favicon"].map((item) => [item, true, true, 0]),
  );

  tunables.save({ QUEUE_MAX_TRACKS: "77" }, 0);
  documents.put("status", { interval: 30, messages: ["바뀐 문구"] }, documents.revisionOf("status"));
  rows = rowsOf((await preview(file)).json);
  assert.deepEqual(
    Object.values(rows)
      .filter((one) => !one.same)
      .map((one) => one.item),
    ["tunables", "status"],
  );
});

test("고른 항목만 덮어쓰고 메모리(설정 객체 · 문서 · 서버별 설정)까지 맞춘다. 고르지 않은 것은 그대로", async () => {
  guildSettings.table.setBotChannel("123456789012345678", "111111111111111111");
  const file = await exported();

  tunables.save({ QUEUE_MAX_TRACKS: "77" }, 0);
  documents.put("status", { interval: 30, messages: ["바뀐 문구"] }, documents.revisionOf("status"));
  guildSettings.table.setBotChannel("123456789012345678", "999999999999999999");
  guildSettings.table.setDjRoles("876543210987654321", ["333333333333333333"]);
  const statusRevision = documents.revisionOf("status");

  const res = await send("import?items=tunables,guilds", file);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { imported: ["tunables", "guilds"] });
  assert.ok(
    snapshots.list().some((one) => one.kind === "before-import"),
    "쓰기 전에 스냅샷을 남긴다",
  );

  assert.equal(config.bot.maxQueueSize, 250, "운영 조절값은 기본값(파일에 없던 칸)으로");
  assert.equal(await guildSettings.getBotChannel("123456789012345678"), "111111111111111111");
  assert.deepEqual(await guildSettings.getDjRoles("876543210987654321"), [], "파일에 없던 서버의 설정은 지운다");
  assert.deepEqual((documents.get("status") as { messages: string[] }).messages, ["바뀐 문구"], "고르지 않은 문서는 그대로");
  assert.equal(documents.revisionOf("status"), statusRevision);
});

test("문서를 가져오면 저장 번호가 올라 열어 둔 편집기는 낡은 번호로 덮지 못한다", async () => {
  const file = await exported();
  const before = documents.revisionOf("genres");
  assert.equal((await send("import?items=genres", file)).status, 200);
  assert.equal(documents.revisionOf("genres"), before + 1);
  assert.equal(settingsDocs.read("genres").revision, before + 1);
});

test("고른 항목 하나라도 검사에 걸리면 400 으로 까닭을 모두 알리고 아무것도 바꾸지 않는다", async () => {
  const file = rewrite(await exported(), (json) => {
    (json.documents as Record<string, unknown>).status = { interval: 1, messages: [] };
    json.tunables = { QUEUE_MAX_TRACKS: "abc" };
  });
  const rows = rowsOf((await preview(file)).json);
  assert.ok(rows.status.problems.length && rows.tunables.problems.length, "미리 보기도 까닭을 보인다");

  tunables.save({ QUEUE_MAX_TRACKS: "77" }, 0);
  guildSettings.table.setBotChannel("123456789012345678", "999999999999999999");
  const res = await send("import?items=guilds,status,tunables", file);
  const json = (await res.json()) as { code: string; errors: { detail: string }[] };
  assert.deepEqual([res.status, json.code], [400, "config-invalid"]);
  assert.ok(json.errors.some((one) => one.detail.startsWith("활동 문구:")));
  assert.ok(json.errors.some((one) => one.detail.startsWith("운영 조절값:")));
  assert.equal(config.bot.maxQueueSize, 77);
  assert.equal(await guildSettings.getBotChannel("123456789012345678"), "999999999999999999", "검사를 지난 항목도 쓰지 않는다");
});

// 평문으로 남는 칸에 비밀 헤더를 적어 들여오지 못한다(저장 때와 같은 검사)
test("AI 설정의 추가 인자에 비밀 헤더가 있으면 꺼 두었어도 가져오지 않는다", async () => {
  const file = rewrite(await exported(), (json) => {
    (json.documents as Record<string, unknown>).ai = { enabled: true, provider: "openai", model: "m", extra: "header::Authorization=Bearer sk-몰래" };
  });
  assert.equal((await send("import?items=ai", file)).status, 400);
  const off = rewrite(file, (json) => ((json.documents as Record<string, { enabled: boolean }>).ai.enabled = false));
  assert.equal((await send("import?items=ai", off)).status, 400, "꺼 둔 설정이어도");
});

test("파일에 없는 항목 · 모르는 항목 · 빈 목록은 거절한다", async () => {
  const file = rewrite(await exported(), (json) => delete json.guilds);
  assert.equal(rowsOf((await preview(file)).json).guilds.inFile, false);
  assert.equal((await send("import?items=guilds", file)).status, 400);
  assert.equal((await send("import?items=secrets", file)).status, 400);
  assert.equal((await send("import", file)).status, 400);
});

test("ZIP 이 아니거나 settings.json 이 없거나 모르는 형식이면 bad-archive", async () => {
  const cases = [Buffer.from("그냥 글"), zip([{ name: "other.json", data: Buffer.from("{}") }]), rewrite(await exported(), (json) => (json.format = 2))];
  for (const file of cases) {
    const { status, json } = await preview(file);
    assert.deepEqual([status, json.code], [400, "bad-archive"]);
  }
});

test("파비콘: 내보낸 그림으로 통째 되돌린다. 비어 있던 파일을 가져오면 그림이 없어진다", async () => {
  await appearance.addFavicon(await square(32));
  const file = await exported();
  await appearance.addFavicon(await square(64));
  assert.equal(rowsOf((await preview(file)).json).favicon.same, false);

  assert.equal((await send("import?items=favicon", file)).status, 200);
  assert.deepEqual(
    (await appearance.faviconFiles()).map((one) => one.name),
    ["32.png"],
  );

  const empty = rewrite(file, (json) => (json.favicons = []));
  const withoutImages = zip(unzip(empty).filter((one) => !one.name.startsWith("favicon/")));
  assert.equal((await send("import?items=favicon", withoutImages)).status, 200);
  assert.deepEqual(await appearance.faviconFiles(), []);
});

test("내보내기 · 가져오기는 최근 로그인만, 미리 보기는 아니어도 된다", async () => {
  const file = await exported();
  loginAt = Date.now() - RECENT_LOGIN_MS - 1;
  assert.equal((await fetch(`${base}/export`)).status, 403);
  assert.equal((await send("import?items=genres", file)).status, 403);
  assert.equal((await preview(file)).status, 200);
});
