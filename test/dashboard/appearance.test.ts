// src/dashboard/routes/appearance.ts · appearance.ts — 크기 칸마다 파비콘을 올리고 갈아 끼우고 지우며, 빈 칸은 가장 가까운 칸의 보관본으로(없으면 봇 프로필 그림) 낸다

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
import { FAVICON_HISTORY, type FaviconSlots } from "../../src/dashboard/contract/appearance.ts";

const store = await import("../../src/dashboard/appearance.ts");
const { appearanceRouter, publicAppearanceRouter } = await import("../../src/dashboard/routes/appearance.ts");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "appearance-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }));

/** 한 가지 색으로 칠한 그림(빨강, blue 면 파랑) */
const square = (side: number, format: "png" | "webp" | "jpeg" | "gif" = "png", height = side, blue = false) =>
  sharp({ create: { width: side, height, channels: 4, background: blue ? { r: 40, g: 40, b: 200, alpha: 1 } : { r: 200, g: 40, b: 40, alpha: 1 } } })
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
app.use(express.json());
app.use(signedInAs(() => user));
app.use("/api/admin/appearance", appearanceRouter);
const server = await listenForFetch(app);
after(() => server.close());
const base = baseUrl(server);
app.locals.bot = fakeBot({ client: { user: { username: "봇", displayAvatarURL: () => `${base}/avatar.png` } } });

