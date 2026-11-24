// src/dashboard/routes/vendor.ts: 업데이트 탭 yt-dlp 카드의 API(상태, 확인, 업데이트, 채널과 모드, 버전 고정, 이전 버전으로 되돌리기).
// 실 라우터와 실 yt-dlp 관리 객체에 가짜 입출력을 넘긴다(릴리스, GitHub은 가짜, 폴더는 임시). 설정값은 임시 설정 DB

process.env.OWNER_ID = "owner";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import { fake } from "../helpers/fake.ts";
import type { VendorReply } from "../../src/dashboard/contract/admin.ts";
import type { YtdlpBinaryIo } from "../../src/sources/ytdlp-binary.ts";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { requestJson } = await import("../helpers/dashboard.ts");
type ProblemReply = import("../helpers/dashboard.ts").ProblemReply;
const { openTempStore } = await import("../helpers/temp-store.ts");
const config = (await import("../../src/config/index.ts")).default;
const tunables = await import("../../src/store/tunables.ts");
const { bodyLimit } = await import("../../src/dashboard/body-limit.ts");
const { vendorRouter } = await import("../../src/dashboard/routes/vendor.ts");
const { ytdlpBinary, lockFolder } = await import("../../src/sources/ytdlp-binary.ts");
const { onTunablesChanged } = await import("../../src/config/tunables-changed.ts");
const { RECENT_LOGIN_MS } = await import("../../src/dashboard/contract/identity.ts");
const sink = (await import("../../src/infra/log/sink.ts")).default;

const store = openTempStore("vendor-");
// 로그인한 지 오래된 세션으로 바꿔 본다
let loginAt = () => Date.now();
const app = express();
app.use(bodyLimit());
app.use((req: Request, _res: Response, next: NextFunction) => {
  req.session = fake<Request["session"]>({ user: { id: "owner", username: "owner" }, loginAt: loginAt() });
  next();
});
app.use("/api/admin/vendor", vendorRouter);
const server = await listenForFetch(app);
const base = baseUrl(server);

const realIo = ytdlpBinary.io;
let root = "";
let latest = "2026.09.27.232849";
const fetches: string[] = [];
// 조립(app/main)이 하는 연결: 설정값이 바뀌면 yt-dlp가 새 설정으로 맞춘다
const off = onTunablesChanged(() => void ytdlpBinary.onSettingsChanged());
const dirOf = () => path.join(root, "yt-dlp");

function seed(version: string, state: object = {}) {
  fs.mkdirSync(path.join(dirOf(), version), { recursive: true });
  fs.writeFileSync(path.join(dirOf(), version, "yt-dlp.exe"), version);
  fs.writeFileSync(path.join(dirOf(), "state.json"), JSON.stringify({ version, previous: null, lastChecked: 0, unusable: null, ...state }));
}

beforeEach(() => {
  loginAt = () => Date.now();
  store.settings().exec("DELETE FROM documents");
  tunables.load();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vendor-route-"));
  latest = "2026.09.27.232849";
  fetches.length = 0;
  seed("2026.08.19");
  const io: YtdlpBinaryIo = {
    dir: dirOf(),
    asset: () => ({ zip: "yt-dlp_win.zip", exe: "yt-dlp.exe" }),
    fetch: async ({ tag, staging }) => {
      fetches.push(tag);
      fs.mkdirSync(path.join(staging, "dir"), { recursive: true });
      fs.writeFileSync(path.join(staging, "dir", "yt-dlp.exe"), tag);
    },
    run: async (file) => ({ kind: "exited", status: 0, stdout: `${fs.readFileSync(file, "utf8")}\n`, stderr: "" }),
    latestTag: async () => latest,
    now: () => Date.now(),
    pid: process.pid,
    isAlive: () => true,
    inUse: () => false,
    lock: () => lockFolder(dirOf()),
  };
  Object.assign(ytdlpBinary, { io, state: null, stamp: null, seen: {}, failure: null, pending: null, warned: null, generation: 0, started: true });
  ytdlpBinary.settings = `${config.ytdlp.channel}|${config.ytdlp.update}|${config.ytdlp.version ?? ""}`;
});

// 다음 테스트가 폴더와 설정을 바꾸기 전에 백그라운드에서 도는 것을 끝낸다
afterEach(settled);

