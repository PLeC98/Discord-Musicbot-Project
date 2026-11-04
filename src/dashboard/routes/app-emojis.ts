// 앱 이모지(/api/app-emojis): 목록, 이미지, 입력란용 그림 글꼴. 서버 화면의 장르 이모지도 그리므로 로그인한 사용자 누구나 읽는다.
// 이미지와 글꼴은 선택기를 열면 한꺼번에 불려 일반 API 한도와 따로 센다(rate-limits 의 UNLIMITED)

import express, { type Request, type Response } from "express";
import config from "../../config/index.ts";
import { requireAuth } from "../middleware/require-auth.ts";
import { limiter } from "../rate-limits.ts";
import { emojiFont, emojiItems, imageOf, versionOf } from "../app-emoji-glyphs.ts";
import type { AppEmojiList } from "../contract/app-emojis.ts";

/** 이미지, 글꼴 요청의 한도: 일반 API 한도의 몇 배(선택기를 열면 아이콘만 100개 넘게 불린다) */
const ASSET_LIMIT_FACTOR = 4;

const appEmojisRouter = express.Router();
const assetLimiter = limiter(() => config.dashboard.rateLimit.apiMax * ASSET_LIMIT_FACTOR);

appEmojisRouter.get("/", requireAuth, (_req, res) => {
  const emojis = emojiItems();
  res.json({ emojis, fontVersion: versionOf(emojis) } satisfies AppEmojiList);
});

// 입력란용 그림 글꼴. 주소는 고정(style.css 의 @font-face)이고 목록이 바뀌면 ETag 가 바뀐다
appEmojisRouter.get("/font.:format", requireAuth, assetLimiter, async (req: Request<{ format: string }>, res: Response) => {
  const format = req.params.format === "sbix" || req.params.format === "svg" ? req.params.format : null;
  if (!format) return res.status(404).end();
  const font = await emojiFont(format);
  const etag = `"${font.version}-${format}"`;
  res.set({ "Cache-Control": "no-cache", ETag: etag });
  if (req.get("If-None-Match") === etag) return res.status(304).end();
  res.type("font/ttf").send(font.data);
});

// 이미지 하나. 이모지의 이미지는 디스코드에서 바뀌지 않아 id 주소로 오래 캐시한다
appEmojisRouter.get("/:file", requireAuth, assetLimiter, async (req: Request<{ file: string }>, res: Response) => {
  const [, id, ext] = /^(\d{17,20})\.(png|gif)$/.exec(req.params.file) ?? [];
  const image = id ? await imageOf(id) : null;
  if (!image || ext !== (image.animated ? "gif" : "png")) return res.status(404).end();
  res.set("Cache-Control", "private, max-age=31536000, immutable");
  res.type(ext).send(image.data);
});

export { appEmojisRouter };
