// 앱 이모지(/api/app-emojis): 목록, 이미지, 입력란용 그림 글꼴. 서버 화면의 장르 이모지도 그리므로 로그인한 사용자 누구나 읽는다.
// 이미지와 글꼴은 선택기를 열면 한꺼번에 불려 일반 API 한도와 따로 센다(rate-limits 의 UNLIMITED).
// 올리기, 이름 바꾸기, 지우기는 운영자만(운영자 패널). 조작은 동기화와 한 줄로 돈다(app/app-emojis)

import express, { type Request, type Response } from "express";
import config from "../../config/index.ts";
import * as genreConfig from "../../config/genres.ts";
import { requireAuth } from "../middleware/require-auth.ts";
import { requireOwner } from "../middleware/require-owner.ts";
import { limiter } from "../rate-limits.ts";
import { sendProblem } from "../problem.ts";
import { codeOf } from "../../rules/error-kind.ts";
import { isManagedEmojiName } from "../../ui/icons.ts";
import { emojiFont, emojiItems, imageOf, versionOf } from "../app-emoji-glyphs.ts";
import { makeEmojiImage, type Rotation } from "../app-emoji-image.ts";
import { APPEARANCE_MAX_BYTES } from "../contract/appearance.ts";
import type { AppEmojiList, AppEmojiUses } from "../contract/app-emojis.ts";
import type { Code } from "../../rules/problems.ts";
import { assertSignedIn } from "../session-requests.ts";

/** 이미지, 글꼴 요청의 한도: 일반 API 한도의 몇 배(선택기를 열면 아이콘만 100개 넘게 불린다) */
const ASSET_LIMIT_FACTOR = 4;
/** 디스코드 이모지 이름 규칙 */
const NAME = /^\w{2,32}$/;
const ROTATIONS = new Set([0, 90, 180, 270]);
/** 쓰는 곳을 찾는 음성 상태 설정 */
const VOICE_KEYS = { VOICE_PLAYING_PREFIX: "playingPrefix", VOICE_PAUSED_PREFIX: "pausedPrefix", VOICE_IDLE_STATUS: "idleText" } as const;

/** 이미지 만들기, 조작에서 던진 코드 → 문제 응답 */
const PROBLEM: Record<string, Code> = {
  EMOJI_IMAGE: "emoji-image-bad",
  EMOJI_IMAGE_TOO_BIG: "emoji-image-too-big",
  EMOJI_TOO_LARGE: "emoji-too-large",
  EMOJI_EDIT: "emoji-edit-bad",
  EMOJI_NAME_TAKEN: "emoji-name-taken",
  EMOJI_FULL: "emoji-full",
  EMOJI_NOT_FOUND: "emoji-not-found",
  EMOJI_IS_ICON: "emoji-is-icon",
};

const appEmojisRouter = express.Router();
const assetLimiter = limiter(() => config.dashboard.rateLimit.apiMax * ASSET_LIMIT_FACTOR);

/** 이름 검사. 맞으면 null, 아니면 문제 코드 */
const nameProblem = (name: unknown): Code | null => (typeof name !== "string" || !NAME.test(name) ? "emoji-name-bad" : isManagedEmojiName(name) ? "emoji-name-reserved" : null);

/** 조작을 돌리고 알려진 실패는 문제 응답으로. 그 밖은 던진다(오류 처리기가 받는다) */
async function answer(res: Response, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    const code = PROBLEM[codeOf(error) ?? ""];
    if (!code) throw error;
    sendProblem(res, code);
  }
}

appEmojisRouter.get("/", requireAuth, (req, res) => {
  const emojis = emojiItems();
  res.json({ emojis, fontVersion: versionOf(emojis), room: req.app.locals.bot.appEmojis?.room() ?? 0 } satisfies AppEmojiList);
});

// 올리기: 본문은 원본 그대로, 편집 값(돌리기, 뒤집기, 돌리고 뒤집은 이미지 위의 정사각형)과 이름은 쿼리
appEmojisRouter.post("/", requireOwner, express.raw({ type: "image/*", limit: APPEARANCE_MAX_BYTES }), async (req: Request, res: Response) => {
  const emojis = req.app.locals.bot.appEmojis;
  if (!emojis) return sendProblem(res, "bot-not-ready");
  const name = req.query.name;
  const problem = nameProblem(name);
  if (problem) return sendProblem(res, problem);
  const [rotate, left, top, side] = ["rotate", "left", "top", "side"].map((key) => Number(req.query[key]));
  if (!ROTATIONS.has(rotate) || ![left, top, side].every(Number.isFinite)) return sendProblem(res, "emoji-edit-bad");
  if (!Buffer.isBuffer(req.body) || !req.body.length) return sendProblem(res, "emoji-image-bad");
  await answer(res, async () => {
    const image = await makeEmojiImage(req.body as Buffer, { rotate: rotate as Rotation, flip: req.query.flip === "1", left, top, side });
    const created = await emojis.add(name as string, image.data, () => assertSignedIn(req));
    res.status(201).json(emojiItems().find((one) => one.id === created.id) ?? null);
  });
});

appEmojisRouter.patch("/:id", requireOwner, async (req: Request<{ id: string }>, res: Response) => {
  const emojis = req.app.locals.bot.appEmojis;
  if (!emojis) return sendProblem(res, "bot-not-ready");
  const name: unknown = (req.body as { name?: unknown } | undefined)?.name;
  const problem = nameProblem(name);
  if (problem) return sendProblem(res, problem);
  await answer(res, async () => {
    await emojis.rename(req.params.id, name as string, () => assertSignedIn(req));
    res.json(emojiItems().find((one) => one.id === req.params.id) ?? null);
  });
});

appEmojisRouter.delete("/:id", requireOwner, async (req: Request<{ id: string }>, res: Response) => {
  const emojis = req.app.locals.bot.appEmojis;
  if (!emojis) return sendProblem(res, "bot-not-ready");
  await answer(res, async () => {
    await emojis.remove(req.params.id, () => assertSignedIn(req));
    res.status(204).end();
  });
});

// 쓰는 곳(지우기 전에 알린다): 음성 상태 설정의 키, 장르 식별자. 설정에 적힌 토큰의 id 로 찾는다
appEmojisRouter.get("/:id/uses", requireOwner, (req: Request<{ id: string }>, res: Response) => {
  const mark = `:${req.params.id}>`;
  const voice = Object.entries(VOICE_KEYS)
    .filter(([, field]) => config.voiceStatus[field].includes(mark))
    .map(([key]) => key);
  const genres = Object.entries(genreConfig.genres().genres)
    .filter(([, genre]) => genre.emoji?.includes(mark))
    .map(([id]) => id);
  res.json({ voice, genres } satisfies AppEmojiUses);
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
