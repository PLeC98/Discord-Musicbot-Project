// 대시보드가 쓰는 앱 이모지: 목록(문자를 붙여서), 이미지, 입력란용 그림 글꼴(app-emoji-font).
// 이미지는 database/dashboard/app-emojis/<id>.<png|gif> 에 캐시한다. 지금 앱 목록(store/app-emoji-book)에 있는 id 만 CDN 에서 한 번 다운로드한다
// (아무 이모지 id 로 봇이 받아 저장하게 하지 않으려고). 이모지의 이미지는 디스코드에서 바뀌지 않아 id 하나에 한 번이면 된다. 캐시라 백업하지 않는다.
// 글꼴은 목록이 바뀌면 다시 만들어 메모리에 둔다(이모지마다 64px PNG, 움직이는 것은 첫 프레임)

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import logger from "../infra/log/logger.ts";
import { httpFor } from "../infra/http.ts";
import { PROJECT } from "../infra/project-paths.ts";
import { messageOf } from "../rules/error-kind.ts";
import { appEmojis } from "../store/app-emoji-book.ts";
import { iconEntries } from "../ui/icons.ts";
import { charsFor } from "../store/app-emoji-records.ts";
import { buildEmojiFont, type EmojiFontFormat } from "./app-emoji-font.ts";
import type { AppEmojiItem } from "./contract/app-emojis.ts";
const log = logger.child({ category: "dashboard" });

let dir = path.join(PROJECT.dashboardData, "app-emojis");
const cdn = httpFor("discord");
const CDN_TIMEOUT_MS = 15_000;
/** 글꼴에 담는 그림의 한 변(px). 입력란 글자 크기(14 ~ 18px)의 3배쯤 */
const GLYPH_SIZE = 64;
const FAMILY = "Musicbot App Emoji";

type Image = { data: Buffer; animated: boolean };
const downloading = new Map<string, Promise<Image | null>>();

const fileOf = (id: string, animated: boolean) => path.join(dir, `${id}.${animated ? "gif" : "png"}`);

/** 앱 이모지의 이미지. 지금 앱 목록에 없는 id 면 null */
async function imageOf(id: string): Promise<Image | null> {
  const emoji = appEmojis().find((one) => one.id === id);
  if (!emoji) return null;
  // 경로와 CDN 주소에는 요청의 id 가 아니라 목록의 id 를 쓴다
  const file = fileOf(emoji.id, emoji.animated);
  if (fs.existsSync(file)) return { data: fs.readFileSync(file), animated: emoji.animated };
  const pending = downloading.get(emoji.id) ?? download(emoji.id, emoji.animated, file).finally(() => downloading.delete(emoji.id));
  downloading.set(emoji.id, pending);
  return pending;
}

async function download(id: string, animated: boolean, file: string): Promise<Image | null> {
  try {
    const res = await cdn.fetch(`https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`, { signal: AbortSignal.timeout(CDN_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, data);
    return { data, animated };
  } catch (error) {
    log.warn(`앱 이모지 이미지 다운로드 실패(대시보드에 그 이모지가 빈 칸으로 보임): ${id}: ${messageOf(error)}`);
    return null;
  }
}

/** 앱 목록에 없는 id 의 캐시 파일을 지운다 */
function pruneImages() {
  if (!fs.existsSync(dir)) return;
  const ids = new Set(appEmojis().map((one) => one.id));
  for (const name of fs.readdirSync(dir)) {
    const id = /^(\d{17,20})\.(png|gif)$/.exec(name)?.[1];
    if (id && !ids.has(id)) fs.rmSync(path.join(dir, name), { force: true });
  }
}

/** 목록: 앱 이모지마다 입력란 문자를 붙인다. 아이콘은 이름으로(운영자 색이 바뀌어 id 가 바뀌어도 같은 문자), 그 밖은 id 로 */
function emojiItems(): AppEmojiItem[] {
  const icons = new Set(iconEntries().map((entry) => entry.name));
  const keyOf = (emoji: { id: string; name: string }) => (icons.has(emoji.name) ? `icon:${emoji.name}` : `id:${emoji.id}`);
  const list = appEmojis();
  const chars = charsFor(list.map(keyOf));
  return list.flatMap((emoji) => {
    const codepoint = chars.get(keyOf(emoji));
    return codepoint === undefined ? [] : [{ id: emoji.id, name: emoji.name, animated: emoji.animated, icon: icons.has(emoji.name), char: String.fromCodePoint(codepoint) }];
  });
}

/** 목록의 버전: 글꼴 주소의 ETag. 이모지, 문자가 바뀌면 바뀐다 */
const versionOf = (items: readonly AppEmojiItem[]) =>
  createHash("sha256")
    .update(items.map((one) => `${one.id}:${String(one.char.codePointAt(0))}`).join(","))
    .digest("hex")
    .slice(0, 16);

let fonts: { version: string; sbix: Buffer; svg: Buffer } | null = null;
let building: { version: string; done: Promise<void> } | null = null;

/** 입력란용 그림 글꼴과 그 버전. 지금 목록으로 만든 것이 없으면 만든다 */
async function emojiFont(format: EmojiFontFormat): Promise<{ version: string; data: Buffer }> {
  const items = emojiItems();
  const version = versionOf(items);
  if (fonts?.version !== version) {
    if (building?.version !== version) building = { version, done: buildFonts(items, version).catch((error: unknown) => ((building = null), Promise.reject(error))) };
    await building.done;
  }
  return { version, data: fonts![format] };
}

async function buildFonts(items: readonly AppEmojiItem[], version: string) {
  const glyphs = [];
  for (const item of items) {
    const image = await imageOf(item.id);
    if (!image) continue;
    const png = await sharp(image.data, { pages: 1 })
      .resize(GLYPH_SIZE, GLYPH_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ palette: true })
      .toBuffer();
    glyphs.push({ codepoint: item.char.codePointAt(0)!, png });
  }
  fonts = { version, sbix: buildEmojiFont(FAMILY, glyphs, GLYPH_SIZE, "sbix"), svg: buildEmojiFont(FAMILY, glyphs, GLYPH_SIZE, "svg") };
  pruneImages();
  log.debug(`앱 이모지 글꼴: ${glyphs.length}개, sbix ${fonts.sbix.length}B, SVG ${fonts.svg.length}B`);
}

/** 테스트용: 캐시 폴더를 바꾸고 만들어 둔 글꼴을 비운다 */
function _useDir(folder: string) {
  dir = folder;
  fonts = null;
  building = null;
}

export { imageOf, emojiItems, emojiFont, versionOf, GLYPH_SIZE, FAMILY, _useDir };
