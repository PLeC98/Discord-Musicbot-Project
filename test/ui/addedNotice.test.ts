// src/ui/addedNotice.ts — 곡을 담은 안내. 다 담았으면 기본 색, 일부만 담았으면 경고 색

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveColor } from "discord.js";
import config from "../../config.ts";
import { addedView } from "../../src/ui/addedNotice.ts";

const accentOf = (c: ReturnType<typeof addedView>) => (c.toJSON() as { accent_color?: number }).accent_color;
const tracks = [{ title: "곡" }, { title: "곡2" }];

test("다 담았으면 기본 색, 받을 수 없어 뺐거나 대기열이 찼으면 경고 색", () => {
  assert.equal(accentOf(addedView({ tracks, collection: "playlist", notice: { total: 40 } })), resolveColor(config.bot.embedColor));
  for (const notice of [{ skipped: 1 }, { dropped: 1 }, { queueLimited: true }]) assert.equal(accentOf(addedView({ tracks, collection: "playlist", notice })), resolveColor("#FEE75C"), JSON.stringify(notice));
});
