// src/dashboard/audio-cache-archive.ts — 오디오 캐시 내보내기 · 불러오기. 내보낸 것을 비운 캐시에 합쳐 되돌리고, 있는 것은 이 봇의 것을 두며(직접 지정한 음원은 덮는다),
// 캐시 상한 안에서 퇴거 점수가 낮은 것부터 가져온다. 내보내는 동안 담을 파일은 지킨다. 받은 이름이 아니라 키로 이 봇의 자리에 둔다.

process.env.OWNER_ID = "owner";

import fs from "node:fs";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { fake } = await import("../helpers/fake.ts");
const { openTempStore } = await import("../helpers/temp-store.ts");
const { zip, unzip } = await import("../../src/infra/zip.ts");
const { default: config } = await import("../../src/config/index.ts");
const audioCache = await import("../../src/store/audio-cache.ts");
const trackLookup = await import("../../src/store/track-lookup.ts");
const pinnedSources = await import("../../src/store/pinned-sources.ts");
const externalCaches = await import("../../src/store/external-caches.ts");
const { AUDIO_CACHE_PARTS } = await import("../../src/rules/audio-cache-parts.ts");
const uploads = await import("../../src/dashboard/archive-uploads.ts");
const archive = await import("../../src/dashboard/settings-archive.ts");
const { settingsArchiveRouter } = await import("../../src/dashboard/routes/settings-archive.ts");

