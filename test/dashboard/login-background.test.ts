// src/dashboard/routes/login-background.ts · login-background/store.ts · runner.ts — 로그인 배경의 상태 기계.
// 단계 실행기는 테스트가 끝을 정하는 가짜다(단계마다 step 으로 끝낸다). 썸네일 먼저 · 굽기 순서 · 이전 배경 · 한도 · 막는 전이 · 실패 · 이어 하기를 본다

process.env.OWNER_ID = "owner";

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { signedInAs } from "../helpers/dashboard.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";
import type { Executor, StageResult } from "../../src/dashboard/login-background/runner.ts";
import { LOGIN_BG_STAGES, type LoginBackgroundItem, type LoginBackgroundStage, type LoginBackgroundState } from "../../src/dashboard/contract/login-background.ts";

const store = await import("../../src/dashboard/login-background/store.ts");
const runner = await import("../../src/dashboard/login-background/runner.ts");
const { loginBackgroundRouter } = await import("../../src/dashboard/routes/login-background.ts");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "login-background-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }));

const app = express();
app.use(express.json());
app.use(signedInAs(() => ({ id: "owner", username: "운영자" })));
app.use("/api/admin/appearance/login-background", loginBackgroundRouter);
const server = await listenForFetch(app);
after(() => server.close());
const A = `${baseUrl(server)}/api/admin/appearance/login-background`;

/** 도는 단계마다 끝낼 핸들. 실패를 넣으면 그 단계가 실패한다 */
const gates = new Map<string, { resolve: (value: StageResult) => void; reject: (error: Error) => void }>();
/** 다운로드 단계가 알아낸 원본(영상 10초) */
const RECEIVED: StageResult = { kind: "video", width: 1920, height: 1080, duration: 10, fps: 30 };

