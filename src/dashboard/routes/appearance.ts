// 파비콘. 바깥에 내는 파비콘 · 웹 앱 매니페스트(로그인 없이, 화면 셸보다 앞)와 운영자 패널의 크기 슬롯마다 올리기 · 교체 · 삭제(/api/admin/appearance/favicon)

import express, { type Request, type Response } from "express";
import sharp from "sharp";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { requireOwner } from "../middleware/require-owner.ts";
import { signedIn } from "../middleware/require-auth.ts";
import { sendProblem } from "../problem.ts";
import { parse, FaviconLinkBody, FaviconUseBody } from "../request-schemas.ts";
import { messageOf } from "../../rules/error-kind.ts";
import * as safeUrl from "../../infra/safe-url.ts";
import { APPEARANCE_MAX_BYTES, FAVICON_SIZES, type FaviconSlots } from "../contract/appearance.ts";
import * as store from "../appearance.ts";

/** 매니페스트가 부르는 아이콘 크기(안드로이드 홈 화면) */
const MANIFEST_SIZES = [192, 256, 512];
/** 봇 프로필 그림을 다운로드하는 크기(가장 큰 쓰는 크기) */
const AVATAR_SIZE = 512;
/** 링크로 다운로드하는 그림의 조건. Content-Type 이 없으면 다운로드해 보고 sharp 로 구분한다 */
const LINK_ACCEPT: safeUrl.Accept = { contentType: /^\s*image\/(png|webp|jpeg|svg\+xml)\s*(;|$)/i, maxBytes: APPEARANCE_MAX_BYTES, timeoutMs: 10_000 };
/** sharp 가 읽은 형식 → 넘길 때의 Content-Type */
const LINK_TYPES: Record<string, string> = { png: "image/png", webp: "image/webp", jpeg: "image/jpeg", svg: "image/svg+xml" };

/** 봇 프로필 그림 주소. 프로필 그림을 안 정한 봇도 디스코드 기본 그림이 있다. 봇이 준비 전이면 null */
const avatarUrl = (req: Request) => req.app.locals.bot.client.user?.displayAvatarURL({ size: AVATAR_SIZE, extension: "png" }) ?? null;
/** 경로의 슬롯 크기. 쓰는 크기가 아니면 null */
const sizeOf = (req: Request) => {
  const size = Number(req.params.size);
  return FAVICON_SIZES.some((one) => one === size) ? size : null;
};

const publicAppearanceRouter = express.Router();

