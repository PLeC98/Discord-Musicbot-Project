// src/dashboard/routes/vendor.ts: 업데이트 탭 bgutil 카드의 버전 조작(최신 확인, 태그의 커밋 확인, 고정과 해제).
// 실 라우터에 저장소 조회와 설치 작업은 가짜를 넘긴다. 설정값은 임시 설정 DB

process.env.OWNER_ID = "owner";

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import { fake } from "../helpers/fake.ts";
import type { BgutilResolveReply, VendorReply } from "../../src/dashboard/contract/admin.ts";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { requestJson } = await import("../helpers/dashboard.ts");
type ProblemReply = import("../helpers/dashboard.ts").ProblemReply;
const { openTempStore } = await import("../helpers/temp-store.ts");
const config = (await import("../../src/config/index.ts")).default;
const tunables = await import("../../src/store/tunables.ts");
const { bodyLimit } = await import("../../src/dashboard/body-limit.ts");
const { vendorRouter } = await import("../../src/dashboard/routes/vendor.ts");
const { bgutilRemote, RESOLVED_MS } = await import("../../src/sources/bgutil/remote.ts");
const { bgutilAutoInstall } = await import("../../src/sources/bgutil/auto-install.ts");
const { BGUTIL_COMMIT, BGUTIL_VERSION } = await import("../../src/config/vendor-versions.ts");
const { RECENT_LOGIN_MS } = await import("../../src/dashboard/contract/identity.ts");

const store = openTempStore("vendor-bgutil-");
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

const NEW = { tag: "2.0.3", commit: "b".repeat(40) };
const realRemote = bgutilRemote.io;
const realDeps = bgutilAutoInstall.deps;
let clock = 1_000;
let tags: Record<string, string> = {};
let latest: string | Error = "2.0.3";
let starts: string[][] = [];

beforeEach(() => {
  loginAt = () => Date.now();
  store.settings().exec("DELETE FROM documents");
  tunables.load();
  clock = 1_000;
  tags = { [NEW.tag]: NEW.commit };
  latest = "2.0.3";
  starts = [];
  bgutilRemote.io = {
    latest: async () => {
      if (latest instanceof Error) throw latest;
      return latest;
    },
    // ls-remote의 출력 모양(가벼운 태그)
    lsRemote: async ([ref]) => {
      const tag = ref.replace("refs/tags/", "");
      return tags[tag] ? `${tags[tag]}\trefs/tags/${tag}\n` : "";
    },
    now: () => clock,
  };
  Object.assign(bgutilRemote, { latest: null, resolved: new Map() });
  bgutilAutoInstall.deps = {
    savedEnabled: () => true,
    active: () => ({ tag: BGUTIL_VERSION, commit: BGUTIL_COMMIT }),
    target: () => ({ tag: config.bgutil.version, commit: config.bgutil.commit }),
    needs: async () => [],
    start: (spec) => {
      starts.push(spec.args);
      return { ok: true, id: starts.length };
    },
    cancel: async () => undefined,
    now: () => clock,
  };
  Object.assign(bgutilAutoInstall, { running: null, runningAuto: false, queued: false, wanted: false, attempted: new Set(), failure: null, missing: null, wasEnabled: null });
});

after(() => {
  bgutilRemote.io = realRemote;
  bgutilAutoInstall.deps = realDeps;
  Object.assign(bgutilAutoInstall, { running: null, wanted: false });
  store.settings().exec("DELETE FROM documents");
  tunables.load();
  server.close();
  store.close();
});

const req = <T = VendorReply>(method: string, urlPath = "", body?: unknown) => requestJson<T>(base, method, `/api/admin/vendor${urlPath}`, body);
const expectNow = () => ({ tag: config.bgutil.version, commit: config.bgutil.commit });

test("확인: 최신 릴리스 태그를 카드 상태에 싣고, 실패하면 tool-check-failed", async () => {
  assert.equal((await req("GET")).json.status.bgutil.latest, null);
  const checked = await req("POST", "/bgutil/check");
  assert.deepEqual(checked.json.status.bgutil.latest, { tag: "2.0.3", at: 1_000 });
  latest = new Error("GitHub 릴리스 조회 503");
  const failed = await req<ProblemReply>("POST", "/bgutil/check");
  assert.equal(failed.json.code, "tool-check-failed");
});