const store = openTempStore("audio-cache-archive-");
const uploadDir = fs.mkdtempSync(`${store.dir}-upload`);
uploads._useDir(uploadDir);
const app = express();
app.use((req, _res, next) => {
  req.session = fake<typeof req.session>({ user: { id: "owner", username: "owner" }, loginAt: Date.now() });
  next();
});
app.use("/api/admin/settings-archive", settingsArchiveRouter);
const server = await listenForFetch(app);
const base = `${baseUrl(server)}/api/admin/settings-archive`;
const saved = { ...config.cache };
after(() => {
  Object.assign(config.cache, saved);
  server.close();
  store.close();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;
function seedFile(key: string, bytes: number, plays: number, lastPlayedAt: number) {
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
  const file = audioCache.getFilePath(key);
  fs.writeFileSync(file, Buffer.alloc(bytes, key.length));
  audioCache.recordDownloadStart(key, { title: key });
  audioCache.recordDownloadComplete(key, file, bytes, { title: key });
  store.db().prepare("UPDATE audio_cache SET play_count = ?, last_played_at = ? WHERE audio_key = ?").run(plays, lastPlayedAt, key);
}
const ledger = (requestKey: string, audioUrl: string, title: string, verified = false) => trackLookup.recordTrackLookup({ requestKey, pageUrl: requestKey, audioUrl, platform: "youtube", title }, { verified });

beforeEach(async () => {
  Object.assign(config.cache, saved, { maxSizeBytes: 1e12, maxFiles: 1000, minFreeDiskBytes: 0 });
  await audioCache.resetCache(AUDIO_CACHE_PARTS);
  uploads.sweepUploads();
});

async function exported(files = true) {
  const ticket = await fetch(`${base}/export?kind=audio-cache${files ? "" : "&files=0"}`, { method: "POST" });
  assert.equal(ticket.status, 200);
  const res = await fetch(`${baseUrl(server)}${((await ticket.json()) as { url: string }).url}`);
  assert.equal(res.status, 200);
  return Buffer.from(await res.arrayBuffer());
}
type Row = { item: string; inFile: boolean; breakdown?: { added: number; existing: number; changed: number; overLimit: number; bytes: number | null } };
async function preview(file: Buffer) {
  const res = await fetch(`${base}/preview`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: file });
  return (await res.json()) as { token: string; kind: string; rows: Row[]; room?: number };
}
const breakdownOf = (shown: { rows: Row[] }, item: string) => shown.rows.find((one) => one.item === item)?.breakdown;
async function importAll(file: Buffer, items = "audio-files,audio-ledger,audio-pins,audio-age,audio-sponsorblock") {
  const { token } = await preview(file);
  const res = await fetch(`${base}/import?items=${items}&token=${token}`, { method: "POST" });
  return { status: res.status, json: (await res.json()) as { added?: Record<string, number> } };
}

test("내보내기: settings.json · 캐시 파일 · 마지막의 행 목록. 캐시 파일 제외면 행 목록만(링크 데이터는 그대로)", async () => {
  seedFile("yt:aaaaaaaaaa1", 300, 2, 1000);
  ledger(yt("aaaaaaaaaa1"), yt("aaaaaaaaaa1"), "하나");
  ledger("https://open.spotify.com/track/x", yt("aaaaaaaaaa2"), "파일 없는 곡");
  const names = unzip(await exported(), { maxBytes: 10_000_000 }).map((one) => one.name);
  assert.deepEqual(names, ["settings.json", `audio-cache/files/${audioCache.getFilePath("yt:aaaaaaaaaa1").split(/[\\/]/).pop()}`, "audio-cache/rows.json"]);

  const bare = unzip(await exported(false), { maxBytes: 10_000_000 });
  assert.deepEqual(
    bare.map((one) => one.name),
    ["settings.json", "audio-cache/rows.json"],
  );
  const rows = JSON.parse(bare[1].data.toString("utf8")) as { files: unknown[]; ledger: unknown[] };
  assert.deepEqual([rows.files.length, rows.ledger.length], [0, 2]);
});

test("담기 전에 사라진 캐시 파일은 건너뛰고 행 목록에서도 뺀다", async () => {
  seedFile("yt:aaaaaaaaaa1", 100, 1, 1);
  seedFile("yt:aaaaaaaaaa2", 100, 1, 1);
  fs.rmSync(audioCache.getFilePath("yt:aaaaaaaaaa2"));
  const entries = unzip(await exported(), { maxBytes: 10_000_000 });
  assert.equal(entries.filter((one) => one.name.startsWith("audio-cache/files/")).length, 1);
  const rows = JSON.parse(entries.find((one) => one.name === "audio-cache/rows.json")!.data.toString("utf8")) as { files: Array<{ audioKey: string }> };
  assert.deepEqual(
    rows.files.map((one) => one.audioKey),
    ["yt:aaaaaaaaaa1"],
  );
});

test("되돌리기: 비운 캐시에 파일 · 재생 기록 · 링크 데이터 · 직접 지정한 음원 · 연령 제한 · SponsorBlock 이 돌아온다", async () => {
  seedFile("yt:aaaaaaaaaa1", 300, 4, 5000);
  ledger(yt("aaaaaaaaaa1"), yt("aaaaaaaaaa1"), "하나");
  pinnedSources.setPin("https://open.spotify.com/track/p", "https://soundcloud.com/a/b", 77);
  externalCaches.markAgeRestricted("aaaaaaaaaa1");
  externalCaches.setSponsorSegments("aaaaaaaaaa1", [{ segment: [0, 5] }]);
  const file = await exported();

  await audioCache.resetCache(AUDIO_CACHE_PARTS);
  const shown = await preview(file);
  assert.equal(shown.kind, "audio-cache");
  assert.equal(typeof shown.room, "number");
  assert.deepEqual(breakdownOf(shown, "audio-files"), { added: 1, existing: 0, changed: 0, overLimit: 0, bytes: 300 });

  const { status, json } = await importAll(file);
  assert.equal(status, 200);
  assert.deepEqual(json.added, { "audio-age": 1, "audio-files": 1, "audio-ledger": 1, "audio-pins": 1, "audio-sponsorblock": 1 });
  const row = audioCache.lookupByAudioKey("yt:aaaaaaaaaa1")!;
  assert.deepEqual([row.status, row.file_path, row.file_size_bytes, row.play_count, row.last_played_at], ["cached", audioCache.getFilePath("yt:aaaaaaaaaa1"), 300, 4, 5000]);
  assert.equal(fs.statSync(audioCache.getFilePath("yt:aaaaaaaaaa1")).size, 300);
  assert.equal(trackLookup.getAudioUrl(yt("aaaaaaaaaa1")), yt("aaaaaaaaaa1"));
  assert.deepEqual(pinnedSources.getPin("https://open.spotify.com/track/p"), { requestKey: "https://open.spotify.com/track/p", audioUrl: "https://soundcloud.com/a/b", pinnedAt: 77 });
  assert.equal(externalCaches.isAgeRestricted("aaaaaaaaaa1"), true);
  assert.ok(externalCaches.getSponsorSegments("aaaaaaaaaa1"));
  assert.deepEqual(
    fs.readdirSync(audioCache.cacheDir()).filter((name) => name.includes(".tmp-")),
    [],
    "임시 파일이 남지 않는다",
  );
});

test("합치기: 이 봇의 링크 데이터를 두고(같은 음원이면 확인된 제목만), 직접 지정한 음원은 덮고, 있는 파일은 재생 기록을 큰 쪽으로", async () => {
  seedFile("yt:aaaaaaaaaa1", 300, 9, 9000);
  ledger(yt("aaaaaaaaaa1"), yt("aaaaaaaaaa1"), "확인된 제목", true);
  ledger("https://open.spotify.com/track/s", yt("aaaaaaaaaa2"), "파일의 결과");
  pinnedSources.setPin("https://open.spotify.com/track/p", "https://soundcloud.com/from/file", 1);
  const file = await exported();

  store.db().prepare("UPDATE audio_cache SET play_count = 2, last_played_at = 100").run();
  ledger(yt("aaaaaaaaaa1"), yt("aaaaaaaaaa1"), "낡은 제목");
  store.db().prepare("UPDATE track_lookup SET title_verified = 0 WHERE request_key = ?").run(yt("aaaaaaaaaa1"));
  ledger("https://open.spotify.com/track/s", yt("aaaaaaaaaa3"), "이 봇의 새 결과");
  pinnedSources.setPin("https://open.spotify.com/track/p", "https://soundcloud.com/mine", 2);

  const shown = await preview(file);
  assert.deepEqual(breakdownOf(shown, "audio-files"), { added: 0, existing: 1, changed: 0, overLimit: 0, bytes: 0 });
  assert.deepEqual(breakdownOf(shown, "audio-pins"), { added: 0, existing: 0, changed: 1, overLimit: 0, bytes: null });
  const { json } = await importAll(file, "audio-files,audio-ledger,audio-pins");
  assert.deepEqual([json.added?.["audio-files"], json.added?.["audio-ledger"], json.added?.["audio-pins"]], [0, 0, 0]);

  const row = audioCache.lookupByAudioKey("yt:aaaaaaaaaa1")!;
  assert.deepEqual([row.play_count, row.last_played_at], [9, 9000]);
  assert.equal(trackLookup.getAudioUrl("https://open.spotify.com/track/s"), yt("aaaaaaaaaa3"), "이 봇의 더 새 결과를 둔다");
  assert.equal(trackLookup.displayOf("https://open.spotify.com/track/s")?.title, "이 봇의 새 결과", "음원이 다르면 표시 열도 두지 않는다");
  assert.equal(trackLookup.getVerifiedTitle(yt("aaaaaaaaaa1")), "확인된 제목", "같은 음원이면 확인된 제목을 앞세운다");
  assert.equal(pinnedSources.getPin("https://open.spotify.com/track/p")?.audioUrl, "https://soundcloud.com/from/file");
});

test("캐시 상한: 넘는 것은 가져오지 않고, 퇴거 점수가 낮은(자주 · 최근 튼) 것부터 가져온다", async () => {
  const now = Date.now();
  seedFile("yt:aaaaaaaaaa1", 100, 0, now - 90 * 86_400_000);
  seedFile("yt:aaaaaaaaaa2", 100, 30, now);
  seedFile("yt:aaaaaaaaaa3", 100, 5, now - 86_400_000);
  const file = await exported();
  await audioCache.resetCache(AUDIO_CACHE_PARTS);

  config.cache.maxFiles = 2;
  const shown = await preview(file);
  assert.deepEqual(breakdownOf(shown, "audio-files"), { added: 2, existing: 0, changed: 0, overLimit: 1, bytes: 200 });
  const { json } = await importAll(file, "audio-files");
  assert.equal(json.added?.["audio-files"], 2);
  assert.deepEqual(
    audioCache
      .allRows()
      .map((one) => one.audio_key)
      .sort(),
    ["yt:aaaaaaaaaa2", "yt:aaaaaaaaaa3"],
    "한 번도 틀지 않은 오래된 곡이 빠진다",
  );
});

test("내보내는 동안 담을 파일은 지킨다(퇴거 · 삭제가 지우지 않는다). 끝나면 푼다", async () => {
  seedFile("yt:aaaaaaaaaa1", 100, 1, 1);
  const downloadedAt = audioCache.lookupByAudioKey("yt:aaaaaaaaaa1")!.downloaded_at;
  const { release } = archive.build("audio-cache");
  try {
    assert.deepEqual(await audioCache.removeCached("yt:aaaaaaaaaa1", downloadedAt), { ok: false, code: "in-use", where: "exporting" });
    config.cache.maxFiles = 0.5;
    await audioCache.evict();
    assert.ok(audioCache.lookupByAudioKey("yt:aaaaaaaaaa1"), "퇴거가 건너뛴다");
  } finally {
    release();
    config.cache.maxFiles = 1000;
  }
  assert.equal((await audioCache.removeCached("yt:aaaaaaaaaa1", downloadedAt)).ok, true);
});

test("행 목록이 없거나 모양이 틀리면 bad-archive. 받은 이름이 폴더 밖을 가리키면 ZIP 읽기가 거절한다", async () => {
  seedFile("yt:aaaaaaaaaa1", 100, 1, 1);
  const file = await exported();
  const entries = unzip(file, { maxBytes: 10_000_000 });
  const noRows = zip(entries.filter((one) => one.name !== "audio-cache/rows.json"));
  const rows = JSON.parse(entries.find((one) => one.name === "audio-cache/rows.json")!.data.toString("utf8")) as { files: Array<{ audioKey: string }> };
  rows.files[0].audioKey = "../../x";
  const broken = zip(entries.map((one) => (one.name === "audio-cache/rows.json" ? { name: one.name, data: Buffer.from(JSON.stringify(rows)) } : one)));
  for (const bad of [noRows, broken]) {
    const res = await fetch(`${base}/preview`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: bad });
    assert.deepEqual([res.status, ((await res.json()) as { code: string }).code], [400, "bad-archive"]);
  }
});