// 파비콘. 늘 그 크기의 정사각형 png. 바꾸면 바로 보이게 캐시하지 않는다(브라우저가 매번 묻는다)
publicAppearanceRouter.get("/favicon/:size", async (req, res) => {
  const size = sizeOf(req);
  if (size === null) return sendProblem(res, "route-not-found");
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
const reply = (req: Request): FaviconSlots => store.faviconSlots(Boolean(avatarUrl(req)));

/** 저장을 바꾸는 일 하나. 파일 쓰기에 실패하면 appearance-save-failed, 됐으면 로그를 남기고 슬롯들로 답한다. what: [한 일, 실패했을 때의 일] */
async function changing(req: Request, res: Response, what: [string, string], job: () => Promise<boolean | store.Added> | boolean) {
  let done: boolean | store.Added;
  try {
    done = await job();
  } catch (error) {
    log.error({ sub: "admin" }, `파비콘 ${what[1]} 실패: ${messageOf(error)}`);
    return sendProblem(res, "appearance-save-failed", {}, { detail: messageOf(error) });
  }
  if (done === false) return sendProblem(res, "route-not-found");
  if (typeof done === "object" && !done.ok) return sendProblem(res, done.code, done.params);
  log.info({ sub: "admin" }, `파비콘 ${what[0]}. 실행 ${ranBy(req)}`);
  res.json(reply(req));
}

appearanceRouter.get("/favicon", (req, res) => {
  res.json(reply(req));
});

// 링크의 그림을 대신 다운로드해 그대로 넘긴다(브라우저가 다른 사이트의 그림을 직접 읽으면 CORS 에 막히는 일이 많다). 화면이 받아 정사각형인지 보고 크기에 추가한다.
// 내부 주소 · 리다이렉트 · 크기 · 시간은 infra/safe-url 이 막는다. 막힌 까닭은 로그에만(봇이 내부망 탐지 도구가 되지 않게), 화면에는 image-link-failed 하나
appearanceRouter.post("/favicon/fetch", async (req, res) => {
  const body = parse(FaviconLinkBody, req.body ?? {});
  if (!body.ok) return sendProblem(res, body.code);
  let data: Buffer;
  try {
    data = await safeUrl.getBuffer(body.value.url, LINK_ACCEPT);
  } catch (error) {
    log.warn({ sub: "admin" }, `파비콘 링크에서 그림을 다운로드하지 못했습니다: ${messageOf(error)}`);
    return sendProblem(res, "image-link-failed", { max: APPEARANCE_MAX_BYTES });
  }
  const format = await sharp(data)
    .metadata()
    .then((meta) => meta.format ?? "")
    .catch(() => "");
  const type = LINK_TYPES[format];
  if (!type) return sendProblem(res, "bad-image");
  // 남의 svg 를 이 주소에서 그대로 내므로, 문서로 열려도 스크립트가 돌지 않게 막는다
  res.set({ "Cache-Control": "no-store", "Content-Security-Policy": "sandbox; default-src 'none'", "Content-Disposition": "attachment" });
  res.type(type).send(data);
});

// 그림 본문 그대로(Content-Type: image/*). 상한을 넘으면 payload-too-large
appearanceRouter.put("/favicon/:size", express.raw({ type: "image/*", limit: APPEARANCE_MAX_BYTES }), (req: Request, res: Response) => {
  const size = sizeOf(req);
  if (size === null) return sendProblem(res, "route-not-found");
  if (!Buffer.isBuffer(req.body) || !req.body.length) return sendProblem(res, "bad-image");
  return changing(req, res, [`${size}px 에 그림을 올렸습니다`, `${size}px 그림 올리기`], () => store.addFavicon(size, req.body as Buffer));
});

appearanceRouter.put("/favicon/:size/current", (req, res) => {
  const size = sizeOf(req);
  if (size === null) return sendProblem(res, "route-not-found");
  const body = parse(FaviconUseBody, req.body ?? {});
  if (!body.ok) return sendProblem(res, body.code);
  return changing(req, res, [`${size}px 을 기록의 그림으로 바꿨습니다`, `${size}px 기록의 그림으로 바꾸기`], () => store.useFavicon(size, body.value.id));
});

appearanceRouter.delete("/favicon/:size", (req, res) => {
  const size = sizeOf(req);
  if (size === null) return sendProblem(res, "route-not-found");
  return changing(req, res, [`${size}px 을 비웠습니다`, `${size}px 비우기`], () => store.clearFavicon(size));
});

appearanceRouter.delete("/favicon/:size/history/:id", (req, res) => {
  const size = sizeOf(req);
  if (size === null) return sendProblem(res, "route-not-found");
  return changing(req, res, [`${size}px 의 기록에서 그림을 삭제했습니다`, `${size}px 기록에서 그림 삭제`], () => store.removeFavicon(size, req.params.id));
});

// 기록의 그림 미리 보기(슬롯 크기 png). id 는 다시 쓰지 않으므로 오래 캐시한다
appearanceRouter.get("/favicon/:size/history/:id", (req, res) => {
  const size = sizeOf(req);
  const png = size === null ? null : store.previewPng(size, req.params.id);
  if (!png) return sendProblem(res, "route-not-found");
  res.set("Cache-Control", "private, max-age=31536000, immutable");
  res.type("png").send(png);
});

export { publicAppearanceRouter, appearanceRouter };
