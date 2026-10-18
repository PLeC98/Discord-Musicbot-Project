// src/dashboard/routes/login-background-public.ts — 로그인 화면이 받는 배경 정보와 그 파일(로그인 없이).
// 배경 정보는 지금 배경이 걸 것(썸네일)을 가졌을 때만, 파일은 기록에 있는 배경의 정해진 형식만(원본 · 미리보기 · 경로 거슬러 오르기는 404). 캐시 헤더 · 종류 · 304

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";
import type { LoginBackground } from "../../src/dashboard/contract/login-background.ts";

const store = await import("../../src/dashboard/login-background/store.ts");
const { publicLoginBackgroundRouter } = await import("../../src/dashboard/routes/login-background-public.ts");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "login-bg-public-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }));
const app = express();
app.use(publicLoginBackgroundRouter);
const server = await listenForFetch(app);
after(() => server.close());
const base = baseUrl(server);
const info = async () => (await (await fetch(`${base}/api/login-background`)).json()) as LoginBackground;

/** 다 만든 배경(파일까지) */
function made(kind: "image" | "video") {
  const one = store.create({ kind, from: "upload", name: kind });
  const folder = store.folderOf(one.id);
  const write = (name: string, data = "x") => {
    fs.mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    fs.writeFileSync(path.join(folder, name), data);
  };
  for (const name of ["still-1920.webp", "still-1280.webp", "source", "preview.mp4"]) write(name);
  one.media = { stills: [1920, 1280], color: "#336699", scenes: [], rungs: {} };
  one.edit = { crop: { x: 0, y: 0, w: 1, h: 1 }, range: null, thumbAt: null };
  one.done = [...one.stages];
  one.position = { x: 30, y: 70 };
  if (kind === "video") {
    for (const name of ["h264/index.m3u8", "h264/720/index.m3u8", "h264/720/init.mp4", "h264/720/seg-000.m4s"]) write(name, name.endsWith(".m3u8") ? "#EXTM3U\n" : "x");
    one.media.rungs = { h264: [{ width: 1280, height: 720, codecs: "avc1.64001f", bandwidth: 2_400_000, frameRate: 30 }] };
    one.media.scenes = [
      { at: 0, color: "#112233" },
      { at: 4.2, color: null },
    ];
  }
  return one;
}

beforeEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
  store._useDir(DIR);
});

test("지금 배경이 없거나 걸 것(썸네일)이 없으면 none", async () => {
  assert.deepEqual(await info(), { kind: "none" });
  const one = store.create({ kind: "image", from: "upload", name: "a" });
  store.show(one.id);
  assert.deepEqual(await info(), { kind: "none" });
});

test("그림: 폭별 그림(작은 것부터) · 대표색 · 화면 값과 보일 위치. 원본 · 기록 · 이름은 싣지 않는다", async () => {
  const one = made("image");
  store.show(one.id);
  const got = await info();
  assert.deepEqual(got, {
    kind: "image",
    id: one.id,
    stills: [
      { width: 1280, url: `/login-background/${one.id}/still-1280.webp` },
      { width: 1920, url: `/login-background/${one.id}/still-1920.webp` },
    ],
    color: "#336699",
    look: { blur: 0.5, cover: 35, follow: true, seam: { kind: "cut", seconds: 1 }, position: { x: 30, y: 70 } },
  });
  assert.equal(JSON.stringify(got).includes('image"'), true);
  assert.equal(JSON.stringify(got).includes("source"), false);
});

test("영상: 구운 코덱의 목록과 단계 · 장면 색(없으면 null)", async () => {
  const one = made("video");
  store.show(one.id);
  const got = await info();
  assert.equal(got.kind, "video");
  if (got.kind !== "video") return;
  assert.deepEqual(got.streams, [{ codec: "h264", url: `/login-background/${one.id}/h264/index.m3u8`, rungs: one.media.rungs.h264 }]);
  assert.deepEqual(got.scenes, one.media.scenes);
});

test("파일: 종류와 캐시(그림 · init · 세그먼트는 1년 immutable, 목록은 no-cache). 기록의 배경도 낸다", async () => {
  const old = made("video");
  const now = made("image");
  store.show(now.id);
  const head = async (url: string) => {
    const res = await fetch(`${base}${url}`);
    return [res.status, res.headers.get("content-type")?.split(";")[0], res.headers.get("cache-control")];
  };
  assert.deepEqual(await head(`/login-background/${now.id}/still-1280.webp`), [200, "image/webp", "public, max-age=31536000, immutable"]);
  assert.deepEqual(await head(`/login-background/${old.id}/h264/index.m3u8`), [200, "application/vnd.apple.mpegurl", "no-cache"]);
  assert.deepEqual(await head(`/login-background/${old.id}/h264/720/index.m3u8`), [200, "application/vnd.apple.mpegurl", "no-cache"]);
  assert.deepEqual(await head(`/login-background/${old.id}/h264/720/init.mp4`), [200, "video/mp4", "public, max-age=31536000, immutable"]);
  assert.deepEqual(await head(`/login-background/${old.id}/h264/720/seg-000.m4s`), [200, "video/iso.segment", "public, max-age=31536000, immutable"]);
});

test("원본 · 미리보기 · 모르는 id · 형식이 틀린 이름 · 경로 거슬러 오르기는 404", async () => {
  const one = made("video");
  const missing = [`/login-background/${one.id}/source`, `/login-background/${one.id}/preview.mp4`, `/login-background/${one.id}/still-1280.png`, `/login-background/abcdefghijklmnopqrstuvwx/still-1280.webp`, `/login-background/${one.id}/opus/index.m3u8`, `/login-background/${one.id}/h264/720/source`, `/login-background/${one.id}/h264/..%2F..%2Fsource/index.m3u8`, `/login-background/..%2F${one.id}/still-1280.webp`, `/login-background/${one.id}/h264/720/..%2F..%2Fsource`];
  for (const url of missing) assert.equal((await fetch(`${base}${url}`)).status, 404, url);
});

test("배경 정보는 캐시하지 않고 ETag 로 304", async () => {
  const one = made("image");
  store.show(one.id);
  const first = await fetch(`${base}/api/login-background`);
  assert.equal(first.headers.get("cache-control"), "no-cache");
  const etag = first.headers.get("etag")!;
  assert.ok(etag);
  // fetch 는 If-None-Match 를 붙이면 Cache-Control: no-cache 도 실어 서버가 새로 준다(규격). 브라우저가 스스로 다시 확인하는 것처럼 헤더만 보낸다
  const status = await new Promise<number>((resolve) => http.get(`${base}/api/login-background`, { headers: { "if-none-match": etag } }, (res) => (res.resume(), resolve(res.statusCode ?? 0))));
  assert.equal(status, 304);
});
