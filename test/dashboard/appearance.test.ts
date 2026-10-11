// src/dashboard/routes/appearance.ts · appearance.ts — 꾸미기: 파비콘을 올리고 지우며, 크기마다 가장 가까운 그림으로(없으면 봇 프로필 그림) 낸다

process.env.OWNER_ID = "owner";

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import sharp from "sharp";
import { fakeBot } from "../helpers/fake.ts";
import { signedInAs } from "../helpers/dashboard.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";
import type { Appearance } from "../../src/dashboard/contract/appearance.ts";

const store = await import("../../src/dashboard/appearance.ts");
const { appearanceRouter, publicAppearanceRouter } = await import("../../src/dashboard/routes/appearance.ts");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "appearance-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }));

/** 한 가지 색으로 칠한 그림 */
const square = (side: number, format: "png" | "webp" | "jpeg" | "gif" = "png", height = side) =>
  sharp({ create: { width: side, height, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } })
    [format]()
    .toBuffer();
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#36c"/></svg>');

let user: object | null = { id: "owner", username: "운영자" };
let avatarServed = 0;
const app = express();
// 봇 프로필 그림 자리(디스코드 CDN 대신)
app.get("/avatar.png", async (_req, res) => {
  avatarServed++;
  res.type("png").send(await square(512));
});
app.use(publicAppearanceRouter);
app.use(signedInAs(() => user));
app.use("/api/admin/appearance", appearanceRouter);
const server = await listenForFetch(app);
after(() => server.close());
const base = baseUrl(server);
app.locals.bot = fakeBot({ client: { user: { username: "봇", displayAvatarURL: () => `${base}/avatar.png` } } });

const put = (body: Buffer, type = "image/png") => fetch(`${base}/api/admin/appearance/favicon`, { method: "PUT", headers: { "content-type": type }, body });
const state = async () => (await (await fetch(`${base}/api/admin/appearance`)).json()) as Appearance;
const codeOf = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];
const iconSize = async (size: number) => {
  const res = await fetch(`${base}/favicon/${size}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-cache");
  const { width, height, format } = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  return [format, width, height];
};

beforeEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
  store._useDir(DIR);
  user = { id: "owner", username: "운영자" };
});

test("올린 그림이 없으면 봇 프로필 그림을 줄여 낸다. 매니페스트는 봇 이름 · 아이콘 셋", async () => {
  assert.deepEqual(await iconSize(32), ["png", 32, 32]);
  assert.deepEqual(await iconSize(180), ["png", 180, 180]);
  assert.equal(avatarServed, 1, "프로필 그림은 한 번만 받는다");
  assert.ok((await state()).favicon.sizes.every((one) => one.from === "avatar"));

  const manifest = (await (await fetch(`${base}/manifest.webmanifest`)).json()) as { name: string; display: string; icons: Array<{ src: string }> };
  assert.equal(manifest.name, "봇");
  assert.equal(manifest.display, "browser");
  assert.deepEqual(
    manifest.icons.map((one) => one.src),
    ["/favicon/192", "/favicon/256", "/favicon/512"],
  );
  assert.equal((await fetch(`${base}/favicon/64`)).status, 404, "쓰지 않는 크기");
});

test("올리기: 크기마다 꼭 맞는 그림, 없으면 배율로 가장 가까운 그림. 같은 변을 다시 올리면 바꾼다", async () => {
  const before = store.faviconVersion();
  assert.equal((await put(await square(32))).status, 200);
  assert.equal((await put(await square(512, "webp"), "image/webp")).status, 200);
  assert.notEqual(store.faviconVersion(), before, "바뀌면 버전이 오른다");

  const { favicon } = await state();
  assert.deepEqual(
    favicon.uploads.map((one) => one.side),
    [32, 512],
  );
  const from = Object.fromEntries(favicon.sizes.map((one) => [one.size, `${one.from}:${one.upload}`]));
  assert.deepEqual(from, { 16: "resized:32", 32: "exact:32", 48: "resized:32", 180: "resized:512", 192: "resized:512", 256: "resized:512", 512: "exact:512" });
  assert.deepEqual(await iconSize(48), ["png", 48, 48]);

  assert.equal((await put(await square(32, "jpeg"), "image/jpeg")).status, 200);
  assert.equal((await state()).favicon.uploads.length, 2, "32 는 바꿨다");
  assert.ok(fs.existsSync(path.join(DIR, "32.png")) && fs.existsSync(path.join(DIR, "512.png")), "래스터는 png 로 다시 만들어 둔다");
});

// 작은 크기는 손으로 다듬은 그림이 svg 를 줄인 것보다 또렷하다(svg 와 작은 png 를 함께 두는 흔한 꼴)
test("꼭 맞는 크기의 그림이 svg 보다 먼저고, 나머지 크기는 svg 로 그린다. svg 와 같은 변의 그림은 서로 바꾸지 않는다", async () => {
  await put(await square(32));
  await put(SVG, "image/svg+xml");
  await put(await square(512));
  const { favicon } = await state();
  const used = Object.fromEntries(favicon.sizes.map((one) => [one.size, one.upload]));
  assert.deepEqual([used[32], used[512], used[16], used[180]], ["32", "512", "svg", "svg"]);
  assert.equal(favicon.uploads.length, 3, "svg 는 크기가 없어 자기 자리 하나다");
});

test("svg 가 있으면 꼭 맞는 그림이 없는 크기는 그것으로 그리고, 미리 보기도 그린 png 로만 낸다", async () => {
  assert.equal((await put(SVG, "image/svg+xml")).status, 200);
  const { favicon } = await state();
  assert.ok(favicon.sizes.every((one) => one.from === "exact" && one.upload === "svg"));
  assert.deepEqual(favicon.uploads, [{ id: "svg", side: null, bytes: SVG.length }]);
  assert.deepEqual(await iconSize(512), ["png", 512, 512]);

  const preview = await fetch(`${base}/api/admin/appearance/favicon/svg`);
  assert.equal(preview.headers.get("content-type"), "image/png");
});

test("거절: 그림이 아니거나 형식 밖 · 정사각형 아님 · 너무 작음", async () => {
  assert.deepEqual(await codeOf(await put(Buffer.from("not an image"))), [400, "bad-image"]);
  assert.deepEqual(await codeOf(await put(await square(32, "gif"), "image/gif")), [400, "bad-image"]);
  assert.deepEqual(await codeOf(await put(await square(64, "png", 32))), [400, "image-not-square"]);
  assert.deepEqual(await codeOf(await put(await square(8))), [400, "image-too-small"]);
  assert.equal((await state()).favicon.uploads.length, 0);
});

test("지우기: 지우면 다음 그림(없으면 봇 프로필 그림)으로. 다시 켜도(폴더를 다시 읽어도) 남아 있다", async () => {
  await put(await square(64));
  await put(await square(256));
  store._useDir(DIR);
  assert.equal((await state()).favicon.uploads.length, 2, "폴더에서 다시 읽는다");

  const res = await fetch(`${base}/api/admin/appearance/favicon/64`, { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.deepEqual(
    ((await res.json()) as Appearance).favicon.uploads.map((one) => one.id),
    ["256"],
  );
  assert.equal((await fetch(`${base}/api/admin/appearance/favicon/64`, { method: "DELETE" })).status, 404);
});

test("운영자만", async () => {
  user = { id: "u1", username: "사용자" };
  assert.deepEqual(await codeOf(await fetch(`${base}/api/admin/appearance`)), [403, "must-owner"]);
  assert.deepEqual(await codeOf(await put(await square(32))), [403, "must-owner"]);
});
