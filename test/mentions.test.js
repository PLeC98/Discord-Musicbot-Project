"use strict";

// src/mentions.js — 외부에서 받은 문자열이 디스코드 메시지에 안전하게 실리는지.
//
// 회귀 대상 1: 트랙 제목·직접 링크 파일명은 공격자가 정할 수 있는데 그대로 content에 들어갔다.
// allowedMentions가 한 곳도 없어서 제목에 @everyone을 넣으면 봇 명의로 대규모 멘션이 나갔다.
// 회귀 대상 2: 제목이 `[클릭](https://evil.example)`이면 안내 문구 안에서 진짜 클릭되는
// 링크로 렌더링됐다(2026-09-08 실측). 곡 하나 추가할 수 있으면 피싱 링크를 심을 수 있었다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { WebhookClient, MessagePayload } = require("discord.js");
const { ALLOWED_MENTIONS, escapeMd } = require("../src/mentions");
const MusicEmbedManager = require("../src/MusicEmbedManager");

const EVIL_MENTION = "@everyone 눌러줘 <@1234567890>";
const EVIL_LINK = "[여기를 클릭](https://evil.example)";

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

  const body = MessagePayload.create(webhook, { content: EVIL_MENTION }).resolveBody().body;
  assert.deepEqual(body.allowed_mentions.parse, [], "전송 payload까지 반영되어야 한다");
});

test("마스크드 링크 주입을 무력화한다", () => {
  const escaped = escapeMd(EVIL_LINK);
  // 여는 대괄호가 이스케이프되면 [라벨](url) 형태가 성립하지 않는다
  assert.ok(escaped.startsWith("\\["), escaped);
  assert.ok(!/(^|[^\\])\[[^\]]*\]\(/.test(escaped), "클릭 가능한 마스크드 링크가 남으면 안 된다");
});

test("서식 문자는 이스케이프하되 텍스트는 보존한다", () => {
  const escaped = escapeMd("곡 **제목** 과 my_song_name");
  assert.ok(!/(?<!\\)\*\*/.test(escaped), "굵게 표시가 살아 있으면 안 된다");
  // 본문에서는 백슬래시가 화면에 노출되지 않는다(실측) — 텍스트는 그대로 보인다
  assert.ok(escaped.includes("제목"));
  assert.ok(escaped.includes("my"));
});

test("멘션 문자열은 텍스트로 보존된다 — 차단은 allowedMentions가 한다", () => {
  assert.ok(escapeMd(EVIL_MENTION).includes("@everyone"));
});

test("빈 값·비문자열에도 안전하다", () => {
  for (const v of [null, undefined, 0, {}]) {
    assert.equal(typeof escapeMd(v), "string");
  }
});

// 실제 전송 경로 — 대기열 추가 안내는 content라 서식이 그대로 해석된다
test("대기열 추가 안내: 제목의 마스크드 링크가 살아나지 않는다", () => {
  const mem = new MusicEmbedManager({ players: new Map() });
  const msg = mem.createQueueAdditionMessage([{ title: EVIL_LINK }], false, false);

  assert.ok(!/(^|[^\\])\[[^\]]*\]\(/.test(msg), msg);
  assert.ok(msg.includes("여기를 클릭"), "제목 텍스트 자체는 보여준다");
});

// now-playing 제목은 마스크드 링크의 "라벨" 자리라 이스케이프하지 않는다.
// 라벨 안에서는 백슬래시가 이스케이프로 해석되지 않고 화면에 그대로 노출된다(실측).
// 라벨 밖으로 탈출해 다른 URL을 거는 것도 불가능함을 확인했다 — 라벨이 깨지면
// 디스코드가 링크 자체를 만들지 않는다.
test("now-playing 제목은 원문 그대로 라벨에 들어간다", async () => {
  const mem = new MusicEmbedManager({ players: new Map() });
  const track = { title: "게임 실황 [Official] my_song_name", url: "https://ok.example", duration: 100, platform: "youtube", thumbnail: null, artist: "아티스트" };
  const player = { getCurrentTime: () => 0, queue: [], previousTracks: [], loop: false, shuffle: false, isPlaybackActive: () => true, getStatus: () => ({ playing: true, paused: false, volume: 100, loop: false, shuffle: false }) };

  const container = await mem.createNowPlayingContainer(player, track);
  const json = JSON.stringify(container.toJSON());

  assert.ok(json.includes("게임 실황 [Official] my_song_name"), "제목이 변형 없이 들어가야 한다");
  assert.ok(!json.includes("my\\\\_song"), "라벨에 백슬래시가 들어가면 화면에 그대로 노출된다");
});
