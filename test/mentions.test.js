"use strict";

// src/mentions.js — 외부에서 받은 문자열이 디스코드 메시지에 안전하게 실리는지.
//
// 회귀 대상: 트랙 제목·직접 링크 파일명은 공격자가 정할 수 있는데 그대로 content에 들어갔다.
// allowedMentions가 코드 전체에 한 곳도 없어서 제목에 @everyone을 넣으면 봇 명의로
// 대규모 멘션이 나갔다. 초대 링크가 permissions=8이라 실제 알림 영향이 크다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { WebhookClient, MessagePayload } = require("discord.js");
const { ALLOWED_MENTIONS, escapeMd, escapeMdLink } = require("../src/mentions");
const MusicEmbedManager = require("../src/MusicEmbedManager");

const EVIL = "@everyone 눌러줘 <@1234567890> **굵게** [링크](http://evil.example)";

test("기본값: 어떤 멘션도 파싱하지 않는다", () => {
  assert.deepEqual(ALLOWED_MENTIONS.parse, []);
  assert.equal(ALLOWED_MENTIONS.repliedUser, false);
  // roles/users 화이트리스트를 두면 parse:[]의 의미가 흐려진다 — 필요한 곳에서 payload로 덮어쓴다
  assert.equal("users" in ALLOWED_MENTIONS, false);
  assert.equal("roles" in ALLOWED_MENTIONS, false);
});

test("독립 WebhookClient도 멘션을 막는다 (봇 Client 옵션을 상속하지 않음)", () => {
  // now-playing은 웹훅으로 나가고, CV2 텍스트의 멘션은 임베드와 달리 실제로 알림이 간다
  const webhook = new WebhookClient({ id: "1", token: "t" }, { allowedMentions: ALLOWED_MENTIONS });
  assert.deepEqual(webhook.options.allowedMentions, ALLOWED_MENTIONS);

  const body = MessagePayload.create(webhook, { content: EVIL }).resolveBody().body;
  assert.deepEqual(body.allowed_mentions.parse, [], "전송 payload까지 반영되어야 한다");
});

test("마크다운 이스케이프: 서식 문자가 문자 그대로 남는다", () => {
  const escaped = escapeMd(EVIL);
  assert.ok(!/(?<!\\)\*\*/.test(escaped), "굵게 표시가 살아 있으면 안 된다");
  assert.ok(escaped.includes("@everyone"), "텍스트 자체는 보존 — 차단은 allowedMentions가 한다");
});

test("링크 라벨 이스케이프: 대괄호가 [라벨](url) 구조를 깨지 못한다", () => {
  const label = escapeMdLink("정상곡](http://evil.example) 클릭");
  assert.ok(!/(?<!\\)[[\]]/.test(label), "이스케이프되지 않은 대괄호가 남으면 링크가 탈출된다");

  // 실제 사용 형태로 조립했을 때 링크 대상이 우리가 준 URL 하나뿐인지
  const rendered = `[${label}](https://ok.example)`;
  assert.equal(rendered.match(/(?<!\\)\]\(/g).length, 1);
});

test("이스케이프는 빈 값·비문자열에도 안전하다", () => {
  for (const v of [null, undefined, 0, {}]) {
    assert.equal(typeof escapeMd(v), "string");
    assert.equal(typeof escapeMdLink(v), "string");
  }
});

// 실제 전송 경로 — 대기열 추가 안내는 content라 서식이 그대로 해석된다
test("대기열 추가 안내: 트랙 제목의 서식 문자가 살아나지 않는다", () => {
  const mem = new MusicEmbedManager({ players: new Map() });
  const msg = mem.createQueueAdditionMessage([{ title: EVIL }], false, false);

  assert.ok(msg.includes("@everyone"), "제목은 그대로 보여준다");
  // 이스케이프되면 별표 사이에 백슬래시가 끼므로 인접한 ** 는 안내 문구 자신의 것 한 쌍뿐이다
  assert.equal(msg.split("**").length - 1, 2);
});
