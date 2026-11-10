// src/ui/mentions.ts: 외부에서 받은 문자열이 디스코드 메시지에 안전하게 실리는지.
//
// 트랙 제목, 직접 링크 파일명은 남이 정할 수 있다. 제목의 @everyone 이 봇 명의의 대규모 멘션으로 나가거나
// `[클릭](https://evil.example)` 이 안내 문구 안에서 진짜 링크로 렌더링되면 곡 하나로 피싱 링크를 심을 수 있다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { WebhookClient, MessagePayload } from "discord.js";
import { ALLOWED_MENTIONS, escapeMd, linkLabel } from "../../src/ui/mentions.ts";
import { nowPlayingView } from "../../src/ui/now-playing-info.ts";
import { NowPlayingPanel } from "../../src/ui/now-playing-panel.ts";
import type { Client } from "discord.js";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";
import { addedView } from "../../src/ui/added-notice.ts";
import { post } from "../../src/ui/frame.ts";
import { textsOf } from "../helpers/cv2.ts";
// 추가 안내가 보인 글자(ui/added-notice)
const addedText = (tracks: Array<{ title?: string }>, collection: string | null, insertFirst = false, notice = {}) => textsOf(post(addedView({ tracks, collection, insertFirst, notice })))[0];

const EVIL_MENTION = "@everyone 눌러줘 <@1234567890>";
const EVIL_LINK = "[여기를 클릭](https://evil.example)";
// 링크 라벨 안에서 라벨을 닫고 다른 주소의 링크를 만드는 제목(디스코드에서 x가 evil로 가는 링크가 된다)
const EVIL_LABEL = "x](https://evil.example) [y";
const escapesLabel = (text: string) => text.includes("](https://evil");

test("기본값: 어떤 멘션도 파싱하지 않는다", () => {
  assert.deepEqual(ALLOWED_MENTIONS.parse, []);
  assert.equal(ALLOWED_MENTIONS.repliedUser, false);
  // roles/users 화이트리스트를 두면 parse:[]의 의미가 흐려진다. 필요한 곳에서 payload로 덮어쓴다
  assert.equal("users" in ALLOWED_MENTIONS, false);
  assert.equal("roles" in ALLOWED_MENTIONS, false);
});

test("독립 WebhookClient도 멘션을 막는다 (봇 Client 옵션을 상속하지 않음)", () => {
  // now-playing은 웹훅으로 나가고, CV2 텍스트의 멘션은 임베드와 달리 실제로 알림이 간다
  const webhook = new WebhookClient({ id: "1", token: "t" }, { allowedMentions: ALLOWED_MENTIONS });
  assert.deepEqual(webhook.options.allowedMentions, ALLOWED_MENTIONS);

  // 보낼 본문(API 모양). 여기서 보는 필드만
  const body = MessagePayload.create(webhook, { content: EVIL_MENTION }).resolveBody().body as { allowed_mentions?: { parse?: string[] } } | null;
  assert.deepEqual(body?.allowed_mentions?.parse, [], "전송 payload까지 반영되어야 한다");
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
  // 본문에서는 백슬래시가 화면에 노출되지 않는다. 텍스트는 그대로 보인다
  assert.ok(escaped.includes("제목"));
  assert.ok(escaped.includes("my"));
});

test("멘션 문자열은 텍스트로 보존된다. 차단은 allowedMentions가 한다", () => {
  assert.ok(escapeMd(EVIL_MENTION).includes("@everyone"));
});

test("빈 값, 비문자열에도 안전하다", () => {
  for (const v of [null, undefined, 0, {}]) {
    assert.equal(typeof escapeMd(v), "string");
  }
});

// 실제 전송 경로. 대기열 추가 안내는 content라 서식이 그대로 해석된다
test("대기열 추가 안내: 제목의 마스크드 링크가 살아나지 않는다", () => {
  const msg = addedText([{ title: EVIL_LINK }], null, false);

  assert.ok(!/(^|[^\\])\[[^\]]*\]\(/.test(msg), msg);
  assert.ok(msg.includes("여기를 클릭"), "제목 텍스트 자체는 보여준다");
});

// 라벨 안에서는 백슬래시가 이스케이프로 해석되지 않고 화면에 그대로 보인다. 라벨을 닫는 ](만 끊는다
test("링크 라벨: ]( 사이에 폭 없는 공백을 넣어 라벨을 닫지 못하게 하고 나머지 글자는 그대로 둔다", () => {
  assert.equal(linkLabel(EVIL_LABEL), "x]\u200b(https://evil.example) [y");
  assert.equal(linkLabel("a](b](c"), "a]\u200b(b]\u200b(c");
  for (const title of ["[MV] Song (Official Video)", "my_song_name", "Song *Remix* ~ A|B"]) assert.equal(linkLabel(title), title);
});

