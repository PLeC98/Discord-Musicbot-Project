// 로그인 배경(로그인 없이, 화면 셸보다 앞에): 로그인 화면이 받는 배경 정보(GET /api/login-background)와 그 파일(/login-background/:id/…).
// 배경 정보는 캐시하지 않는다(Express 의 ETag 로 304). 파일은 배경마다 다른 주소라 정지 그림 · init · 조각은 1년 immutable, HLS 목록(.m3u8)은 캐시하지 않는다.
// 파일은 기록에 있는 배경이면 낸다(이전 배경을 보던 화면이 이어 받게). 경로는 정해진 꼴만 받는다(배경 id · 코덱 · 단계 · 파일 이름), 받은 글을 경로로 그대로 쓰지 않는다

import express, { type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { LOGIN_BG_CODECS, type LoginBackground } from "../contract/login-background.ts";
import * as store from "../login-background/store.ts";
import { RUNG_FILE, SHORT, STILL_FILE, isCodec } from "../login-background/files.ts";

const publicLoginBackgroundRouter = express.Router();

/** 파일 주소 */
const fileUrl = (id: string, ...parts: string[]) => ["/login-background", id, ...parts].join("/");
/** 1년 immutable(배경 · 단계마다 다른 주소) · 캐시하지 않음(목록 · 배경 정보) */
const FOREVER = "public, max-age=31536000, immutable";
const NO_CACHE = "no-cache";

/** 로그인 화면이 받는 것. 지금 배경이 걸 것(썸네일)이 없으면 none(봇 프로필 그림 배경) */
function publicOf(): LoginBackground {
  const { current, options } = store.loaded();
  const one = current ? store.find(current) : null;
  if (!one || !store.canShow(one)) return { kind: "none" };
  const stills = [...one.media.stills].sort((a, b) => a - b).map((width) => ({ width, url: fileUrl(one.id, `still-${width}.webp`) }));
  const look = { ...options, position: one.position };
  if (one.kind === "image") return { kind: "image", id: one.id, stills, color: one.media.color, look };
  const streams = LOGIN_BG_CODECS.filter((codec) => one.media.rungs[codec]?.length).map((codec) => ({ codec, url: fileUrl(one.id, codec, "index.m3u8"), rungs: one.media.rungs[codec]! }));
  return { kind: "video", id: one.id, stills, color: one.media.color, scenes: one.media.scenes, streams, look };
}

publicLoginBackgroundRouter.get("/api/login-background", (_req, res) => {
  res.set("Cache-Control", NO_CACHE);
  res.json(publicOf() satisfies LoginBackground);
});

/** 기록에 있는 배경의 파일을 낸다(없으면 404) */
function sendFile(res: Response, id: string, parts: string[], type: string, cache: string) {
  const one = store.find(id);
  const file = one ? path.join(store.folderOf(one.id), ...parts) : null;
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file, { headers: { "Cache-Control": cache, "Content-Type": type } });
}

// 정지 그림(폭별)
publicLoginBackgroundRouter.get("/login-background/:id/:file", (req, res) => {
  const width = STILL_FILE.exec(req.params.file)?.[1];
  if (!width) return res.status(404).end();
  sendFile(res, req.params.id, [`still-${width}.webp`], "image/webp", FOREVER);
});

// 코덱마다의 목록
publicLoginBackgroundRouter.get("/login-background/:id/:codec/index.m3u8", (req, res) => {
  if (!isCodec(req.params.codec)) return res.status(404).end();
  sendFile(res, req.params.id, [req.params.codec, "index.m3u8"], "application/vnd.apple.mpegurl", NO_CACHE);
});

// 단계의 목록 · init · 조각
publicLoginBackgroundRouter.get("/login-background/:id/:codec/:short/:file", (req, res) => {
  const { id, codec, short, file } = req.params;
  if (!isCodec(codec) || !SHORT.test(short) || !RUNG_FILE.test(file)) return res.status(404).end();
  const playlist = file.endsWith(".m3u8");
  sendFile(res, id, [codec, short, file], playlist ? "application/vnd.apple.mpegurl" : file.endsWith(".m4s") ? "video/iso.segment" : "video/mp4", playlist ? NO_CACHE : FOREVER);
});

export { publicLoginBackgroundRouter, publicOf };