test("커밋 확인: 태그의 커밋을 돌려준다. 저장소에 없으면 bgutil-tag-missing, 태그 모양이 아니면 bad-request", async () => {
  const ok = await req<BgutilResolveReply>("POST", "/bgutil/resolve", { tag: NEW.tag });
  assert.deepEqual(ok.json, NEW);
  assert.equal((await req<ProblemReply>("POST", "/bgutil/resolve", { tag: "9.9.9" })).json.code, "bgutil-tag-missing");
  assert.equal((await req<ProblemReply>("POST", "/bgutil/resolve", { tag: "a..b" })).json.code, "bad-request");
  assert.equal(config.bgutil.pinned, false, "확인은 저장하지 않는다");
});

test("고정: 확인한 짝을 저장하고 받기를 시작한다. 해제하면 기본 짝으로 돌아가 다시 받는다", async () => {
  await req("POST", "/bgutil/resolve", { tag: NEW.tag });
  const pinned = await req("POST", "/bgutil/pin", { ...NEW, expect: expectNow() });
  assert.equal(pinned.status, 202);
  assert.deepEqual(pinned.json.tunables?.values, { BGUTIL_VERSION: NEW.tag, BGUTIL_COMMIT: NEW.commit });
  assert.deepEqual([config.bgutil.version, config.bgutil.commit, config.bgutil.pinned], [NEW.tag, NEW.commit, true]);
  assert.deepEqual(starts, [["--tag", NEW.tag, "--commit", NEW.commit]], "설치된 기본 짝과 달라 받는다");
  assert.equal(pinned.json.status.bgutil.job, "running");

  bgutilAutoInstall.running = null;
  const unpinned = await req("POST", "/bgutil/pin", { tag: null, expect: expectNow() });
  assert.equal(unpinned.status, 202);
  assert.deepEqual(unpinned.json.tunables?.values, {});
  assert.deepEqual([config.bgutil.version, config.bgutil.pinned], [BGUTIL_VERSION, false]);
  assert.equal(starts.length, 1, "설치된 것이 이미 기본 짝이다");
});

test("고정은 확인한 그 커밋만, 확인한 지 오래되지 않았을 때만 받는다", async () => {
  const stale = (body: object) => req<ProblemReply>("POST", "/bgutil/pin", { ...body, expect: expectNow() });
  assert.equal((await stale(NEW)).json.code, "bgutil-resolve-stale", "확인하지 않았다");
  await req("POST", "/bgutil/resolve", { tag: NEW.tag });
  assert.equal((await stale({ ...NEW, commit: "c".repeat(40) })).json.code, "bgutil-resolve-stale", "확인한 것과 다른 커밋");
  clock += RESOLVED_MS + 1;
  assert.equal((await stale(NEW)).json.code, "bgutil-resolve-stale", "오래됐다");
  assert.equal(config.bgutil.pinned, false);
  assert.deepEqual(starts, []);
});

test("고정, 해제는 최근 로그인을 요구하고, 화면이 보던 목표가 바뀌었거나 설치가 도는 중이면 거절한다", async () => {
  await req("POST", "/bgutil/resolve", { tag: NEW.tag });
  loginAt = () => Date.now() - RECENT_LOGIN_MS - 1000;
  assert.equal((await req<ProblemReply>("POST", "/bgutil/pin", { tag: null, expect: expectNow() })).json.code, "reauth-required");
  loginAt = () => Date.now();
  assert.equal((await req<ProblemReply>("POST", "/bgutil/pin", { ...NEW, expect: { tag: "2.0.1", commit: NEW.commit } })).json.code, "config-changed");
  bgutilAutoInstall.running = 7;
  assert.equal((await req<ProblemReply>("POST", "/bgutil/pin", { ...NEW, expect: expectNow() })).json.code, "bgutil-installing");
  bgutilAutoInstall.running = null;
  assert.equal(config.bgutil.pinned, false);
});