const A = `${base}/api/admin/appearance/favicon`;
const put = (size: number, body: Buffer, type = "image/png") => fetch(`${A}/${size}`, { method: "PUT", headers: { "content-type": type }, body });
const send = (method: string, url: string, json?: object) => fetch(url, { method, headers: json ? { "content-type": "application/json" } : {}, body: json ? JSON.stringify(json) : undefined });
const state = async () => (await (await fetch(A)).json()) as FaviconSlots;
const slot = async (size: number) => (await state()).slots.find((one) => one.size === size)!;
const codeOf = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];
const iconSize = async (size: number) => {
  const res = await fetch(`${base}/favicon/${size}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-cache");
  const { width, height, format } = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  return [format, width, height];
};
/** 그 크기에 지금 내는 그림의 왼쪽 위 한 점(빨강 쪽인지 파랑 쪽인지 · 투명한지) */
const iconPixel = async (size: number) => {
  const { data } = await sharp(Buffer.from(await (await fetch(`${base}/favicon/${size}`)).arrayBuffer()))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data[3] === 0 ? "clear" : data[0] > data[2] ? "red" : "blue";
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
  assert.ok((await state()).slots.every((one) => one.from === "avatar" && one.current === null));

  const manifest = (await (await fetch(`${base}/manifest.webmanifest`)).json()) as { name: string; display: string; icons: Array<{ src: string }> };
  assert.equal(manifest.name, "봇");
  assert.equal(manifest.display, "browser");
  assert.deepEqual(
    manifest.icons.map((one) => one.src),
    ["/favicon/192", "/favicon/256", "/favicon/512"],
  );
  assert.equal((await fetch(`${base}/favicon/64`)).status, 404, "쓰지 않는 크기");
});

test("올리기: 그 칸 크기로 다시 만들고, 빈 칸은 배율로 가장 가까운 칸의 보관본을 줄이거나 늘려 쓴다", async () => {
  const before = store.faviconVersion();
  assert.equal((await put(32, await square(64))).status, 200);
  assert.equal((await put(512, await square(1024, "webp", 1024, true), "image/webp")).status, 200);
  assert.notEqual(store.faviconVersion(), before, "바뀌면 버전이 오른다");

  const { slots } = await state();
  const from = Object.fromEntries(slots.map((one) => [one.size, one.from === "scaled" ? `scaled:${one.source}:${one.sourceSide}` : one.from]));
  assert.deepEqual(from, { 16: "scaled:32:64", 32: "upload", 48: "scaled:32:64", 180: "scaled:512:512", 192: "scaled:512:512", 256: "scaled:512:512", 512: "upload" });
  assert.deepEqual(
    slots.find((one) => one.size === 32)!.history.map(({ width, height, vector }) => [width, height, vector]),
    [[64, 64, false]],
    "올린 원본의 크기를 적는다",
  );
  assert.deepEqual(await iconSize(32), ["png", 32, 32], "64 를 32 로 줄여 둔다");
  assert.deepEqual(await iconSize(48), ["png", 48, 48]);
  assert.deepEqual([await iconPixel(16), await iconPixel(180)], ["red", "blue"]);
});

test("svg 는 그 칸 크기로 그려 두고(정사각형이 아니면 투명 여백), 받은 svg 를 그대로 내지 않는다", async () => {
  assert.equal((await put(180, SVG, "image/svg+xml")).status, 200);
  const wide = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#36c"/></svg>');
  assert.equal((await put(16, wide, "image/svg+xml")).status, 200);
  assert.deepEqual(await iconSize(180), ["png", 180, 180]);
  assert.deepEqual(await iconSize(16), ["png", 16, 16]);
  assert.equal(await iconPixel(16), "clear", "위 끝은 투명 여백");
  assert.equal((await slot(180)).history[0].vector, true);
  assert.equal((await slot(512)).sourceSide, 512, "svg 의 보관본은 512 로 그린다");
});

test("기록: 새것부터 FAVICON_HISTORY 개까지 남고 넘친 그림의 파일은 지운다. 갈아 끼우기 · 비우기(기록은 남는다) · 기록에서 지우기", async () => {
  for (let i = 0; i <= FAVICON_HISTORY; i++) assert.equal((await put(32, await square(32 + i))).status, 200);
  const full = await slot(32);
  assert.equal(full.history.length, FAVICON_HISTORY);
  assert.deepEqual(
    full.history.map((one) => one.width),
    [38, 37, 36, 35, 34, 33],
    "새것부터, 가장 옛것(32)은 밀려났다",
  );
  assert.equal(fs.readdirSync(DIR).filter((name) => name.endsWith(".png")).length, FAVICON_HISTORY * 2, "넘친 그림의 파일도 지웠다");

  const older = full.history[3].id;
  const preview = await fetch(`${A}/32/history/${older}`);
  assert.equal(preview.headers.get("content-type"), "image/png");
  assert.equal((await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).width, 32);
  assert.equal((await fetch(`${A}/48/history/${older}`)).status, 404, "다른 칸의 기록으로는 볼 수 없다");

  const used = (await (await send("PUT", `${A}/32/current`, { id: older })).json()) as FaviconSlots;
  assert.equal(used.slots.find((one) => one.size === 32)!.current, older);
  assert.deepEqual(await codeOf(await send("PUT", `${A}/32/current`, { id: "nope" })), [404, "route-not-found"]);
  assert.deepEqual(await codeOf(await send("PUT", `${A}/32/current`, {})), [400, "bad-request"]);

  assert.equal((await send("DELETE", `${A}/32`)).status, 200);
  assert.equal((await slot(32)).current, null);
  assert.equal((await slot(32)).history.length, FAVICON_HISTORY, "비워도 기록은 남는다");
  assert.deepEqual(await codeOf(await send("DELETE", `${A}/32`)), [404, "route-not-found"], "이미 빈 칸");

  await send("PUT", `${A}/32/current`, { id: older });
  assert.equal((await send("DELETE", `${A}/32/history/${older}`)).status, 200);
  const after = await slot(32);
  assert.equal(after.current, null, "쓰던 그림을 지우면 칸도 빈다");
  assert.ok(!after.history.some((one) => one.id === older));
  assert.ok(!fs.existsSync(path.join(DIR, `${older}.png`)) && !fs.existsSync(path.join(DIR, `${older}.reserve.png`)));
});

test("다시 켜도(폴더를 다시 읽어도) 남아 있고, 목록에 없는 파일은 치운다", async () => {
  await put(48, await square(48));
  await put(256, await square(256, "jpeg"), "image/jpeg");
  fs.writeFileSync(path.join(DIR, "zzzzzzzzzz.png"), "남은 조각");
  store._useDir(DIR);
  const { slots } = await state();
  assert.deepEqual(
    slots.filter((one) => one.current).map((one) => one.size),
    [48, 256],
  );
  assert.ok(!fs.existsSync(path.join(DIR, "zzzzzzzzzz.png")));
});

test("거절: 쓰지 않는 크기 · 그림이 아니거나 형식 밖 · 정사각형 아님 · 너무 작음", async () => {
  assert.deepEqual(await codeOf(await put(64, await square(64))), [404, "route-not-found"]);
  assert.deepEqual(await codeOf(await put(32, Buffer.from("not an image"))), [400, "bad-image"]);
  assert.deepEqual(await codeOf(await put(32, await square(32, "gif"), "image/gif")), [400, "bad-image"]);
  assert.deepEqual(await codeOf(await put(32, await square(64, "png", 32))), [400, "image-not-square"]);
  assert.deepEqual(await codeOf(await put(32, await square(8))), [400, "image-too-small"]);
  assert.ok((await state()).slots.every((one) => one.history.length === 0));
});

test("링크로 추가: 내부 주소 · http(s) 가 아닌 주소는 image-link-failed(까닭은 로그에만), 빈 본문은 bad-request", async () => {
  for (const url of [`${base}/avatar.png`, "http://169.254.169.254/x.png", "ftp://example.com/x.png"]) assert.deepEqual(await codeOf(await send("POST", `${A}/fetch`, { url })), [502, "image-link-failed"], url);
  assert.deepEqual(await codeOf(await send("POST", `${A}/fetch`, {})), [400, "bad-request"]);
});

test("운영자만", async () => {
  user = { id: "u1", username: "사용자" };
  assert.deepEqual(await codeOf(await fetch(A)), [403, "must-owner"]);
  assert.deepEqual(await codeOf(await put(32, await square(32))), [403, "must-owner"]);
  assert.deepEqual(await codeOf(await send("POST", `${A}/fetch`, { url: "https://example.com/a.png" })), [403, "must-owner"]);
});