after(async () => {
  off();
  ytdlpBinary.stop();
  Object.assign(ytdlpBinary, { io: realIo, state: null, stamp: null, seen: {}, failure: null, started: false });
  store.settings().exec("DELETE FROM documents");
  tunables.load();
  server.close();
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const req = <T = VendorReply>(method: string, urlPath = "", body?: unknown) => requestJson<T>(base, method, `/api/admin/vendor${urlPath}`, body);
// 백그라운드에서 도는 맞추기가 끝날 때까지(라우트는 시작만 하고 응답한다)
async function settled() {
  for (let i = 0; i < 20; i++) {
    await new Promise((done) => setTimeout(done, 5));
    while (ytdlpBinary.converging || ytdlpBinary.busy) await (ytdlpBinary.converging ?? ytdlpBinary.busy);
  }
}
const versionNow = async () => (await req("GET")).json.status.ytdlp.version;

test("상태: 설치된 버전, 채널, 모드, 고정, 되돌릴 수 있는지", async () => {
  const { status, json } = await req("GET");
  assert.equal(status, 200);
  assert.deepEqual(json.status.ytdlp, { version: "2026.08.19", previous: null, channel: "nightly", mode: "auto", pin: null, seen: null, nextAt: null, busy: null, failure: null, canRollback: false });
});

test("확인은 최신을 보이기만 하고, 업데이트는 확인한 그 태그만 다운로드한다", async () => {
  assert.equal((await req<ProblemReply>("POST", "/ytdlp/update", { channel: "nightly", tag: latest })).json.code, "tool-check-stale", "확인 전");
  const checked = await req("POST", "/ytdlp/check");
  assert.equal(checked.json.status.ytdlp.seen?.latest, latest);
  assert.deepEqual([checked.json.status.ytdlp.version, fetches.length], ["2026.08.19", 0]);

  assert.equal((await req<ProblemReply>("POST", "/ytdlp/update", { channel: "nightly", tag: "2021.01.01" })).json.code, "tool-check-stale", "확인한 적 없는 태그");
  const started = await req("POST", "/ytdlp/update", { channel: "nightly", tag: latest });
  assert.equal(started.status, 202);
  await settled();
  assert.equal(await versionNow(), latest);
  assert.ok(sink.buffer.some((e) => e.level === "warn" && e.text.includes(`대시보드에서 yt-dlp 업데이트: ${latest}(nightly). 실행 owner`)));
});

test("최신 조회가 실패하면 tool-check-failed와 원인", async () => {
  ytdlpBinary.io = { ...ytdlpBinary.io, latestTag: async () => Promise.reject(new Error("GitHub 최신 릴리스 조회 503")) };
  const res = await req<ProblemReply>("POST", "/ytdlp/check");
  assert.deepEqual([res.status, res.json.code, res.json.detail], [502, "tool-check-failed", undefined]);
  assert.deepEqual(res.json.errors?.[0]?.rule, { code: "plain", params: { text: "GitHub 최신 릴리스 조회 503" } });
});

test("채널, 자동 업데이트는 저장 바에서 저장한다. 저장하면 새 설정으로 맞춘다(수동이면 다운로드하지 않는다)", async () => {
  tunables.save({ YTDLP_UPDATE: "manual" }, tunables.view().revision);
  await settled();
  assert.equal((await req("GET")).json.status.ytdlp.mode, "manual");
  assert.equal(fetches.length, 0, "수동 모드에서는 자동으로 다운로드하지 않는다");

  latest = "2026.09.30";
  // 저장 바는 필드 전부를 보낸다(빠진 필드는 기본값)
  tunables.save({ YTDLP_CHANNEL: "stable", YTDLP_UPDATE: "manual" }, tunables.view().revision);
  await settled();
  assert.deepEqual([await versionNow(), fetches.length], ["2026.08.19", 0], "수동이면 채널을 바꿔도 다운로드하지 않는다");

  tunables.save({ YTDLP_CHANNEL: "stable", YTDLP_UPDATE: "auto" }, tunables.view().revision);
  await settled();
  assert.equal(await versionNow(), "2026.09.30", "자동으로 저장하면 그 채널의 최신으로 맞춘다");
});

test("버전 고정: 그 버전으로 맞추고, 고정한 동안 업데이트는 거절한다. 해제하면 자동 모드는 다시 최신으로", async () => {
  const pinned = await req("POST", "/ytdlp/pin", { version: "2026.09.01", expect: null });
  assert.equal(pinned.status, 202);
  assert.equal(pinned.json.tunables?.values.YTDLP_VERSION, "2026.09.01");
  await settled();
  assert.deepEqual([await versionNow(), fetches], ["2026.09.01", ["2026.09.01"]]);

  await req("POST", "/ytdlp/check");
  assert.equal((await req<ProblemReply>("POST", "/ytdlp/update", { channel: "nightly", tag: latest })).json.code, "tool-version-pinned");
  assert.equal((await req<ProblemReply>("POST", "/ytdlp/pin", { version: "최신" })).json.code, "config-invalid");
  assert.equal((await req<ProblemReply>("POST", "/ytdlp/pin", { version: "2026.09.02", expect: null })).json.code, "config-changed");

  assert.equal((await req("POST", "/ytdlp/pin", { version: null, expect: "2026.09.01" })).status, 202);
  await settled();
  assert.equal(await versionNow(), latest);
});

test("이전 버전 삭제(외부 프로그램 이전 버전 카드의 yt-dlp 줄): 기록에서 빼고 폴더를 정리한다. 그 뒤로는 되돌릴 수 없다", async () => {
  seed("2026.09.27.232849", { previous: "2026.08.19", channel: "nightly", previousChannel: "nightly" });
  assert.equal((await req("GET")).json.status.ytdlp.canRollback, true);
  const done = await req<Array<{ tool: string; versions: string[]; deferred: boolean }>>("POST", "/old-versions", { tool: "ytdlp" });
  assert.equal(done.status, 200);
  assert.deepEqual(
    done.json.map((t) => [t.tool, t.versions, t.deferred]),
    [["ytdlp", ["2026.08.19"], false]],
  );
  assert.equal((await req("GET")).json.status.ytdlp.canRollback, false);
  assert.equal(fs.existsSync(path.join(dirOf(), "2026.08.19")), false, "폴더도 정리한다");
  assert.equal((await req<ProblemReply>("POST", "/ytdlp/rollback")).json.code, "tool-no-previous", "다시 다운로드해 되돌리지도 못한다");
  assert.deepEqual((await req("POST", "/old-versions", { tool: "ytdlp" })).json, [], "더 삭제할 것이 없다");
  assert.equal((await req<ProblemReply>("POST", "/old-versions", { tool: "모름" })).json.code, "bad-request");
  assert.ok(sink.buffer.some((e) => e.level === "warn" && e.text.includes("외부 프로그램 이전 버전 삭제: yt-dlp 2026.08.19")));
});

test("최근 로그인은 버전을 직접 입력해 고정할 때만 요구한다. 고정 해제, 되돌리기, 확인은 요구하지 않는다", async () => {
  seed("2026.09.27.232849", { previous: "2026.08.19", channel: "nightly", previousChannel: "nightly" });
  loginAt = () => Date.now() - RECENT_LOGIN_MS - 1000;
  const refused = await req<ProblemReply>("POST", "/ytdlp/pin", { version: "2026.09.01" });
  assert.deepEqual([refused.status, refused.json.code], [403, "reauth-required"]);
  assert.equal(config.ytdlp.version, null);
  assert.equal((await req("POST", "/ytdlp/check")).status, 200);
  assert.equal((await req("POST", "/ytdlp/rollback")).status, 202, "바로 전에 설치했던 버전 하나로만 간다");
  await settled();
  assert.equal(config.ytdlp.version, "2026.08.19");
  assert.equal((await req("POST", "/ytdlp/pin", { version: null })).status, 202, "해제는 최신 쪽으로 간다");
  assert.equal(config.ytdlp.version, null);
});

test("이전 버전으로 되돌리기: 기록의 이전 버전을 고정한다. 다른 채널에서 다운로드한 것이면 채널도 함께 바꾼다", async () => {
  assert.equal((await req<ProblemReply>("POST", "/ytdlp/rollback")).json.code, "tool-no-previous");

  seed("2026.09.27.232849", { previous: "2026.08.19", channel: "nightly", previousChannel: "stable" });
  assert.equal((await req("GET")).json.status.ytdlp.canRollback, true);
  const back = await req("POST", "/ytdlp/rollback");
  assert.equal(back.status, 202);
  assert.deepEqual(back.json.tunables?.values, { YTDLP_CHANNEL: "stable", YTDLP_VERSION: "2026.08.19" });
  await settled();
  const now = (await req("GET")).json.status.ytdlp;
  assert.deepEqual([now.version, now.pin, now.channel, now.previous, fetches.length], ["2026.08.19", "2026.08.19", "stable", "2026.09.27.232849", 0], "남겨 둔 이전 버전 폴더를 다시 쓴다(다운로드하지 않는다)");
});
