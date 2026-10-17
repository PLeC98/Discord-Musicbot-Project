// src/dashboard/settings-archive.ts · routes/settings-archive.ts — 설정 내보내기 · 가져오기(ZIP).
// 내보낸 것을 그대로 되살리고, 고른 항목만 덮어쓰며, 하나라도 검사에 걸리면 아무것도 바꾸지 않는다. 파일은 미리 보기 때 한 번 올리고 가져오기는 그 표로

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
const secrets = await import("../../src/store/secrets.ts");
const { RECENT_LOGIN_MS } = await import("../../src/dashboard/middleware/recent-login.ts");
const uploads = await import("../../src/dashboard/archive-uploads.ts");
const { settingsArchiveRouter } = await import("../../src/dashboard/routes/settings-archive.ts");

const store = openTempStore("settings-archive-");
const faviconDir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-archive-favicon-"));
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-archive-upload-"));
uploads._useDir(uploadDir);
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
  uploads.sweepUploads();
});
after(() => {
  server.close();
  store.settings().exec("DELETE FROM documents; DELETE FROM guild_settings;");
  tunables.load();
  useDefaultDocuments();
  store.close();
  fs.rmSync(faviconDir, { recursive: true, force: true });
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

type Row = { item: string; inFile: boolean; same: boolean; problems: string[]; warnings: string[]; count: number | null };

/** 내보낸 파일. 기본은 암호화된 설정까지(파비콘 말고 모든 항목이 든다) */
async function exported(kind: "settings" | "full" | "favicon" = "full") {
  const res = await fetch(`${base}/export?kind=${kind}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  assert.match(res.headers.get("content-disposition") ?? "", new RegExp(`attachment; filename="musicbot-${kind}-\\d{8}-\\d{4}\\.zip"`));
  return Buffer.from(await res.arrayBuffer());
}
const upload = (file: Buffer) => fetch(`${base}/preview`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: file });
async function preview(file: Buffer) {
  const res = await upload(file);
  return { status: res.status, json: (await res.json()) as { token: string; kind: string; rows: Row[]; botVersion: string | null; code?: string; detail?: string } };
}
/** 가져오기: 미리 보기로 올려 받은 표로(route 는 "import?items=…") */
async function send(route: string, file: Buffer) {
  const { json } = await preview(file);
  return fetch(`${base}/${route}${route.includes("?") ? "&" : "?"}token=${json.token}`, { method: "POST" });
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

test("암호화된 설정까지: 사람이 읽는 settings.json(형식 · 종류 · 봇 버전 · 운영 조절값 · 문서 넷 · 서버별 설정 · 키 암호문) 하나. 파비콘은 들지 않는다", async () => {
  tunables.save({ QUEUE_MAX_TRACKS: "300" }, 0);
  guildSettings.table.setBotChannel("123456789012345678", "222222222222222222");
  assert.equal((await appearance.addFavicon(32, await square(32))).ok, true);

  const file = await exported();
  const json = settingsOf(file);
  assert.deepEqual([json.format, json.kind], [1, "full"]);
  assert.deepEqual(json.tunables, { QUEUE_MAX_TRACKS: "300" });
  assert.deepEqual(json.secrets, [], "넣어 둔 키가 없다");
  assert.deepEqual(Object.keys(json.documents as object), ["genres", "status", "ai", "ai-prompt"]);
  assert.deepEqual(json.guilds, { "123456789012345678": { botChannelId: "222222222222222222" } });
  assert.ok(!("favicons" in json));
  assert.deepEqual(
    unzip(file).map((one) => one.name),
    ["settings.json"],
  );
  assert.match(unzip(file)[0].data.toString("utf8"), /\n {2}"format": 1,/, "들여 쓴 JSON");
});

test("파비콘: settings.json(형식 · 종류 · 파일 목록)과 favicon/ 파일. 미리 보기는 파비콘 줄 하나", async () => {
  assert.equal((await appearance.addFavicon(32, await square(32))).ok, true);
  const file = await exported("favicon");
  const json = settingsOf(file);
  assert.deepEqual([json.format, json.kind], [1, "favicon"]);
  assert.ok(!("tunables" in json) && !("documents" in json));
  const [image] = appearance.faviconSlots(false).slots.find((one) => one.size === 32)!.history;
  assert.deepEqual(json.favicons, ["index.json", `${image.id}.png`, `${image.id}.reserve.png`]);
  assert.deepEqual(
    unzip(file).map((one) => one.name),
    ["settings.json", "favicon/index.json", `favicon/${image.id}.png`, `favicon/${image.id}.reserve.png`],
  );
  const { json: shown } = await preview(file);
  assert.equal(shown.kind, "favicon");
  assert.deepEqual(
    shown.rows.map((one) => [one.item, one.inFile, one.same]),
    [["favicon", true, true]],
  );
});

test("자기 내보내기를 미리 보면 모두 파일에 있고 지금과 같다. 바꾼 뒤에는 바뀐 항목만 다르다", async () => {
  const file = await exported();
  let rows = rowsOf((await preview(file)).json);
  assert.deepEqual(
    Object.values(rows).map((one) => [one.item, one.inFile, one.same, one.problems.length]),
    ["tunables", "genres", "status", "ai", "ai-prompt", "guilds", "secrets"].map((item) => [item, true, true, 0]),
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
  assert.equal((await send("import?items=env", file)).status, 400);
  assert.equal((await send("import", file)).status, 400);
});

test("ZIP 이 아니거나 settings.json 이 없거나 모르는 형식이면 bad-archive", async () => {
  const cases = [Buffer.from("그냥 글"), zip([{ name: "other.json", data: Buffer.from("{}") }]), rewrite(await exported(), (json) => (json.format = 2))];
  for (const file of cases) {
    const { status, json } = await preview(file);
    assert.deepEqual([status, json.code], [400, "bad-archive"]);
  }
});

const currents = () =>
  appearance
    .faviconSlots(false)
    .slots.filter((one) => one.current)
    .map((one) => one.size);

test("파비콘: 내보낸 칸 · 기록으로 통째 되돌린다. 비어 있던 파일을 가져오면 파비콘이 없어진다", async () => {
  await appearance.addFavicon(32, await square(32));
  const first = await exported("favicon");
  await appearance.addFavicon(32, await square(40));
  const file = await exported("favicon");
  await appearance.addFavicon(48, await square(48));
  const row = rowsOf((await preview(file)).json).favicon;
  assert.deepEqual([row.same, row.count], [false, 2], "이미지 수는 기록의 수");

  const snapshotCount = snapshots.list().length;
  assert.equal((await send("import?items=favicon", file)).status, 200);
  assert.equal(snapshots.list().length, snapshotCount, "설정 DB 항목이 없으면 스냅샷을 뜨지 않는다");
  assert.deepEqual(currents(), [32]);
  assert.equal(appearance.faviconSlots(false).slots.find((one) => one.size === 32)!.history.length, 2);
  assert.equal(rowsOf((await preview(file)).json).favicon.same, true, "가져온 뒤에는 같다");
  assert.equal(fs.readdirSync(faviconDir).length, 5, "목록 하나 · 이미지마다 둘, 48 의 파일은 치웠다");

  appearance.removeFavicon(32, appearance.faviconSlots(false).slots.find((one) => one.size === 32)!.current!);
  const cleared = zip(unzip(first).map((one) => (one.name === "favicon/index.json" ? { name: one.name, data: Buffer.from('{"slots":{}}') } : one)));
  assert.equal((await send("import?items=favicon", cleared)).status, 200);
  assert.deepEqual(currents(), []);
  assert.deepEqual(
    appearance.faviconFiles().map((one) => one.name),
    ["index.json"],
  );
});

test("파비콘: 빠지거나 망가진 이미지는 미리 보기가 짚고 가져오지 않는다. 목록이 없는(예전 모양) 파일은 파비콘이 없는 것으로 본다", async () => {
  await appearance.addFavicon(32, await square(32));
  const file = await exported("favicon");
  const missing = zip(unzip(file).filter((one) => !one.name.endsWith(".reserve.png")));
  assert.deepEqual(rowsOf((await preview(missing)).json).favicon.problems, ["목록에 있는 이미지 파일이 빠져 있습니다."]);
  const broken = zip(unzip(file).map((one) => (one.name.endsWith(".reserve.png") ? { name: one.name, data: Buffer.from("깨진 것") } : one)));
  assert.deepEqual(rowsOf((await preview(broken)).json).favicon.problems, ["망가졌거나 크기가 맞지 않는 이미지가 있습니다."]);
  assert.notEqual((await send("import?items=favicon", broken)).status, 200);
  assert.deepEqual(currents(), [32], "가져오지 않았다");

  const old = zip([...unzip(rewrite(file, (json) => (json.favicons = ["32.png"]))).filter((one) => !one.name.startsWith("favicon/")), { name: "favicon/32.png", data: await square(32) }]);
  assert.equal(rowsOf((await preview(old)).json).favicon.inFile, false);
});

test("예전에 봇 설정과 함께 내보낸 파비콘도 불러온다", async () => {
  await appearance.addFavicon(32, await square(32));
  const favicons = unzip(await exported("favicon")).filter((one) => one.name.startsWith("favicon/"));
  const names = favicons.map((one) => one.name.slice("favicon/".length));
  const old = zip([...unzip(rewrite(await exported("settings"), (json) => (json.favicons = names))), ...favicons]);
  appearance.removeFavicon(32, appearance.faviconSlots(false).slots.find((one) => one.size === 32)!.current!);

  const { json } = await preview(old);
  assert.equal(json.kind, "settings");
  assert.deepEqual([rowsOf(json).favicon.inFile, rowsOf(json).favicon.same], [true, false]);
  assert.equal((await send("import?items=favicon", old)).status, 200);
  assert.deepEqual(currents(), [32]);
});

test("올린 파일: 가져오면 지우고(같은 표로 다시 못 쓴다), 검사에 걸리면 두고, 닫으면 지운다. 못 읽은 파일은 남기지 않는다", async () => {
  const file = await exported();
  const { json } = await preview(file);
  assert.equal(fs.readdirSync(uploadDir).length, 1);
  assert.equal((await fetch(`${base}/import?items=env&token=${json.token}`, { method: "POST" })).status, 400);
  assert.equal(fs.readdirSync(uploadDir).length, 1, "거절해도 다시 고를 수 있게 둔다");
  assert.equal((await fetch(`${base}/import?items=genres&token=${json.token}`, { method: "POST" })).status, 200);
  assert.deepEqual(fs.readdirSync(uploadDir), []);
  const again = await fetch(`${base}/import?items=genres&token=${json.token}`, { method: "POST" });
  assert.deepEqual([again.status, ((await again.json()) as { code: string }).code], [410, "upload-gone"]);

  const closed = (await preview(file)).json.token;
  assert.equal((await fetch(`${base}/upload/${closed}`, { method: "DELETE" })).status, 204);
  assert.deepEqual(fs.readdirSync(uploadDir), []);
  assert.equal((await fetch(`${base}/import?items=genres&token=${closed}`, { method: "POST" })).status, 410);

  assert.equal((await preview(Buffer.from("그냥 글"))).status, 400);
  assert.deepEqual(fs.readdirSync(uploadDir), [], "못 읽은 파일");
  assert.equal((await upload(Buffer.alloc(0))).status, 400, "빈 본문");

  await preview(file);
  uploads.sweepUploads();
  assert.deepEqual(fs.readdirSync(uploadDir), [], "봇이 켜질 때 남은 것을 치운다");
});

test("내보내기 · 가져오기는 최근 로그인만, 미리 보기는 아니어도 된다", async () => {
  const file = await exported();
  loginAt = Date.now() - RECENT_LOGIN_MS - 1;
  assert.equal((await fetch(`${base}/export?kind=settings`)).status, 403);
  assert.equal((await fetch(`${base}/export?kind=full`)).status, 403);
  assert.equal((await fetch(`${base}/export?kind=favicon`)).status, 403);
  assert.equal((await send("import?items=genres", file)).status, 403);
  assert.equal((await preview(file)).status, 200);
});

// 남에게 나눠 줄 파일: 서버별 설정 · 키가 없고, 이 PC 에만 맞는 값(쿠키 출처 · POToken)도 빠진다
test("봇 설정만: 서버별 설정 · 키 · PC 에 매인 값이 없고, 불러와도 PC 에 매인 지금 값은 지킨다", async () => {
  tunables.save({ QUEUE_MAX_TRACKS: "300", COOKIES_SOURCE: "firefox", BGUTIL_ENABLED: "true" }, 0);
  guildSettings.table.setBotChannel("123456789012345678", "222222222222222222");
  const file = await exported("settings");
  const json = settingsOf(file);
  assert.equal(json.kind, "settings");
  assert.deepEqual(json.tunables, { QUEUE_MAX_TRACKS: "300" });
  assert.ok(!("guilds" in json) && !("secrets" in json));
  const rows = rowsOf((await preview(file)).json);
  assert.ok(!("guilds" in rows) && !("secrets" in rows), "그 종류의 항목만 보인다");
  assert.equal(rows.tunables.same, true, "PC 에 매인 값은 지금 것을 지키니 같다");

  tunables.save({ QUEUE_MAX_TRACKS: "77", COOKIES_SOURCE: "chrome" }, tunables.view().revision);
  assert.equal((await send("import?items=tunables", file)).status, 200);
  assert.deepEqual(tunables.view().values, { QUEUE_MAX_TRACKS: "300", COOKIES_SOURCE: "chrome" }, "남의 파일이 쿠키 출처를 정하지 못한다");
});

// 남이 준 파일로 모르고 들이지 않게: AI 요청이 가는 곳 · 봇이 보이는 링크
test("바깥으로 나가는 값이 바뀌면 미리 보기가 짚어 준다", async () => {
  const file = rewrite(await exported("settings"), (json) => {
    (json.tunables as Record<string, string>).WEBSITE = "https://phish.example";
    const docs = json.documents as Record<string, unknown>;
    docs.ai = { enabled: true, provider: "custom", baseUrl: "https://evil.example/v1", model: "m" };
    docs.status = { interval: 60, messages: ["여기로 https://phish.example/free"] };
  });
  const rows = rowsOf((await preview(file)).json);
  assert.match(rows.tunables.warnings.join(), /phish\.example/);
  assert.match(rows.ai.warnings.join(), /evil\.example/);
  assert.match(rows.status.warnings.join(), /phish\.example\/free/);
  assert.deepEqual(rows.genres.warnings, []);
});

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 8).toString("base64");
const SECRET = "sk-archive-test-0123456789";

test("키 · 쿠키: 암호문으로 내보내고 같은 SECRETS_KEY 에서 되살린다. 끝 네 글자는 풀어서 다시 센다", async () => {
  secrets._useKey(KEY);
  try {
    secrets.put("ai.openai", SECRET, { provider: "openai", endpoint: "https://api.openai.com" });
    const file = await exported("full");
    const sealed = (settingsOf(file).secrets as Array<Record<string, unknown>>)[0];
    assert.equal(sealed.name, "ai.openai");
    assert.ok(!("last4" in sealed), "끝 네 글자는 담지 않는다");
    assert.ok(!JSON.stringify(settingsOf(file)).includes(SECRET.slice(0, -4)), "값은 암호문으로만");

    secrets.remove("ai.openai");
    const rows = rowsOf((await preview(file)).json);
    assert.deepEqual([rows.secrets.count, rows.secrets.same, rows.secrets.problems], [1, false, []]);
    assert.equal((await send("import?items=secrets", file)).status, 200);
    assert.deepEqual(secrets.read("ai.openai", { provider: "openai", endpoint: "https://api.openai.com" }), { state: "ok", value: SECRET });
    assert.equal(secrets.status("ai.openai").last4, SECRET.slice(-4));
  } finally {
    secrets.remove("ai.openai");
    secrets._useKey();
  }
});

test("키 · 쿠키: 다른 SECRETS_KEY 로 잠근 값 · 바꾼 암호문 · 꾸민 끝 네 글자는 받지 않는다", async () => {
  secrets._useKey(OTHER_KEY);
  let file: Buffer;
  try {
    secrets.put("ai.openai", SECRET, { provider: "openai", endpoint: "https://api.openai.com" });
    file = await exported("full");
  } finally {
    secrets.remove("ai.openai");
  }
  secrets._useKey(KEY);
  try {
    const rows = rowsOf((await preview(file)).json);
    assert.match(rows.secrets.problems.join(), /다른 키로 잠근 값 1개/);
    assert.equal((await send("import?items=secrets", file)).status, 400);

    // 같은 키로 잠갔지만 주소를 공격자 서버로 바꾸거나 암호문을 건드렸다: 인증 데이터가 맞지 않아 풀리지 않는다
    secrets.put("ai.openai", SECRET, { provider: "openai", endpoint: "https://api.openai.com" });
    const good = await exported("full");
    secrets.remove("ai.openai");
    const moved = rewrite(good, (json) => ((json.secrets as Array<Record<string, unknown>>)[0].endpoint = "https://evil.example"));
    assert.equal((await send("import?items=secrets", moved)).status, 400);
    const forged = rewrite(good, (json) => ((json.secrets as Array<Record<string, unknown>>)[0].last4 = "XXXX"));
    assert.equal((await send("import?items=secrets", forged)).status, 200);
    assert.equal(secrets.status("ai.openai").last4, SECRET.slice(-4), "파일의 끝 네 글자를 믿지 않는다");
  } finally {
    secrets.remove("ai.openai");
    secrets._useKey();
  }
});
