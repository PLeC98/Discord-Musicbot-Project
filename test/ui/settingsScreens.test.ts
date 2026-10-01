// src/ui/settingsScreens.ts — 서버 설정 화면. 저장한 결과는 완료 색, 화면 · 취소 · 지금 값은 기본 색

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveColor } from "discord.js";
import config from "../../config.ts";
import * as screens from "../../src/ui/settingsScreens.ts";
import { post } from "../../src/ui/frame.ts";
import { screenOf } from "../helpers/cv2.ts";

const accentOf = (c: ReturnType<typeof screens.saved>) => (c.toJSON() as { accent_color?: number }).accent_color;

test("저장한 결과는 완료 색, 그 밖은 기본 색", () => {
  assert.equal(accentOf(screens.saved({ title: "t", description: "d" })), resolveColor("#57F287"));
  assert.equal(accentOf(screens.shown({ title: "t", description: "d" })), resolveColor(config.bot.embedColor));
  assert.equal(accentOf(screens.djRoleMenu([])), resolveColor(config.bot.embedColor));
});

test("전용 채널을 정한 결과: 받는 입력을 본문 끝에", () => {
  const s = screenOf(post(screens.channelSet("<#c1>")));
  assert.equal(s.title, "✅ 봇 채널 설정됨");
  assert.match(s.body, /<#c1>이\(가\) 봇 전용 채널로 설정됐어요!/);
  assert.match(s.body, /\*\*📋 지원 입력\*\*\n• YouTube, Spotify, SoundCloud URL\n• 곡 이름이나 아티스트 검색어$/);
  assert.equal(accentOf(screens.channelSet("<#c1>")), resolveColor("#57F287"));
});

test("SponsorBlock 화면: 구간 메뉴와 토글 · 저장 · 취소", () => {
  const s = screenOf(post(screens.sponsorMenu({ enabled: false, globalOff: false, options: [{ label: "인트로", value: "intro", default: true }] })));
  assert.deepEqual([s.rows, s.buttons], [2, ["sb:toggle", "sb:save", "sb:cancel"]]);
});
