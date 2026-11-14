// src/discord/commands 의 표시, 설정 명령: 지금 동작을 고정한다(/setting 의 버튼, 메뉴는 test/events/settings-panel).
// /nowplaying, /queue, /help, /system, /cachestatus, /setchannel, /setting.
//
// 문구 전부가 아니라 "무엇을 선택해 담았나 ·
// 무엇을 저장했나"를 본다. 서버 설정과 캐시 통계는 진짜 저장소(임시 DB)로 돈다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import { LIFETIME, expireSelf, expiring, lifetimesOf, stopExpiry } from "../../src/ui/delivery.ts";
import assert from "node:assert/strict";
import { MessageFlags, PermissionFlagsBits, type ButtonInteraction, type Client, type StringSelectMenuInteraction } from "discord.js";

import { cacheDb } from "../../src/store/cache-db.ts";
import { settingsDb } from "../../src/store/settings-db.ts";
import * as stores from "../../src/store/stores.ts";
import { command, run, runViaEntrance } from "../helpers/commands.ts";
import { withConfig } from "../helpers/config.ts";
import { whenSettingsBroken } from "../helpers/temp-store.ts";
import { remember } from "../helpers/tagged-audio.ts";
import { _internals as discordArt } from "../../src/ui/discord-art.ts";
import { fakePlayer, fakeWith, fakeBot } from "../helpers/fake.ts";
import type { Player } from "../../src/player/player.ts";
import { noticeReply } from "../../src/ui/frame.ts";
import { useUploaded } from "../../src/ui/icons.ts";
import { screenOf, textOf, thumbnailOf } from "../helpers/cv2.ts";
import { COMMANDS as COMMAND_LIST } from "../../src/discord/commands/index.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "commands-info-"));
const audioCache = await import("../../src/store/audio-cache.ts");
const trackLookup = await import("../../src/store/track-lookup.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
stores.open(TMP);
audioCache.initialize();

const config = (await import("../../src/config/index.ts")).default;
const errors = await import("../../src/ui/text/ko/errors.ts");
const settings = await import("../../src/store/guild-settings.ts");

after(() => {
  audioCache.close();
  stores.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

beforeEach(() => {
  settings.forgetCache();
  settingsDb.get().exec("DELETE FROM guild_settings;");
  cacheDb.get().exec("DELETE FROM track_lookup; DELETE FROM audio_cache;");
});

// 보낸 응답. 여기서 보는 필드만
type Sent = {
  content?: string;
  flags?: unknown;
  embeds: Array<{ data: { title?: string; description?: string; fields?: Array<{ name: string; value: string }>; footer?: { text: string }; thumbnail?: { url: string } } }>;
  components: Array<{ components: Array<{ data: { custom_id?: string; default_values?: Array<{ id: string }> } }> }>;
};
type Logged = [name: string, payload: Sent];

const fieldsOf = (payload: Sent) => Object.fromEntries((payload.embeds[0].data.fields || []).map((f) => [f.name, f.value]));
// /nowplaying 의 글 줄들(위에서부터)
const nowLines = (payload: unknown) => textOf(payload).split("\n");

type InteractionOptions = { player?: object | null; options?: Record<string, unknown>; userId?: string; guildRoles?: string[]; manage?: boolean; channelId?: string };

function interaction({ player = null, options = {}, userId = "u1", guildRoles = [], manage = true, channelId = "c1" }: InteractionOptions = {}) {
  const log: Logged[] = [];
  const seen: string[] = [];
  // 서버 목록. 명령이 수를 세고 모은다
  const guilds = new Map([["g1", { memberCount: 5 }]]);
  const client = fakeWith<Client<true>>()({
    guilds: { cache: Object.assign(guilds, { reduce: (fn: (acc: number, g: { memberCount: number }) => number, init: number) => [...guilds.values()].reduce(fn, init) }) },
    user: { username: "뮤직봇", displayAvatarURL: () => "https://avatar.test/a.png" },
  });
  const bot = fakeBot({
    client,
    players: new Map<string, Player>(player ? [["g1", fakePlayer(player)]] : []),
    panels: { onBotChannelChanged: async () => seen.push("movePanel") },
    // 실행 목록. /help 가 이것으로 명령 줄을 만든다
    commands: new Map(COMMAND_LIST.map((command) => [command.data.name, command])),
  });
  const it = {
    guild: { id: "g1", roles: { cache: new Map(guildRoles.map((r) => [r, { id: r }])) } },
    user: { id: userId },
    member: { id: userId },
    client,
    channel: { id: channelId, toString: () => `<#${channelId}>` },
    channelId,
    memberPermissions: { has: (p: bigint) => manage && p === PermissionFlagsBits.ManageGuild },
    replied: false,
    deferred: false,
    options: { getString: (n: string) => options[n] ?? null, getInteger: (n: string) => options[n] ?? null, getChannel: (n: string) => options[n] ?? null },
    reply: async (p: Sent) => {
      it.replied = true;
      log.push(["reply", p]);
    },
    deferReply: async (p: Sent) => {
      it.deferred = true;
      log.push(["deferReply", p]);
    },
    editReply: async (p: Sent) => log.push(["editReply", p]),
    fetchReply: async () => ({ id: "reply-msg" }),
  };
  return { it, log, seen, client, bot };
}

// ── /nowplaying ───────────────────────────────────────────────────────

type Status = { playing: boolean; paused: boolean; volume: number; loop: string | false };

function nowPlayer(track: object | null, status: Status = { playing: true, paused: false, volume: 70, loop: "track" }) {
  const audio = status.playing ? "playing" : status.paused ? "paused" : "idle";
  return { currentTrack: track, getCurrentTime: () => 90_000, audioPlayer: { state: { status: audio } }, paused: status.paused, volume: status.volume, loop: status.loop };
}

test("/nowplaying: 플레이어나 곡이 없으면 본인에게만 알린다", async () => {
  const none = interaction();
  await run(await command("nowplaying"), none.it, none.bot);
  assert.deepEqual(none.log[0][1], noticeReply(errors.notice("no-song")));

  const idle = interaction({ player: nowPlayer(null) });
  await run(await command("nowplaying"), idle.it, idle.bot);
  assert.deepEqual(idle.log[0][1], noticeReply(errors.notice("no-song")));
});

test("/nowplaying: 패널과 같은 머리, 진행, 이 곡(상태, 요청, 출처, 음원), 이어질 것(다음, 대기열, 자동재생)", async () => {
  const track = { title: "곡", url: "https://open.spotify.com/track/x", pageUrl: "https://open.spotify.com/track/x", audioUrl: "https://www.youtube.com/watch?v=abc", audioFoundBy: "ledger", artist: "가수", album: "앨범", platform: "spotify", duration: 200, requestedBy: { id: "u9" }, thumbnail: "https://thumb" };
  const queue = [
    { title: "다음 곡", pageUrl: "https://youtu.be/n", artist: "다음 가수", duration: 100 },
    { title: "그 다음", pageUrl: "https://youtu.be/m", duration: 0 },
  ];
  const { it, log, bot } = interaction({ player: { ...nowPlayer(track), queue, autoplay: "kpop" } });

  await run(await command("nowplaying"), it, bot);

  const lines = nowLines(log[0][1]);
  assert.deepEqual(lines.slice(0, 3), ["### 🎵 현재 재생 중", "**[곡](https://open.spotify.com/track/x)**", "-# 🎤 가수 · 💿 앨범"]);
  assert.match(lines[3], /^`1:30` ▬+●▬+ `3:20`$/, "재생 패널과 같은 막대");
  assert.equal(lines[4], "-# 📊 **상태** ▶️ 재생 중 • 🔊 70% • 🔂 한 곡 반복");
  assert.equal(lines[5], "-# 👤 **요청** <@u9>");
  assert.equal(lines[6], "-# 🌐 **출처** Spotify");
  assert.equal(lines[7], "-# 🔗 **음원** [YouTube](https://www.youtube.com/watch?v=abc) · 자동 검색 결과");
  assert.equal(lines[8], "-# ⏭️ **다음** [다음 곡](https://youtu.be/n) · 다음 가수");
  assert.equal(lines[9], "-# 📋 **대기열** 2곡 · 1:40 이상", "길이를 모르는 곡이 있으면 이상");
  assert.match(lines[10], /^-# 🎲 \*\*자동재생\*\* 켜짐 · /);
  assert.equal(thumbnailOf(log[0][1] as never), "https://thumb");
  assert.deepEqual(log[0][1].flags, [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral], "본인에게만(패널이 모두에게 이미 보인다)");
});

test("/nowplaying: 유튜브 큰 썸네일 확인을 기다리지 않고 답한다(아는 답, 모르면 hqdefault)", async () => {
  let release!: (value: { ok: boolean; status: number }) => void;
  discordArt.useHead(() => new Promise((resolve) => (release = resolve)));
  try {
    const { it, log, bot } = interaction({ player: nowPlayer({ title: "곡", pageUrl: "https://youtu.be/nowplaying1", thumbnail: "https://i.ytimg.com/vi/nowplaying1/mqdefault.jpg", duration: 200 }) });
    await run(await command("nowplaying"), it, bot);
    assert.equal(log.length, 1, "확인이 끝나기 전에 답했다");
    assert.equal(thumbnailOf(log[0][1] as never), "https://i.ytimg.com/vi/nowplaying1/hqdefault.jpg");
  } finally {
    release({ ok: true, status: 200 });
    discordArt.useHead(async () => ({ ok: true, status: 200 }));
  }
});

test("/nowplaying: 대기열 곡의 길이를 다 모르면(라이브, 길이 0) 합계 칸을 빼고 곡 수만", async () => {
  const track = { title: "곡", pageUrl: "https://youtu.be/a", platform: "youtube", duration: 200, requestedBy: { id: "u9" } };
  const queue = [
    { title: "라이브", pageUrl: "https://youtu.be/l", duration: 0, isLive: true },
    { title: "모름", pageUrl: "https://youtu.be/m", duration: 0 },
  ];
  const { it, log, bot } = interaction({ player: { ...nowPlayer(track), queue } });
  await run(await command("nowplaying"), it, bot);
  assert.ok(nowLines(log[0][1]).includes("-# 📋 **대기열** 2곡"), "0:00 이상이 아니라");
});

test("/nowplaying: 앱 이모지를 맞춘 뒤에 그리면 머리의 아이콘도 앱 이모지(불러올 때 유니코드로 굳지 않는다)", async (t) => {
  t.after(() => useUploaded(new Map()));
  useUploaded(
    new Map([
      ["music", { id: "1", animated: false }],
      ["artist", { id: "2", animated: false }],
      ["album", { id: "3", animated: false }],
    ]),
  );
  const track = { title: "곡", url: "u", pageUrl: "u", artist: "가수", album: "앨범", platform: "youtube", duration: 200, thumbnail: "https://thumb" };
  const { it, log, bot } = interaction({ player: nowPlayer(track) });
  await run(await command("nowplaying"), it, bot);
  const lines = nowLines(log[0][1]);
  assert.equal(lines[0], "### <:music:1> 현재 재생 중");
  assert.equal(lines[2], "-# <:artist:2> 가수 · <:album:3> 앨범");
});

test("/nowplaying: 직접 링크 곡은 찾아 둔 파일 태그 그림을 첨부해 건다(패널과 같게)", async (t) => {
  const url = "https://files.test/nowplaying-art.mp3";
  if (!(await remember(url))) return t.skip("ffmpeg로 픽스처를 만들 수 없음");
  const track = { title: "파일", url, pageUrl: url, requestKey: url, audioUrl: url, platform: "direct", duration: 3, thumbnail: null };
  const { it, log, bot } = interaction({ player: nowPlayer(track) });
  await run(await command("nowplaying"), it, bot);
  assert.equal(thumbnailOf(log[0][1] as never), "attachment://art.jpg");
  assert.deepEqual(
    (log[0][1] as { files?: Array<{ name: string }> }).files?.map((file) => file.name),
    ["art.jpg"],
  );
});

test("/nowplaying: 멈춤, 준비 중, 대기열 반복, 길이를 모르면 진행을 뺀다, 던지면 진입점이 알린다", async () => {
  const paused = interaction({ player: nowPlayer({ title: "곡", url: "u", platform: "direct", duration: 0 }, { playing: false, paused: true, volume: 10, loop: "queue" }) });
  await run(await command("nowplaying"), paused.it, paused.bot);
  const lines = nowLines(paused.log[0][1]);
  assert.ok(lines.includes("-# 📊 **상태** ⏸️ 일시정지 • 🔊 10% • 🔁 대기열 반복"));
  assert.ok(!lines.some((line) => line.includes("●")), "길이를 모르면 진행 막대가 없다");
  assert.ok(!lines.some((line) => line.includes("**요청**")), "요청자를 모르면 줄이 없다");
  assert.ok(!lines.some((line) => line.includes("**음원**")), "요청 그대로 트는 곡은 음원 줄이 없다");
  assert.ok(lines.includes("-# ⏭️ **다음** 없음"));
  assert.ok(!lines.some((line) => line.includes("**자동재생**")), "자동재생이 꺼져 있으면 줄이 없다");

  const stopped = interaction({ player: nowPlayer({ title: "곡", url: "u" }, { playing: false, paused: false, volume: 1, loop: false }) });
  await run(await command("nowplaying"), stopped.it, stopped.bot);
  assert.ok(nowLines(stopped.log[0][1]).includes("-# 📊 **상태** ⏳ 준비 중 • 🔊 1%"));

  const broken = interaction({
    player: {
      currentTrack: { title: "곡", duration: 100 },
      getCurrentTime: () => {
        throw new Error("x");
      },
    },
  });
  await runViaEntrance(await command("nowplaying"), broken.it, broken.bot);
  assert.deepEqual(broken.log, [["reply", noticeReply(errors.notice("command-failed"))]]);
});

// ── /queue ────────────────────────────────────────────────────────────

const queuePlayer = (current: object | null, queue: object[]) => ({ currentTrack: current, queue });

test("/queue: 플레이어가 없거나 비었으면 알린다", async () => {
  const none = interaction();
  await run(await command("queue"), none.it, none.bot);
  assert.deepEqual(none.log[0][1], noticeReply(errors.notice("no-song")));
  const empty = interaction({ player: queuePlayer(null, []) });
  await run(await command("queue"), empty.it, empty.bot);
  assert.deepEqual(empty.log[0][1], noticeReply(errors.notice("queue-empty")));
  // 대기열 화면은 다음 곡만 보인다. 지금 곡만 있으면 비었다고 한다
  const onlyNow = interaction({ player: queuePlayer({ title: "지금", pageUrl: "now" }, []) });
  await run(await command("queue"), onlyNow.it, onlyNow.bot);
  assert.deepEqual(onlyNow.log[0][1], noticeReply(errors.notice("queue-empty")));
});

// 대기열은 본문(description)에 싣는다. 필드(field)에 나눠 실으면 필드마다 이름 줄이 생겨 빈 여백이 낀다
const descriptionOf = (payload: Sent) => String(payload.embeds[0].data.description ?? "");

test("/queue: 다음 곡만 페이지마다 나눠 보인다. 없는 페이지는 마지막 페이지로", async () => {
  const queue = Array.from({ length: 25 }, (_, i) => ({ title: `곡${i + 1}`, pageUrl: `u${i}`, duration: 60 }));
  const first = interaction({ player: queuePlayer({ title: "지금", pageUrl: "now" }, queue) });
  await run(await command("queue"), first.it, first.bot);
  const p1 = first.log[0][1];
  assert.match(descriptionOf(p1), /^`1\.` \*\*\[곡1\]\(u0\)\*\*/);
  assert.doesNotMatch(descriptionOf(p1), /지금/, "지금 곡은 재생 패널이 보인다");
  assert.equal(p1.embeds[0].data.fields, undefined, "필드를 쓰지 않는다");
  assert.equal(p1.embeds[0].data.footer?.text, "모두 25곡 • 1/3 페이지");
  assert.deepEqual(lifetimesOf(first.it), [LIFETIME.screen], "읽는 화면의 수명");

  const last = interaction({ player: queuePlayer({ title: "지금", pageUrl: "now" }, queue), options: { page: 9 } });
  await run(await command("queue"), last.it, last.bot);
  const p3 = last.log[0][1];
  assert.match(descriptionOf(p3), /`21\.` \*\*\[곡21\]/, "번호는 쪽을 이어 센다");
  assert.equal(p3.embeds[0].data.footer?.text, "모두 25곡 • 3/3 페이지");
});

// 필드 하나(1024자)에 실으면 링크가 붙은 긴 유튜브 제목 열 줄로 넘쳐 명령이 통째로 실패한다.
// 본문은 4096자지만 서명된 직접 링크, 한글이 인코딩된 주소는 수백 자라, 넘치면 주소가 긴 곡부터 링크를 뗀다
test("/queue: 긴 주소가 섞여도 본문 상한 안에 열 줄이 다 들어가고, 링크는 주소가 긴 곡부터 뗀다", async () => {
  const who = { id: "123456789012345678" };
  const long = (i: number) => ({ title: "가".repeat(150), pageUrl: `https://cdn.example.com/${"x".repeat(1000)}/${i}.mp3`, duration: 60, requestedBy: who });
  const short = { title: "짧은 곡", pageUrl: "https://www.youtube.com/watch?v=bbbbbbbbbbb", duration: 60, requestedBy: who };
  const queue = [long(1), short, ...Array.from({ length: 8 }, (_, i) => long(i + 2))];
  const it = interaction({ player: queuePlayer(long(0), queue) });
  await run(await command("queue"), it.it, it.bot);
  const text = descriptionOf(it.log[0][1]);
  assert.ok(text.length <= 4096, `${text.length}자`);
  assert.equal(text.split("\n").filter((line) => /^`\d+\.`/.test(line)).length, 10, "줄은 빠지지 않는다");
  assert.match(text, /\[짧은 곡\]\(https:\/\/www\.youtube\.com/, "짧은 주소는 링크가 남는다");
  assert.match(text, /\*\*가{57}\.\.\.\*\*/, "제목은 60자에서 잘라 ...을 붙이고, 링크를 뗀 곡은 제목만");
});

// ── /help, /system ───────────────────────────────────────────────────

test("/help: 분류마다의 설명과 분류 메뉴를 본인에게만. 대시보드 주소가 이 기기 주소면 버튼이 없고, 밖에서 열리는 주소면 웹 대시보드 링크", async () => {
  const local = interaction({ player: { any: 1 } });
  await withConfig({ dashboard: { url: "http://localhost:33333" } }, async () => run(await command("help"), local.it, local.bot));
  const text = textOf(local.log[0][1]);
  assert.ok(text.includes("`/play`로 곡을 틀어요"), text);
  assert.ok(text.includes("**📋 대기열**: 대기열을 보고"), "분류마다 설명 한 줄");
  assert.ok(!text.includes("`/pause`"), "명령 줄은 분류 화면에만");
  const json = JSON.stringify(local.log[0][1]);
  assert.equal(json.includes('"style":5'), false, "링크 버튼 없음");
  assert.deepEqual(
    [...json.matchAll(/"value":"(\w+)"/g)].map((m) => m[1]),
    ["play", "queue", "mode", "explore", "channel", "info"],
    "분류 메뉴",
  );
  assert.deepEqual(lifetimesOf(local.it), [LIFETIME.screen]);

  const open = interaction();
  await withConfig({ dashboard: { url: "https://music.example.com" } }, async () => run(await command("help"), open.it, open.bot));
  assert.ok(JSON.stringify(open.log[0][1]).includes('"url":"https://music.example.com"'), "웹 대시보드 링크 버튼");
});

/** 권한을 보는 데 쓰는 멤버. manage 면 서버 관리자 */
const helpMember = (manage: boolean) => ({ id: "u1", permissions: { has: () => manage }, roles: { cache: new Map() }, guild: { id: "g1", roles: { cache: new Map() }, channels: { cache: new Map() } } });

test("/help 분류: 그 분류를 바로 보이고, 보는 사람이 못 쓰는 명령에 자물쇠와 그 뜻", async () => {
  const saved = config.dashboard.ownerId;
  config.dashboard.ownerId = "owner";
  try {
    const user = interaction({ options: { category: "channel" } });
    Object.assign(user.it, { member: helpMember(false) });
    await run(await command("help"), user.it, user.bot);
    const text = textOf(user.log[0][1]);
    assert.ok(text.includes("`/setchannel`: 제 전용 채널을 설정해요 (곡 요청 및 공지에 사용돼요) 🛡️ 🔒"), text);
    assert.ok(text.includes("`/leave`: 대기열을 저장하고 음성 채널에서 나가요 💿\n"), "DJ 역할이 없는 서버는 모두가 DJ 라 열림");
    assert.ok(text.includes("🔒 지금 내 권한으로는 쓸 수 없어요."), text);
    assert.deepEqual(lifetimesOf(user.it), [LIFETIME.screen]);

    const manager = interaction({ options: { category: "channel" } });
    Object.assign(manager.it, { member: helpMember(true) });
    await run(await command("help"), manager.it, manager.bot);
    assert.ok(!textOf(manager.log[0][1]).includes("🔒"), "서버 관리자는 이 분류를 다 쓴다");

    const info = interaction({ options: { category: "info" } });
    Object.assign(info.it, { member: helpMember(true) });
    await run(await command("help"), info.it, info.bot);
    assert.ok(textOf(info.log[0][1]).includes("`/system`: 봇의 시스템 정보를 보여줘요 🔑 🔒"), "봇 운영자가 아니면 서버 관리자도 잠김");
  } finally {
    config.dashboard.ownerId = saved;
  }
});

/** 분류 메뉴, 뒤로 버튼을 누른 것. update 로 고친 화면을 모은다. 첫 응답(상호작용 i0)의 메시지 m1 에 달려 있다 */
function pressed(bot: ReturnType<typeof interaction>["bot"], { values = [] as string[] } = {}) {
  const shown: unknown[] = [];
  const it = fakeWith<StringSelectMenuInteraction<"cached"> & ButtonInteraction<"cached">>()({
    guildId: "g1",
    values,
    member: helpMember(false),
    message: { id: "m1", interactionMetadata: { id: "i0" } },
    update: async (payload: unknown) => void shown.push(payload),
    deleteReply: async () => {},
  });
  return { it, shown, bot };
}

test("/help 분류 메뉴: 고른 분류의 명령 줄과 그 분류에 나온 표시의 뜻, 뒤로 버튼은 첫 화면", async () => {
  const { handleHelpSection, handleHelpHome } = await import("../../src/discord/interactions/help.ts");
  const { bot } = interaction();
  const play = pressed(bot, { values: ["play"] });
  await handleHelpSection(play.it, bot);
  const text = textOf(play.shown[0]);
  assert.ok(text.includes("재생\n`/play`: 곡을 재생해요\n`/playfirst`"), text);
  assert.ok(text.includes("💿 DJ만 쓸 수 있어요."), "DJ 표시의 뜻");
  assert.ok(!text.includes("🛡️") && !text.includes("🔒"), "그 분류에 없는 표시는 적지 않는다");
  assert.ok(JSON.stringify(play.shown[0]).includes('"custom_id":"help:home"'), "뒤로 버튼");

  const gone = pressed(bot, { values: ["없는분류"] });
  await handleHelpSection(gone.it, bot);
  assert.ok(textOf(gone.shown[0]).includes("`/play`로 곡을 틀어요"), "모르는 분류(메뉴를 그린 뒤 꺼진 분류)면 첫 화면");

  const back = pressed(bot);
  await handleHelpHome(back.it, bot);
  assert.ok(textOf(back.shown[0]).includes("`/play`로 곡을 틀어요"));
  stopExpiry("m1");
});

test("/help 분류 메뉴, 뒤로 버튼: 누를 때마다 첫 응답에 걸린 삭제를 멈추고 그 메시지의 삭제를 다시 센다", async () => {
  const { handleHelpHome } = await import("../../src/discord/interactions/help.ts");
  const { bot } = interaction();
  expireSelf(fakeWith<ButtonInteraction<"cached">>()({ id: "i0", deleteReply: async () => {} }), LIFETIME.screen);
  assert.equal(expiring("i0"), true);
  const back = pressed(bot);
  await handleHelpHome(back.it, bot);
  assert.equal(expiring("i0"), false, "첫 응답의 삭제는 멈춘다");
  assert.equal(expiring("m1"), true, "이 메시지의 삭제를 새로 센다");
  assert.deepEqual(lifetimesOf(back.it), [LIFETIME.screen]);
  stopExpiry("m1");
});

test("/help: 모든 분류를 합치면 켜진 명령이 다 있다(/help 자신은 빼고)", async () => {
  const { sectionView } = await import("../../src/discord/commands/help.ts");
  const { SECTIONS } = await import("../../src/ui/help-lines.ts");
  const { bot } = interaction();
  const text = SECTIONS.map((key) => textOf({ components: [sectionView(bot.commands, key)] })).join("\n");
  const names = [...bot.commands.keys()].filter((name) => name !== "help");
  assert.deepEqual(
    names.filter((name) => !text.includes(`\`/${name}\``)),
    [],
  );
});

test("/help: 만들다 던지면 진입점이 알린다", async () => {
  const { it, log, bot } = interaction();
  Object.defineProperty(it, "guildId", {
    get() {
      throw new Error("x");
    },
  });
  await runViaEntrance(await command("help"), it, bot);
  assert.deepEqual(log, [["reply", noticeReply(errors.notice("command-failed"))]]);
});

test("/invite: 초대 버튼, 웹사이트가 있으면 웹사이트 버튼. 끄면 등록하지 않는다", async () => {
  const { inviteView } = await import("../../src/discord/commands/invite.ts");
  const { enabledCommands } = await import("../../src/app/command-loader.ts");
  const urls = (view: { toJSON(): unknown }) => [...JSON.stringify(view.toJSON()).matchAll(/"url":"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(urls(inviteView({ invite: "https://discord.com/oauth2/authorize?client_id=1", website: null })), ["https://discord.com/oauth2/authorize?client_id=1"]);
  assert.deepEqual(urls(inviteView({ invite: "https://i", website: "https://site.example" })), ["https://i", "https://site.example"]);
  const names = (on: boolean) => withConfig({ bot: { inviteCommand: on } }, () => enabledCommands().map((c) => c.data.name));
  assert.ok(names(true).includes("invite"));
  assert.ok(!names(false).includes("invite"));
});

test("/system: 봇 운영자만. 운영자면 미뤄 두고 시스템 상태로 바꾼다", async () => {
  const saved = config.dashboard.ownerId;
  config.dashboard.ownerId = "owner";
  try {
    const other = interaction({ userId: "u1" });
    await run(await command("system"), other.it, other.bot);
    assert.deepEqual(other.log, [["reply", noticeReply(errors.notice("must-owner"))]]);

    const owner = interaction({ userId: "owner" });
    await run(await command("system"), owner.it, owner.bot);
    assert.deepEqual(owner.log[0], ["deferReply", { flags: MessageFlags.Ephemeral }]);
    const f = fieldsOf(owner.log[1][1]);
    assert.match(f["🎵 봇 현황"], /서버:\*\* 1개/);
    assert.match(f["🎵 봇 현황"], /사용자:\*\* 5명/, "서버 멤버 수의 합");
    assert.equal(owner.log[1][1].components[0].components[0].data.custom_id, "system:refresh");
  } finally {
    config.dashboard.ownerId = saved;
  }
});

// ── /cachestatus ──────────────────────────────────────────────────────

test("/cachestatus: 모든 서버의 캐시이므로 봇 운영자만 쓸 수 있고, 서버 관리 권한으로는 열리지 않는다", async () => {
  const saved = config.dashboard.ownerId;
  config.dashboard.ownerId = "owner";
  try {
    const { it, log, bot } = interaction({ userId: "u1" });
    await run(await command("cachestatus"), it, bot);
    assert.deepEqual(log, [["reply", noticeReply(errors.notice("must-owner"))]]);
  } finally {
    config.dashboard.ownerId = saved;
  }
  const json = (await command("cachestatus")).data.toJSON();
  assert.equal(json.default_member_permissions ?? null, null, "운영자에게 서버 관리 권한이 없는 서버에서도 목록에 뜬다");
});

test("/cachestatus: 캐시 통계를 담는다(재생 수, 플랫폼 분포, TOP, 최근)", async () => {
  const seed = (key: string, title: string, plays: number) => {
    const file = audioCache.getFilePath(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x".repeat(1000));
    audioCache.recordDownloadStart(key, { title });
    audioCache.recordDownloadComplete(key, file, 1000, { title }, { durationSec: 125 });
    for (let i = 0; i < plays; i++) audioCache.recordPlayback(key);
  };
  seed("yt:aaaaaaaaaaa", "많이 튼 곡", 3);
  seed("sc:1", "사운드클라우드", 0);
  seed("dl:abc", "직접", 1);
  trackLookup.recordTrackLookup({ requestKey: "https://youtu.be/aaaaaaaaaaa", pageUrl: "https://youtu.be/aaaaaaaaaaa", audioUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa", platform: "youtube", title: "많이 튼 곡", artist: "가수" });

  const saved = config.dashboard.ownerId;
  config.dashboard.ownerId = "owner";
  const { it, log, bot } = interaction({ userId: "owner" });
  try {
    await run(await command("cachestatus"), it, bot);
  } finally {
    config.dashboard.ownerId = saved;
  }

  assert.deepEqual(log[0], ["deferReply", { flags: MessageFlags.Ephemeral }]);
  const f = fieldsOf(log[1][1]);
  assert.match(f["📊 재생 통계"], /총 재생 횟수:\*\* 4회/);
  assert.match(f["📊 재생 통계"], /한 번도 안 튼 곡:\*\* 1개/);
  assert.match(f["📊 재생 통계"], /평균 곡 길이:\*\* 2분 5초/);
  assert.equal(f["🌐 플랫폼 분포"], "🔴 YouTube: **1**개\n🟠 SoundCloud: **1**개\n🔗 직접 링크: **1**개");
  assert.match(f["🔧 기타"], /링크 데이터:\*\* 1개/);
  assert.match(f["🏆 재생 TOP 5"], /^`1\.` \*\*많이 튼 곡\*\*: 3회 \(2:05\)/);
  assert.deepEqual(lifetimesOf(it), [LIFETIME.screen]);
});

// ── /ping ─────────────────────────────────────────────────────────────

test("/ping: 누구나 쓸 수 있으므로(응답 시간은 실행한 사람에게만 보인다) 기본 권한을 걸지 않는다", async () => {
  const json = (await command("ping")).data.toJSON();
  assert.equal(json.default_member_permissions ?? null, null);
});

// ── 설정 명령 ─────────────────────────────────────────────────────────

test("/setchannel: 지정하면 저장하고 안내한 뒤 패널을 옮긴다. 채널을 안 주면 지금 채널", async () => {
  const { it, log, seen, bot } = interaction({ channelId: "c5" });
  await run(await command("setchannel"), it, bot);
  settings.forgetCache();
  assert.equal(await settings.getBotChannel("g1"), "c5");
  assert.deepEqual([screenOf(log[0][1]).title, screenOf(log[0][1]).done], ["✅ 전용 채널 설정됨", true]);
  assert.deepEqual(log[0][1].flags, [MessageFlags.IsComponentsV2], "모두에게 보인다");
  assert.deepEqual(seen, ["movePanel"], "안내 뒤에 옮긴다");

  const other = interaction({ options: { channel: { id: "c6", toString: () => "<#c6>" } } });
  await run(await command("setchannel"), other.it, other.bot);
  settings.forgetCache();
  assert.equal(await settings.getBotChannel("g1"), "c6");
});

test("/setchannel remove: 해제하고 안내한 뒤 패널을 옮긴다. 저장 실패는 본인에게만 알린다", async () => {
  await settings.setBotChannel("g1", "c5");
  const { it, log, seen, bot } = interaction({ options: { action: "remove" } });
  await run(await command("setchannel"), it, bot);
  settings.forgetCache();
  assert.equal(await settings.getBotChannel("g1"), null);
  assert.deepEqual(seen, ["movePanel"]);
  assert.deepEqual([screenOf(log[0][1]).title, screenOf(log[0][1]).done], ["🔧 전용 채널 해제됨", true], "해제도 설정을 바꾼 것이라 완료 색");

  // 저장이 실패하게 서버 설정 표를 잠깐 치운다
  await whenSettingsBroken(async () => {
    const failed = interaction();
    await run(await command("setchannel"), failed.it, failed.bot);
    assert.deepEqual(failed.log[0][1], noticeReply(errors.notice("channel-set-failed")));
    // 해제도 실패를 알리고 패널은 옮기지 않는다
    const failedRemove = interaction({ options: { action: "remove" } });
    await run(await command("setchannel"), failedRemove.it, failedRemove.bot);
    assert.deepEqual(failedRemove.log[0][1], noticeReply(errors.notice("channel-set-failed")));
    assert.deepEqual(failedRemove.seen, []);
  });
});

test("/setchannel: 지정, 해제 모두 안내를 먼저 보낸 뒤 패널을 옮기고(옮기기를 기다리지 않고 답한다), 안내가 실패해도 패널은 옮긴다", async () => {
  for (const action of ["set", "remove"]) {
    const ok = interaction({ channelId: "c5", options: { action } });
    let repliedFirst = false;
    ok.bot.panels.onBotChannelChanged = async () => void (repliedFirst = ok.log.length === 1);
    await run(await command("setchannel"), ok.it, ok.bot);
    assert.equal(repliedFirst, true, `${action}: 안내 뒤에 옮긴다`);

    const broken = interaction({ channelId: "c5", options: { action } });
    let moved = false;
    broken.bot.panels.onBotChannelChanged = async () => void (moved = true);
    broken.it.reply = async () => {
      throw new Error("응답 실패");
    };
    const setchannel = await command("setchannel");
    await assert.rejects(async () => run(setchannel, broken.it, broken.bot), /응답 실패/);
    assert.equal(moved, true, `${action}: 안내가 실패해도 설정과 패널이 어긋나지 않게 옮긴다`);
  }
  await settings.clearBotChannel("g1");
});

test("/setting: 본인에게만 서버 설정 한 화면을 띄운다. 서버에 남아 있는 역할만 지금 DJ 로 보이고 메뉴의 기본값으로 둔다", async () => {
  await settings.setDjRoles("g1", ["r1", "gone"]);
  const { it, log, bot } = interaction({ guildRoles: ["r1", "r2"] });
  await run(await command("setting"), it, bot);
  assert.match(textOf(log[0][1]), /현재 DJ 역할: <@&r1>\n/);
  assert.deepEqual(screenOf(log[0][1]).roles, ["r1"]);
  assert.deepEqual(log[0][1].flags, [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]);
});
