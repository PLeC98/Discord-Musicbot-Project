// 파비콘. 바깥에 내는 파비콘 · 웹 앱 매니페스트(로그인 없이, 화면 셸보다 앞)와 운영자 패널의 올리기 · 지우기(/api/admin/appearance)

import express, { type Request, type Response } from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { requireOwner } from "../middleware/require-owner.ts";
import { signedIn } from "../middleware/require-auth.ts";
import { sendProblem } from "../problem.ts";
import { messageOf } from "../../rules/error-kind.ts";
import { APPEARANCE_MAX_BYTES, FAVICON_SIZES, type Appearance } from "../contract/appearance.ts";
import * as store from "../appearance.ts";

/** 매니페스트가 부르는 아이콘 크기(안드로이드 홈 화면) */
const MANIFEST_SIZES = [192, 256, 512];
/** 봇 프로필 그림을 받는 크기(가장 큰 쓰는 크기) */
const AVATAR_SIZE = 512;

/** 봇 프로필 그림 주소. 프로필 그림을 안 정한 봇도 디스코드 기본 그림이 있다. 봇이 준비 전이면 null */
const avatarUrl = (req: Request) => req.app.locals.bot.client.user?.displayAvatarURL({ size: AVATAR_SIZE, extension: "png" }) ?? null;

const publicAppearanceRouter = express.Router();

// 파비콘. 늘 그 크기의 정사각형 png. 바꾸면 바로 보이게 캐시하지 않는다(브라우저가 매번 묻는다)
publicAppearanceRouter.get("/favicon/:size", async (req, res) => {
  const size = Number(req.params.size);
  if (!FAVICON_SIZES.some((one) => one === size)) return sendProblem(res, "route-not-found");
  const png = await store.faviconPng(size, avatarUrl(req));
  res.set("Cache-Control", "no-cache");
  if (!png) return res.status(404).end();
  res.type("png").send(png);
});

// 홈 화면에 추가할 때의 이름 · 아이콘. 주소창 있는 그대로 연다
publicAppearanceRouter.get("/manifest.webmanifest", (req, res) => {
  const name = req.app.locals.bot.client.user?.username ?? "MusicBot";
  res.set("Cache-Control", "no-cache");
  res.type("application/manifest+json").send(JSON.stringify({ name, short_name: name, start_url: "/", display: "browser", icons: MANIFEST_SIZES.map((size) => ({ src: `/favicon/${size}`, sizes: `${size}x${size}`, type: "image/png" })) }));
});

// ── 운영자 패널 ──

const appearanceRouter = express.Router();
appearanceRouter.use(requireOwner);

// 로그에 남기는 실행한 사람(운영자 패널의 다른 경로와 같다)
const ranBy = (req: Request) => signedIn(req).username || signedIn(req).id;
const reply = (req: Request) => store.appearance(Boolean(avatarUrl(req)));

appearanceRouter.get("/", async (req, res) => {
  res.json((await reply(req)) satisfies Appearance);
});

// 그림 본문 그대로(Content-Type: image/*). 상한을 넘으면 payload-too-large
appearanceRouter.put("/favicon", express.raw({ type: "image/*", limit: APPEARANCE_MAX_BYTES }), async (req: Request, res: Response) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return sendProblem(res, "bad-image");
  let added: store.Added;
  try {
    added = await store.addFavicon(req.body);
  } catch (error) {
    log.error({ sub: "admin" }, `파비콘 저장 실패: ${messageOf(error)}`);
    return sendProblem(res, "appearance-save-failed", {}, { detail: messageOf(error) });
  }
  if (!added.ok) return sendProblem(res, added.code, added.params);
  log.info({ sub: "admin" }, `파비콘 그림을 올렸습니다. 실행 ${ranBy(req)}`);
  res.json((await reply(req)) satisfies Appearance);
});

appearanceRouter.delete("/favicon/:id", async (req, res) => {
  let removed: boolean;
  try {
    removed = await store.removeFavicon(req.params.id);
  } catch (error) {
    log.error({ sub: "admin" }, `파비콘 지우기 실패: ${messageOf(error)}`);
    return sendProblem(res, "appearance-save-failed", {}, { detail: messageOf(error) });
  }
  if (!removed) return sendProblem(res, "route-not-found");
  log.info({ sub: "admin" }, `파비콘 그림을 지웠습니다. 실행 ${ranBy(req)}`);
  res.json((await reply(req)) satisfies Appearance);
});

// 올린 그림의 미리 보기(png)
appearanceRouter.get("/favicon/:id", async (req, res) => {
  const png = await store.previewPng(req.params.id);
  if (!png) return sendProblem(res, "route-not-found");
  res.set("Cache-Control", "private, no-cache");
  res.type("png").send(png);
});

export { publicAppearanceRouter, appearanceRouter };
