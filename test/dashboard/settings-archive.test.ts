// src/dashboard/settings-archive.ts · routes/settings-archive.ts — 설정 내보내기 · 가져오기(ZIP).
// 내보낸 것을 그대로 복원하고, 선택한 항목만 덮어쓰며, 하나라도 검사에 걸리면 아무것도 바꾸지 않는다. 파일은 미리 보기 때 한 번 올리고 가져오기는 그 티켓으로

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
const uploads = await import("../../src/dashboard/archive-uploads.ts");
const { settingsArchiveRouter } = await import("../../src/dashboard/routes/settings-archive.ts");

const store = openTempStore("settings-archive-");
const faviconDir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-archive-favicon-"));
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-archive-upload-"));
uploads._useDir(uploadDir);
let loginAt = Date.now();
const app = express();
// 로그인한 운영자. 로그인 시각은 테스트가 정한다(최근 로그인 테스트)
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
  guildSettings.forgetCache();
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

/** 내보낸 파일. 기본은 봇 설정만 */
async function exported(kind: "settings" | "favicon" = "settings") {
  // 두 단계: 한 번 쓰는 주소를 받아 그 주소에서 다운로드한다
  const ticket = await fetch(`${base}/export?kind=${kind}`, { method: "POST" });
  assert.equal(ticket.status, 200);
  const res = await fetch(`${baseUrl(server)}${((await ticket.json()) as { url: string }).url}`);
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
/** 가져오기: 미리 보기로 올려 받은 티켓으로(route 는 "import?items=…") */
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

test("봇 설정만: 사람이 읽는 settings.json(형식 · 종류 · 봇 버전 · 운영 조절값 · 문서 넷) 하나. 서버별 설정 · 키 · 파비콘은 들지 않는다", async () => {
  tunables.save({ QUEUE_MAX_TRACKS: "300" }, 0);
  guildSettings.table.setBotChannel("123456789012345678", "222222222222222222");
  assert.equal((await appearance.addFavicon(32, await square(32))).ok, true);

  const file = await exported();
  const json = settingsOf(file);
  assert.deepEqual([json.format, json.kind], [1, "settings"]);
  assert.deepEqual(json.tunables, { QUEUE_MAX_TRACKS: "300" });
  assert.deepEqual(Object.keys(json.documents as object), ["genres", "status", "ai", "ai-prompt"]);
  assert.ok(!("guilds" in json) && !("secrets" in json) && !("favicons" in json));
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
    ["tunables", "genres", "status", "ai", "ai-prompt"].map((item) => [item, true, true, 0]),
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

test("선택한 항목만 덮어쓰고 메모리(설정 객체 · 문서)까지 맞춘다. 선택하지 않은 것 · 서버별 설정은 그대로", async () => {
  const file = await exported();

  tunables.save({ QUEUE_MAX_TRACKS: "77" }, 0);
  documents.put("status", { interval: 30, messages: ["바뀐 문구"] }, documents.revisionOf("status"));
  guildSettings.table.setBotChannel("123456789012345678", "999999999999999999");
  const statusRevision = documents.revisionOf("status");

  const res = await send("import?items=tunables", file);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { imported: ["tunables"], restart: false, cookiesSource: null });
  assert.ok(
    snapshots.list().some((one) => one.kind === "before-import"),
    "쓰기 전에 스냅샷을 남긴다",
  );

  assert.equal(config.bot.maxQueueSize, 250, "운영 조절값은 기본값(파일에 없던 필드)으로");
  assert.equal(await guildSettings.getBotChannel("123456789012345678"), "999999999999999999", "서버별 설정은 백업에 없다");
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

test("선택한 항목 하나라도 검사에 걸리면 400 으로 까닭을 모두 알리고 아무것도 바꾸지 않는다", async () => {
  const file = rewrite(await exported(), (json) => {
    (json.documents as Record<string, unknown>).status = { interval: 1, messages: [] };
    json.tunables = { QUEUE_MAX_TRACKS: "abc" };
  });
  const rows = rowsOf((await preview(file)).json);
  assert.ok(rows.status.problems.length && rows.tunables.problems.length, "미리 보기도 까닭을 보인다");

  tunables.save({ QUEUE_MAX_TRACKS: "77" }, 0);
  const genresRevision = documents.revisionOf("genres");
  const res = await send("import?items=genres,status,tunables", file);
  const json = (await res.json()) as { code: string; errors: { detail: string }[] };
  assert.deepEqual([res.status, json.code], [400, "config-invalid"]);
  assert.ok(json.errors.some((one) => one.detail.startsWith("활동 문구:")));
  assert.ok(json.errors.some((one) => one.detail.startsWith("운영 조절값:")));
  assert.equal(config.bot.maxQueueSize, 77);
  assert.equal(documents.revisionOf("genres"), genresRevision, "검사를 지난 항목도 쓰지 않는다");
});

// 평문으로 남는 필드에 비밀 헤더를 적어 가져오지 못한다(저장 때와 같은 검사)
test("AI 설정의 추가 인자에 비밀 헤더가 있으면 꺼 두었어도 가져오지 않는다", async () => {
  const file = rewrite(await exported(), (json) => {
    (json.documents as Record<string, unknown>).ai = { enabled: true, provider: "openai", model: "m", extra: "header::Authorization=Bearer sk-몰래" };
  });
  assert.equal((await send("import?items=ai", file)).status, 400);
  const off = rewrite(file, (json) => ((json.documents as Record<string, { enabled: boolean }>).ai.enabled = false));
  assert.equal((await send("import?items=ai", off)).status, 400, "꺼 둔 설정이어도");
});

test("파일에 없는 항목 · 모르는 항목 · 빈 목록은 거절한다", async () => {
  const file = rewrite(await exported(), (json) => delete (json.documents as Record<string, unknown>).genres);
  assert.equal(rowsOf((await preview(file)).json).genres.inFile, false);
  assert.equal((await send("import?items=genres", file)).status, 400);
  assert.equal((await send("import?items=guilds", file)).status, 400, "없어진 항목");
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

test("파비콘: 내보낸 슬롯 · 기록으로 통째 되돌린다. 비어 있던 파일을 가져오면 파비콘이 없어진다", async () => {
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

test("파비콘: 빠지거나 망가진 이미지는 미리 보기가 표시하고 가져오지 않는다. 목록이 없는(예전 모양) 파일은 파비콘이 없는 것으로 본다", async () => {
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

test("올린 파일: 가져오면 삭제하고(같은 티켓으로 다시 못 쓴다), 검사에 걸리면 두고, 닫으면 삭제한다. 못 읽은 파일은 남기지 않는다", async () => {
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

test("다운로드 주소는 한 번만 쓴다(다시 열면 404). 모르는 티켓도 404", async () => {
  const { url } = (await (await fetch(`${base}/export?kind=settings`, { method: "POST" })).json()) as { url: string };
  assert.match(url, /^\/api\/admin\/settings-archive\/download\/[0-9a-f]{32}$/);
  assert.equal((await fetch(`${baseUrl(server)}${url}`)).status, 200);
  assert.equal((await fetch(`${baseUrl(server)}${url}`)).status, 404);
  assert.equal((await fetch(`${base}/download/${"0".repeat(32)}`)).status, 404);
});

test("내보내기 · 가져오기는 최근 로그인만, 미리 보기는 아니어도 된다", async () => {
  const file = await exported();
  loginAt = Date.now() - RECENT_LOGIN_MS - 1;
  for (const kind of ["settings", "favicon", "login-background"]) assert.equal((await fetch(`${base}/export?kind=${kind}`, { method: "POST" })).status, 403);
  assert.equal((await send("import?items=genres", file)).status, 403);
  assert.equal((await preview(file)).status, 200);
});

// PC 에 매인 값(쿠키 출처 · POToken)도 담고 불러온다. 바뀌면 미리 보기가 알리고, 불러온 뒤 답이 다시 시작 · 쿠키 출처를 알린다
test("봇 설정만: PC 에 매인 값도 담고 불러온다. 미리 보기가 알리고, 불러온 뒤 다시 시작해야 하는지 · 바뀐 쿠키 출처를 답한다", async () => {
  tunables.save({ QUEUE_MAX_TRACKS: "300", COOKIES_SOURCE: "firefox", BGUTIL_ENABLED: "true" }, 0);
  const file = await exported();
  assert.deepEqual(settingsOf(file).tunables, { QUEUE_MAX_TRACKS: "300", COOKIES_SOURCE: "firefox", BGUTIL_ENABLED: "true" });

  tunables.save({ QUEUE_MAX_TRACKS: "77" }, tunables.view().revision);
  const rows = rowsOf((await preview(file)).json);
  assert.deepEqual(rows.tunables.warnings, ["쿠키 출처가 바뀌어요: 쓰지 않음 → firefox", "POToken 사용이 바뀌어요(다시 시작해야 적용돼요)"]);

  const res = await send("import?items=tunables", file);
  assert.deepEqual(await res.json(), { imported: ["tunables"], restart: true, cookiesSource: "firefox" }, "기동 때 POToken 은 꺼져 있었다");
  assert.deepEqual(tunables.view().values, { QUEUE_MAX_TRACKS: "300", COOKIES_SOURCE: "firefox", BGUTIL_ENABLED: "true" });
});

// 남이 준 파일로 모르고 가져오지 않게: AI 요청이 가는 곳 · 봇 웹사이트 주소
test("바깥으로 나가는 값이 바뀌면 미리 보기가 표시해 준다", async () => {
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