// 디스코드는 라벨 안에 이모지, 멘션 모양, :이름: 이 있으면 링크를 버린다. 보이지 않는 VS15(\uFE0E)로 끊는다
const T = "\uFE0E";
test("링크 라벨: 웹훅이 아닌 곳은 이모지를 글자 모양으로(VS16, 피부색은 빼고 이음 글자는 그대로, 글자마다 VS15)", () => {
  assert.equal(linkLabel("Song \u{1F3B5} Remix"), `Song \u{1F3B5}${T} Remix`);
  assert.equal(linkLabel("\u{1F1F0}\u{1F1F7}"), `\u{1F1F0}${T}\u{1F1F7}${T}`, "국기는 지역 글자마다");
  assert.equal(linkLabel("\u{1F44D}\u{1F3FD}"), `\u{1F44D}${T}`, "피부색은 뺀다");
  assert.equal(linkLabel("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"), `\u{1F468}${T}\u200D\u{1F469}${T}\u200D\u{1F467}${T}`, "ZWJ 는 그대로");
  assert.equal(linkLabel("1\uFE0F\u20E3"), `1${T}\u20E3`, "키캡은 VS16 을 VS15 로");
  assert.equal(linkLabel("\u2764\uFE0F"), `\u2764${T}`);
  const england = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
  assert.equal(linkLabel(england), `\u{1F3F4}${T}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}`, "태그 국기의 태그는 그대로");
  // 디스코드가 이모지로 보지 않는 글자(VS16 없는 ❤, 기호)는 그대로
  for (const title of ["\u2764 \u2665 \u266A \u2605 \u00A9 \u2122 \u203C", "[MV] Song (Official Video)", "Re:Zero 12:30"]) assert.equal(linkLabel(title), title);
});

test("링크 라벨: 웹훅, 임베드(emojiLinks)는 이모지를 그대로 두고, 멘션 모양과 :이름: 은 어디서나 끊는다", () => {
  const title = "\u{1F525} <@123> <:pepe:1> </play:1> @everyone @here :fire:";
  const cut = `<${T}@123> <${T}:${T}pepe:1> <${T}/play:1> @${T}everyone @${T}here :${T}fire:`;
  assert.equal(linkLabel(title, { emojiLinks: true }), `\u{1F525} ${cut}`);
  assert.equal(linkLabel(title), `\u{1F525}${T} ${cut}`);
});

test("now-playing 제목은 라벨에 들어가고, 라벨을 닫는 ](만 끊긴다", async () => {
  const mem = new NowPlayingPanel(fake<Client>({}), new Map());
  const track: QueuedTrack = { title: "게임 실황 [Official] my_song_name", pageUrl: "https://ok.example", requestKey: "https://ok.example", duration: 100, platform: "youtube", thumbnail: null, artist: "아티스트" };
  const player = fakePlayer({ getCurrentTime: () => 0, queue: [], previousTracks: [], loop: false, paused: false, pause: { heldBy: null, userPaused: false } });

  const container = await mem.createNowPlayingContainer(player, track);
  const json = JSON.stringify(container.toJSON());

  assert.ok(json.includes("게임 실황 [Official] my_song_name"), "제목이 변형 없이 들어가야 한다");
  assert.ok(!json.includes("my\\\\_song"), "라벨에 백슬래시가 들어가면 화면에 그대로 노출된다");
  const evil = JSON.stringify((await mem.createNowPlayingContainer(player, { ...track, title: EVIL_LABEL })).toJSON());
  assert.ok(!escapesLabel(evil), evil);
  const emoji = { ...track, title: "Song \u{1F3B5}" };
  assert.ok(JSON.stringify((await mem.createNowPlayingContainer(player, emoji, false, null, true)).toJSON()).includes("[Song \u{1F3B5}]("), "웹훅 패널은 이모지 그대로");
  assert.ok(JSON.stringify((await mem.createNowPlayingContainer(player, emoji, false, null)).toJSON()).includes("[Song \u{1F3B5}\uFE0E]("), "채널 메시지 패널은 글자 모양");
});

test("/nowplaying 곡 정보: 지금 곡과 다음 곡의 제목이 라벨을 닫지 못한다", () => {
  const song = (n: number): QueuedTrack => ({ title: EVIL_LABEL, pageUrl: `https://ok.example/${n}`, requestKey: `https://ok.example/${n}`, duration: 100, platform: "youtube", thumbnail: null });
  const player = fakePlayer({ getCurrentTime: () => 0, queue: [song(2)], previousTracks: [], loop: false, paused: false, autoplay: null, pause: { heldBy: null, userPaused: false } });
  const json = JSON.stringify(nowPlayingView(player, song(1)).toJSON());
  assert.ok(!escapesLabel(json), json);
});
