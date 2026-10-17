// src/dashboard/login-background/archive.ts — 로그인 배경 백업(설정 내보내기의 login-background 종류).
// 다 만든 배경의 내는 파일만 담고, 불러오면 새 id 로 풀어 기록을 통째로 바꾼다. 남이 준 파일의 모르는 파일 · 빠진 파일 · 바깥을 가리키는 목록은 받지 않는다

process.env.OWNER_ID = "owner";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import type { Index } from "../../src/dashboard/login-background/store.ts";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { fake } = await import("../helpers/fake.ts");
const { openTempStore } = await import("../helpers/temp-store.ts");
const { zip, unzip } = await import("../../src/infra/zip.ts");
const store = await import("../../src/dashboard/login-background/store.ts");
const runner = await import("../../src/dashboard/login-background/runner.ts");
const uploads = await import("../../src/dashboard/archive-uploads.ts");
const { publicOf } = await import("../../src/dashboard/routes/login-background-public.ts");
const { settingsArchiveRouter } = await import("../../src/dashboard/routes/settings-archive.ts");

const temp = openTempStore("login-bg-archive-");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "login-bg-archive-"));
const bgDir = path.join(DIR, "login-background");
const uploadDir = path.join(DIR, "tmp");
fs.mkdirSync(uploadDir);
uploads._useDir(uploadDir);
sharp.cache({ files: 0 });

const app = express();
app.use((req, _res, next) => {
  req.session = fake<typeof req.session>({ user: { id: "owner", username: "owner" }, loginAt: Date.now() });
  next();
});
app.use("/api/admin/settings-archive", settingsArchiveRouter);
const server = await listenForFetch(app);
const base = `${baseUrl(server)}/api/admin/settings-archive`;

beforeEach(() => {
  runner._reset();
  fs.rmSync(bgDir, { recursive: true, force: true });
  store._useDir(bgDir);
  uploads.sweepUploads();
});
after(() => {
  server.close();
  runner._reset();
  temp.close();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
});

type Row = { item: string; inFile: boolean; same: boolean; problems: string[]; warnings: string[]; count: number | null };

const webp = (width: number) =>
  sharp({ create: { width, height: Math.round((width * 9) / 16), channels: 3, background: { r: 30, g: 60, b: 90 } } })
    .webp()
    .toBuffer();

/** 다 만든 배경(파일까지). 원본 · 미리보기 같은 내지 않는 파일도 하나씩 둔다 */
async function made(kind: "image" | "video", name: string) {
  const one = store.create({ kind, from: "upload", name });
  const folder = store.folderOf(one.id);
  const write = (rel: string, data: Buffer | string) => {
    fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
    fs.writeFileSync(path.join(folder, rel), data);
  };
  write("still-1280.webp", await webp(1280));
  write("source", "원본");
  one.media = { stills: [1280], color: "#336699", scenes: [], rungs: {} };
  one.edit = { crop: { x: 0, y: 0, w: 1, h: 1 }, range: null, thumbAt: null };
  Object.assign(one, { width: 1920, height: 1080, appliedAt: Date.now() });
  if (kind === "video") {
    write("h264/index.m3u8", '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=2400000,CODECS="avc1.64001f",RESOLUTION=1280x720\n720/index.m3u8\n');
    write("h264/720/index.m3u8", '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2.0,\nseg-000.m4s\n#EXT-X-ENDLIST\n');
    write("h264/720/init.mp4", "init");
    write("h264/720/seg-000.m4s", "segment");
    one.media.rungs = { h264: [{ width: 1280, height: 720, codecs: "avc1.64001f", bandwidth: 2_400_000, frameRate: 30 }] };
    one.media.scenes = [{ at: 0, color: "#112233" }];
    Object.assign(one, { duration: 8, fps: 30 });
  }
  one.done = [...one.stages];
  one.bytes = store.folderBytes(one.id);
  store.save();
  return one;
}

