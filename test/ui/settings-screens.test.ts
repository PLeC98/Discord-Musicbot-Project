// src/ui/settings-screens.ts — 서버 설정 화면. 저장한 결과는 완료 색, 화면 · 취소 · 지금 값은 기본 색

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveColor } from "discord.js";
import config from "../../src/config/index.ts";
import * as screens from "../../src/ui/settings-screens.ts";
import { post } from "../../src/ui/frame.ts";
import { screenOf } from "../helpers/cv2.ts";

const accentOf = (c: ReturnType<typeof screens.saved>) => (c.toJSON() as { accent_color?: number }).accent_color;

test("저장한 결과는 완료 색, 그 밖은 기본 색", () => {
  assert.equal(accentOf(screens.saved({ title: "t", description: "d" })), resolveColor("#57F287"));
  assert.equal(accentOf(screens.shown({ title: "t", description: "d" })), resolveColor(config.bot.embedColor));
});

test("전용 채널을 정한 결과: 받는 입력을 본문 끝에", () => {
  const s = screenOf(post(screens.channelSet("<#c1>")));
  assert.equal(s.title, "✅ 전용 채널 설정됨");
  assert.match(s.body, /<#c1> 채널을 봇 전용 채널로 설정했어요\./);
  assert.match(s.body, /\*\*📋 입력할 수 있는 것\*\*\n• 지원하는 플랫폼 링크 \(유튜브, 스포티파이, 사운드클라우드\)\n• 재생 가능한 미디어 링크\n• 곡 이름이나 아티스트 이름 등의 검색어$/);
  assert.equal(accentOf(screens.channelSet("<#c1>")), resolveColor("#57F287"));
});