/** 가짜 실행기를 단다(skip 단계는 빼고) */
function useFakeExecutors(skip?: LoginBackgroundStage) {
  const executor =
    (stage: LoginBackgroundStage): Executor =>
    ({ item }) =>
      new Promise((resolve, reject) => {
        gates.set(item.id, { resolve, reject });
      }).then((result) => (stage === "receive" ? { ...RECEIVED, ...(result as StageResult) } : (result as StageResult)));
  runner.useExecutors(Object.fromEntries(LOGIN_BG_STAGES.filter((stage) => stage !== skip).map((stage) => [stage, executor(stage)])));
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const send = (method: string, url: string, json?: object) => fetch(`${A}${url}`, { method, headers: json ? { "content-type": "application/json" } : {}, body: json ? JSON.stringify(json) : undefined });
const state = async () => (await (await fetch(A)).json()) as LoginBackgroundState;
const item = async (id: string) => (await state()).list.find((one) => one.id === id)!;
const codeOf = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];
/** 그 배경의 도는 단계를 끝낸다 */
async function step(id: string, result: StageResult = {}) {
  await settle();
  const gate = gates.get(id);
  assert.ok(gate, `${id} 에 도는 단계가 없다`);
  gates.delete(id);
  gate.resolve(result);
  await settle();
}
/** 조건이 맞을 때까지 단계를 끝낸다 */
async function stepUntil(id: string, done: (one: LoginBackgroundItem) => boolean) {
  for (let i = 0; i < 20; i++) {
    if (done(await item(id))) return;
    await step(id);
  }
  assert.fail(`${id} 가 끝나지 않는다`);
}
const upload = async (name = "영상.mp4") => {
  const res = await fetch(`${A}/upload?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": "video/mp4" }, body: Buffer.alloc(1000, 1) });
  assert.equal(res.status, 200);
  return ((await res.json()) as LoginBackgroundState).list[0].id;
};
const EDIT = { crop: { x: 0, y: 0, w: 1, h: 1 }, range: [2, 8], thumbAt: 3 };
/** 올리고 편집을 적용한 배경 */
async function applied(name?: string) {
  const id = await upload(name);
  await stepUntil(id, (one) => one.phase === "editing");
  assert.equal((await send("PUT", `/${id}/edit`, EDIT)).status, 200);
  return id;
}
const ready = async (name?: string) => {
  const id = await applied(name);
  await stepUntil(id, (one) => one.phase === "ready");
  return id;
};
const brief = async () => {
  const s = await state();
  return { current: s.current, previous: s.previous, phases: Object.fromEntries(s.list.map((one) => [one.id, one.phase])) };
};

beforeEach(() => {
  runner._reset();
  gates.clear();
  fs.rmSync(DIR, { recursive: true, force: true });
  store._useDir(DIR);
  useFakeExecutors();
});

test("올리면 편집 전 단계를 하고 편집을 기다린다. 편집은 한 번만, 썸네일이 생기면 로그인 화면에 걸린다", async () => {
  const id = await upload("내 영상.mp4");
  let one = await item(id);
  assert.deepEqual([one.phase, one.stage, one.name, one.bytes], ["preparing", "receive", "내 영상.mp4", 1000]);
  assert.deepEqual(one.stages, ["receive", "preview", "strip", "thumb", "stills", "tones", "h264", "encode", "drop"]);
  await step(id);
  assert.deepEqual([(await item(id)).width, (await item(id)).duration], [1920, 10]);
  await step(id, { estimate: { perSecond: [1, 2, 3], stillBytes: 10, crop: { x: 0, y: 0, w: 1, h: 1 }, counted: null, encodeRatio: 7.5, rough: false } });
  await step(id, { strip: { count: 20, every: 0.5, columns: 10, width: 228, height: 128 } });
  one = await item(id);
  assert.deepEqual([one.phase, one.stage, one.strip, one.estimate?.perSecond, one.estimate?.counting], ["editing", null, { count: 20, every: 0.5, columns: 10, width: 228, height: 128 }, [1, 2, 3], false]);

  assert.equal((await send("PUT", `/${id}/edit`, EDIT)).status, 200);
  one = await item(id);
  // 편집을 적용하면 어림은 싣지 않고, 썸네일 전에는 걸지 않는다
  assert.deepEqual([one.phase, one.stage, one.estimate, (await state()).current], ["encoding", "thumb", null, null]);
  assert.deepEqual(await codeOf(await send("PUT", `/${id}/edit`, EDIT)), [409, "background-not-editable"]);
  await step(id, { media: { stills: [1280], color: "#336699", scenes: [], rungs: {} } });
  const s = await state();
  assert.deepEqual([s.current, s.shows, s.list[0].thumb], [id, "thumb", `/login-background/${id}/still-1280.webp`]);
});

test("앞 배경을 굽는 동안 적용한 배경은 썸네일까지 하고 굽기 순서를 기다린다. 취소하면 걸려 있던 앞 배경으로", async () => {
  const a = await ready("A");
  const b = await applied("B");
  // B 는 썸네일 전: A 가 그대로
  assert.deepEqual(await brief(), { current: a, previous: null, phases: { [b]: "encoding", [a]: "ready" } });
  await stepUntil(b, (one) => one.stage === "encode");
  assert.deepEqual([(await state()).current, (await state()).previous], [b, a]);

  const c = await applied("C");
  await stepUntil(c, (one) => one.phase === "queued");
  let s = await state();
  assert.deepEqual([s.current, s.previous, s.list.find((one) => one.id === c)!.stage], [c, b, null]);
  // 다 만들지 않은 배경은 기록에서 선택할 수 없다
  assert.deepEqual(await codeOf(await send("PUT", "/current", { id: c })), [409, "background-not-ready"]);

  assert.equal((await send("POST", `/${c}/cancel`)).status, 200);
  s = await state();
  assert.deepEqual([s.current, s.previous, s.list.length], [b, a, 2]);
  assert.equal(fs.existsSync(path.join(DIR, c)), false);
  await stepUntil(b, (one) => one.phase === "ready");
  assert.equal((await state()).shows, "full");
});

test("굽던 배경을 삭제하면 기다리던 배경이 이어서 굽는다", async () => {
  const b = await applied("B");
  await stepUntil(b, (one) => one.stage === "h264");
  const c = await applied("C");
  await stepUntil(c, (one) => one.phase === "queued");
  assert.equal((await send("DELETE", `/${b}`)).status, 200);
  await settle();
  const one = await item(c);
  assert.deepEqual([one.phase, one.stage], ["encoding", "h264"]);
  assert.equal((await state()).current, c);
});

test("한도는 다 구운 뒤에 지키고, 지금 배경을 뺀 오래된 기록부터 삭제한다(이전 배경은 맨 마지막)", async () => {
  assert.equal((await send("PUT", "/limits", { history: 1, maxBytes: 0 })).status, 200);
  const a = await ready("A");
  const b = await ready("B");
  // 기록(지금 배경 말고)이 하나라 아직 그대로
  assert.deepEqual(await brief(), { current: b, previous: a, phases: { [b]: "ready", [a]: "ready" } });
  // 올리기만 하고 편집 전이면 삭제하지 않는다
  const c = await upload("C");
  assert.equal((await state()).list.length, 3);
  await stepUntil(c, (one) => one.phase === "editing");
  assert.equal((await send("PUT", `/${c}/edit`, EDIT)).status, 200);
  await stepUntil(c, (one) => one.phase === "ready");
  // C 가 걸리고 B 가 이전 배경, 가장 오래된 A 를 삭제한다
  assert.deepEqual(await brief(), { current: c, previous: b, phases: { [c]: "ready", [b]: "ready" } });
  assert.equal(fs.existsSync(path.join(DIR, a)), false);
});

test("보관 0 이면 지금 배경만 남는다. 최대 용량이 모자라면 이전 배경도 삭제한다", async () => {
  assert.equal((await send("PUT", "/limits", { history: 0, maxBytes: 0 })).status, 200);
  const a = await ready("A");
  const b = await ready("B");
  assert.deepEqual(await brief(), { current: b, previous: null, phases: { [b]: "ready" } });
  assert.equal(fs.existsSync(path.join(DIR, a)), false);

  // 배경 하나가 1000 바이트(올린 원본): 1500 이면 둘은 들어가지 않는다
  assert.equal((await send("PUT", "/limits", { history: 5, maxBytes: 1500 })).status, 200);
  const c = await ready("C");
  assert.deepEqual(await brief(), { current: c, previous: null, phases: { [c]: "ready" } });
});

test("이전 배경이 삭제된 뒤 인코딩을 취소하면 봇 프로필 그림으로", async () => {
  const a = await ready("A");
  const b = await applied("B");
  await stepUntil(b, (one) => one.stage === "h264");
  assert.deepEqual([(await state()).current, (await state()).previous], [b, a]);
  // 굽는 동안 한도를 줄이면 바로 지킨다: 다 구운 기록인 A 를 삭제한다
  assert.equal((await send("PUT", "/limits", { history: 0, maxBytes: 0 })).status, 200);
  assert.deepEqual([(await state()).current, (await state()).previous], [b, null]);
  assert.equal((await send("POST", `/${b}/cancel`)).status, 200);
  const s = await state();
  assert.deepEqual([s.current, s.shows, s.list.length], [null, "none", 0]);
});

test("기록으로 교체 · 비우기", async () => {
  const a = await ready("A");
  const b = await ready("B");
  assert.equal((await send("PUT", "/current", { id: a })).status, 200);
  assert.deepEqual([(await state()).current, (await state()).previous], [a, b]);
  assert.equal((await send("DELETE", "/current")).status, 200);
  const s = await state();
  assert.deepEqual([s.current, s.shows, s.list.length], [null, "none", 2]);
});

test("단계가 실패하면 실패로 남기고 만든 것을 삭제한다. 걸려 있던 배경이면 이전 배경으로", async () => {
  const a = await ready("A");
  const b = await applied("B");
  await stepUntil(b, (one) => one.stage === "h264");
  assert.equal((await state()).current, b);
  gates.get(b)!.reject(new Error("인코더가 죽었다"));
  await settle();
  const one = await item(b);
  assert.deepEqual([one.phase, one.problem, one.bytes, (await state()).current], ["failed", "background-failed", 0, a]);
});

test("실행기가 없는 단계는 시작하지 않고 기다린다. 달면 이어서 한다", async () => {
  runner._reset();
  useFakeExecutors("thumb");
  const id = await applied();
  await settle();
  let one = await item(id);
  assert.deepEqual([one.phase, one.stage, one.problem], ["encoding", null, null]);
  useFakeExecutors();
  runner.kick();
  one = await item(id);
  assert.equal(one.stage, "thumb");
});

test("봇이 다시 시작하면 하던 단계부터 이어서 한다", async () => {
  const b = await applied("B");
  await stepUntil(b, (one) => one.stage === "encode");
  // 봇이 꺼진 것처럼: 도는 일을 잊고 기록을 다시 읽는다
  runner._reset();
  useFakeExecutors();
  store._useDir(DIR);
  runner.resume();
  const one = await item(b);
  assert.deepEqual([one.phase, one.stage, one.resumed], ["encoding", "encode", true]);
  await stepUntil(b, (x) => x.phase === "ready");
  assert.equal((await item(b)).resumed, false);
});

test("요청 검사: 크롭 · 구간 · 썸네일 장면 · 영상 길이 · 한도 · 화면 값", async () => {
  const id = await upload();
  await stepUntil(id, (one) => one.phase === "editing");
  const bad = [
    { ...EDIT, crop: { x: 0.5, y: 0, w: 0.6, h: 1 } },
    { ...EDIT, range: [2, 2.5] },
    { ...EDIT, thumbAt: 9 },
    { ...EDIT, range: [2, 30] },
  ];
  for (const body of bad) assert.deepEqual(await codeOf(await send("PUT", `/${id}/edit`, body)), [400, "bad-request"]);
  assert.deepEqual(await codeOf(await send("PUT", "/limits", { history: -1, maxBytes: 0 })), [400, "bad-request"]);
  assert.deepEqual(await codeOf(await send("PUT", "/limits", { history: 51, maxBytes: 0 })), [400, "bad-request"]);
  assert.deepEqual(await codeOf(await send("PUT", "/options", { blur: 0.5, cover: 90, follow: true, seam: { kind: "cut", seconds: 1 } })), [400, "bad-request"]);
  assert.deepEqual(await codeOf(await send("PUT", "/options", { blur: 0.5, cover: 35, follow: true, seam: { kind: "cut", seconds: 3 } })), [400, "bad-request"]);
  const options = { blur: 0.8, cover: 50, follow: false, seam: { kind: "blur", seconds: 2 } };
  assert.equal((await send("PUT", "/options", options)).status, 200);
  assert.deepEqual((await state()).options, options);
  assert.deepEqual(await codeOf(await send("PUT", "/current", { id: "../../etc" })), [400, "bad-request"]);
  assert.deepEqual(await codeOf(await send("PUT", "/abcdefghijklmnopqrstuvwx/position", { x: 1, y: 2 })), [404, "route-not-found"]);
});

test("올린 파일 이름은 제어 문자를 빼고 자른다. 빈 파일은 받지 않는다", async () => {
  const id = await upload(`a\u0000b‮${"긴".repeat(300)}`);
  const one = await item(id);
  assert.equal(one.name, `ab${"긴".repeat(198)}`);
  const res = await fetch(`${A}/upload`, { method: "POST", headers: { "content-type": "image/png" }, body: Buffer.alloc(0) });
  assert.deepEqual(await codeOf(res), [400, "bad-request"]);
  assert.equal((await state()).list.length, 1);
});

test("링크로 추가: 유튜브는 고해상도 다운로드를 더하고, http 가 아니면 받지 않는다", async () => {
  const res = await send("POST", "/link", { url: "https://youtu.be/dQw4w9WgXcQ" });
  const one = ((await res.json()) as LoginBackgroundState).list[0];
  assert.deepEqual([one.from, one.kind, one.stages.includes("highRes")], ["youtube", "video", true]);
  assert.deepEqual(await codeOf(await send("POST", "/link", { url: "file:///etc/passwd" })), [400, "bad-request"]);
});

test("봇이 켜진 뒤 첫 요청이 링크 추가여도 새 배경의 폴더가 남는다", async () => {
  // 기록을 아직 읽지 않은 상태(봇이 막 켜졌다)
  store._useDir(DIR);
  const res = await send("POST", "/link", { url: "https://example.com/a.png" });
  const id = ((await res.json()) as LoginBackgroundState).list[0].id;
  assert.equal(fs.existsSync(path.join(DIR, id)), true);
});

test("이어 할 때 원본이 없으면 원본이 없다는 까닭으로 실패한다", async () => {
  const id = await upload();
  await stepUntil(id, (one) => one.phase === "editing");
  fs.rmSync(store.sourceOf(id));
  assert.equal((await send("PUT", `/${id}/edit`, EDIT)).status, 200);
  await settle();
  const one = await item(id);
  assert.deepEqual([one.phase, one.problem], ["failed", "background-failed"]);
});