async function exported() {
  // 두 걸음: 한 번 쓰는 주소를 받아 그 주소를 내려받는다
  const ticket = await fetch(`${base}/export?kind=login-background`, { method: "POST" });
  assert.equal(ticket.status, 200);
  const res = await fetch(`${baseUrl(server)}${((await ticket.json()) as { url: string }).url}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /musicbot-login-background-\d{8}-\d{4}\.zip/);
  return Buffer.from(await res.arrayBuffer());
}
async function preview(file: Buffer) {
  const res = await fetch(`${base}/preview`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: file });
  const json = (await res.json()) as { token: string; kind: string; rows: Row[]; code?: string };
  return { status: res.status, json, row: json.rows?.[0] };
}
async function imported(file: Buffer) {
  const { json } = await preview(file);
  return fetch(`${base}/import?items=login-background&token=${json.token}`, { method: "POST" });
}
const indexOf = (file: Buffer) =>
  JSON.parse(
    unzip(file)
      .find((one) => one.name === "login-background/index.json")!
      .data.toString("utf8"),
  ) as Index;
/** 파일의 항목을 바꿔 다시 묶는다 */
const rezip = (file: Buffer, change: (entries: Array<{ name: string; data: Buffer }>) => Array<{ name: string; data: Buffer }>) => zip(change(unzip(file)));

test("내보내기: 다 만든 배경의 내는 파일과 기록만. 만드는 중인 배경 · 원본은 담지 않고, 지금 배경이 만드는 중이면 그 전에 쓰던 배경을 지금 배경으로", async () => {
  const image = await made("image", "그림");
  const video = await made("video", "영상");
  store.show(video.id);
  const making = store.create({ kind: "video", from: "upload", name: "만드는 중" });
  store.show(making.id);
  store.save();

  const file = await exported();
  const names = unzip(file).map((one) => one.name);
  assert.deepEqual(names.slice(0, 2), ["settings.json", "login-background/index.json"]);
  assert.deepEqual(names.slice(2).sort(), [`${image.id}/still-1280.webp`, `${video.id}/h264/720/index.m3u8`, `${video.id}/h264/720/init.mp4`, `${video.id}/h264/720/seg-000.m4s`, `${video.id}/h264/index.m3u8`, `${video.id}/still-1280.webp`].map((rel) => `login-background/${rel}`).sort());
  const json = JSON.parse(unzip(file)[0].data.toString("utf8")) as Record<string, unknown>;
  assert.equal(json.kind, "login-background");
  const index = indexOf(file);
  assert.deepEqual(
    index.items.map((one) => one.name),
    ["영상", "그림"],
  );
  assert.equal(index.current, video.id, "만드는 중인 지금 배경 대신 그 전에 쓰던 것");
  assert.ok(index.items.every((one) => one.stage === null && one.estimate === null && !one.resumed));
});

test("자기 내보내기를 미리 보면 같다. 미리 보기 줄은 로그인 배경 하나", async () => {
  const one = await made("video", "영상");
  store.show(one.id);
  const { json, row } = await preview(await exported());
  assert.equal(json.kind, "login-background");
  assert.equal(json.rows.length, 1);
  assert.deepEqual([row.item, row.inFile, row.same, row.problems, row.count], ["login-background", true, true, [], 1]);
});

test("불러오기는 통째로 바꾼다: 새 id 로 풀고 지금 배경 · 화면 값 · 한도를 되살리며, 지금 기록(만드는 중인 것까지)은 지운다", async () => {
  const image = await made("image", "그림");
  const video = await made("video", "영상");
  store.show(video.id);
  store.loaded().options = { ...store.loaded().options, blur: 1.2 };
  store.loaded().limits = { history: 3, maxBytes: 0 };
  image.link = "javascript:alert(1)";
  video.link = "https://example.com/clip.mp4";
  store.save();
  const file = await exported();

  // 다른 기록으로 바꿔 놓는다
  fs.rmSync(bgDir, { recursive: true, force: true });
  store._useDir(bgDir);
  const other = await made("image", "다른 그림");
  store.show(other.id);
  store.create({ kind: "video", from: "upload", name: "만드는 중" });
  store.save();
  const oldIds = store.items().map((one) => one.id);

  const { row } = await preview(file);
  assert.deepEqual([row.same, row.problems], [false, []]);
  assert.deepEqual(row.warnings, ["지금 배경 2개를 모두 지우고 파일의 배경으로 바꿔요.", "만들고 있는 배경 1개도 멈추고 지워요."]);

  const res = await imported(file);
  assert.equal(res.status, 200);
  const now = store.items();
  assert.deepEqual(
    now.map((one) => one.name),
    ["영상", "그림"],
  );
  assert.ok(
    now.every((one) => ![image.id, video.id, ...oldIds].includes(one.id)),
    "새 id",
  );
  assert.deepEqual(
    now.map((one) => one.link),
    ["https://example.com/clip.mp4", null],
    "링크는 http · https 만",
  );
  for (const id of oldIds) assert.equal(fs.existsSync(store.folderOf(id)), false, "옛 배경의 폴더는 지운다");
  const shown = store.find(store.loaded().current!)!;
  assert.equal(shown.name, "영상");
  assert.ok(fs.existsSync(path.join(store.folderOf(shown.id), "h264/720/seg-000.m4s")));
  assert.equal(shown.bytes, store.folderBytes(shown.id));
  assert.deepEqual([store.loaded().options.blur, store.loaded().limits], [1.2, { history: 3, maxBytes: 0 }]);
  assert.deepEqual([publicOf().kind, (publicOf() as { id: string }).id], ["video", shown.id], "로그인 화면이 새 배경을 받는다");
  assert.equal(fs.readdirSync(uploadDir).length, 1, "가져온 파일은 지운다(남은 것은 앞서 미리 보기만 하고 닫지 않은 것)");

  const again = await preview(file);
  assert.equal(again.row.same, true, "불러온 뒤에는 같다(id 가 아니라 만든 때 · 이름 · 파일로 본다)");
});

test("남이 준 파일: 모르는 파일 · 기록에 없는 배경 · 빠진 정지 그림 · 바깥을 가리키는 목록 · WebP 가 아닌 그림은 받지 않고 아무것도 바꾸지 않는다", async () => {
  const one = await made("video", "영상");
  store.show(one.id);
  const file = await exported();
  const at = (rel: string) => `login-background/${one.id}/${rel}`;
  const cases: Array<[Buffer, RegExp]> = [
    [rezip(file, (entries) => [...entries, { name: at("source"), data: Buffer.from("원본") }]), /모르는 파일/],
    [rezip(file, (entries) => [...entries, { name: "login-background/abcdefghijklmnopqrstuvwx/still-1280.webp", data: Buffer.from("x") }]), /모르는 파일/],
    [rezip(file, (entries) => entries.filter((entry) => entry.name !== at("still-1280.webp"))), /정지 그림\(still-1280\.webp\)이 없습니다/],
    [rezip(file, (entries) => entries.map((entry) => (entry.name === at("h264/720/index.m3u8") ? { ...entry, data: Buffer.from("#EXTM3U\nhttps://evil.example/seg.m4s\n") } : entry))), /목록을 쓸 수 없습니다/],
    [rezip(file, (entries) => entries.map((entry) => (entry.name === at("h264/720/index.m3u8") ? { ...entry, data: Buffer.from('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://evil.example/key"\nseg-000.m4s\n') } : entry))), /목록을 쓸 수 없습니다/],
    [rezip(file, (entries) => entries.map((entry) => (entry.name === at("still-1280.webp") ? { ...entry, data: Buffer.from("그림 아님") } : entry))), /그 폭의 WebP 가 아닙니다/],
  ];
  for (const [bad, why] of cases) {
    const { row } = await preview(bad);
    assert.match(row.problems.join(), why);
    const res = await imported(bad);
    assert.equal(res.status, 400);
  }
  const index = indexOf(file);
  index.items[0].done = ["receive"];
  const unfinished = rezip(file, (entries) => entries.map((entry) => (entry.name === "login-background/index.json" ? { ...entry, data: Buffer.from(JSON.stringify(index)) } : entry)));
  assert.match((await preview(unfinished)).row.problems.join(), /다 만든 배경의 꼴이 아닌 기록/);
  index.items[0].done = [...one.stages];
  index.items[0].media.color = "url(https://evil.example)";
  const colored = rezip(file, (entries) => entries.map((entry) => (entry.name === "login-background/index.json" ? { ...entry, data: Buffer.from(JSON.stringify(index)) } : entry)));
  assert.match((await preview(colored)).row.problems.join(), /다 만든 배경의 꼴이 아닌 기록/);

  assert.deepEqual(
    store.items().map((one) => one.id),
    [one.id],
    "그대로",
  );
  assert.equal(fs.readdirSync(bgDir).filter((name) => name !== "index.json").length, 1, "풀다 만 폴더가 없다");
});

test("배경이 없는 파일을 불러오면 기록이 비고 로그인 화면은 봇 프로필 그림으로", async () => {
  const file = await exported();
  assert.deepEqual(indexOf(file).items, []);
  const one = await made("image", "그림");
  store.show(one.id);
  store.save();
  const { row } = await preview(file);
  assert.deepEqual([row.count, row.warnings.at(-1)], [0, "파일에 배경이 없어 로그인 화면이 봇 프로필 그림으로 돌아가요."]);
  assert.equal((await imported(file)).status, 200);
  assert.deepEqual([store.items(), publicOf()], [[], { kind: "none" }]);
});

test("풀다 실패하면(내용이 깨졌다) 푼 것을 지우고 지금 기록은 그대로", async () => {
  const one = await made("video", "영상");
  store.show(one.id);
  store.save();
  const file = await exported();
  // 조각의 몸통을 바꾼다(목차의 CRC 와 어긋나 풀 때 걸린다)
  const at = file.indexOf(Buffer.from("segment"));
  file[at] ^= 0xff;
  assert.deepEqual((await preview(file)).row.problems, [], "미리 보기는 목차 · 목록 · 그림만 본다");
  const res = await imported(file);
  assert.deepEqual([res.status, ((await res.json()) as { code: string }).code], [400, "bad-archive"]);
  assert.deepEqual(
    store.items().map((item) => item.id),
    [one.id],
  );
  assert.deepEqual(fs.readdirSync(bgDir).sort(), [one.id, "index.json"].sort());
});
