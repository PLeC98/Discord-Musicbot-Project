// 표시 · 설정 명령과 SponsorBlock 설정 화면의 지금 동작을 고정한다(구조 리팩터링 0-B).
// /nowplaying · /queue · /help · /system · /cachestatus · /setchannel · /setdjrole · /sponsorblock, 그리고 sponsorConfigHandler.
//
// 6단계가 표시 명령을 ui/ 의 같은 조각으로, 설정 명령을 store/guildSettings 로 돌린다. 문구 전부가 아니라 "무엇을 골라 담았나 ·
// 무엇을 저장했나"를 본다. 서버 설정과 캐시 통계는 진짜 저장소(임시 DB)로 돈다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags, PermissionFlagsBits, type Client, type Interaction } from "discord.js";

import * as storeDb from "../../src/store/db.ts";
import { command, run, runViaEntrance } from "../helpers/commands.ts";
import { whenSettingsBroken } from "../helpers/tempStore.ts";
import { fake, fakePlayer, fakeWith } from "../helpers/fake.ts";
import type { Player } from "../../src/player/Player.ts";
import { interactionKind } from "../helpers/interactionKind.ts";
import { noticeReply } from "../../src/ui/frame.ts";
import * as infoText from "../../src/ui/text/ko/info.ts";
import { headOf, screenOf, textOf, thumbnailOf } from "../helpers/cv2.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "commands-info-"));
const audioCache = await import("../../src/store/audioCache.ts");
const trackLookup = await import("../../src/store/trackLookup.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
audioCache.initialize(path.join(TMP, "cache.db"));

const config = (await import("../../config.ts")).default;
const errors = await import("../../src/ui/text/ko/errors.ts");
const settings = await import("../../src/store/guildSettings.ts");
const { SKIP_CATEGORIES } = await import("../../src/rules/sponsorCategories.ts");
const interactionCreate = (await import("../../events/interactionCreate.ts")).default;

after(() => {
  audioCache.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

beforeEach(() => {
  settings._reset();
  storeDb.get().exec("DELETE FROM guild_settings; DELETE FROM track_lookup; DELETE FROM audio_cache;");
});

// 보낸 응답. 여기서 보는 칸만
type Sent = {
  content?: string;
  flags?: unknown;
  embeds: Array<{ data: { title?: string; description?: string; fields?: Array<{ name: string; value: string }>; footer?: { text: string }; thumbnail?: { url: string } } }>;
  components: Array<{ components: Array<{ data: { custom_id?: string; default_values?: Array<{ id: string }> } }> }>;
};
type Logged = [name: string, payload: Sent];

const fieldsOf = (payload: Sent) => Object.fromEntries((payload.embeds[0].data.fields || []).map((f) => [f.name, f.value]));
// /nowplaying 의 작은 글씨 줄. 칸 이름 → 값
const NOW = infoText.nowPlaying();
function nowLines(payload: unknown) {
  const lines = textOf(payload)
    .split("\n")
    .filter((l) => l.startsWith("-# "))
    .map((l) => l.slice(3));
  return Object.fromEntries([NOW.artist, NOW.album, NOW.platform, NOW.progress, NOW.requester, NOW.status].flatMap((name) => lines.filter((l) => l.startsWith(`${name} `)).map((l) => [name, l.slice(name.length + 1)])));
}

type InteractionOptions = { player?: object | null; options?: Record<string, unknown>; userId?: string; guildRoles?: string[]; manage?: boolean; channelId?: string };

function interaction({ player = null, options = {}, userId = "u1", guildRoles = [], manage = true, channelId = "c1" }: InteractionOptions = {}) {
  const log: Logged[] = [];
  const seen: string[] = [];
  // 서버 목록. 명령이 수를 세고 모은다
  const guilds = new Map([["g1", { memberCount: 5 }]]);
  const client = fakeWith<Client<true>>()({
    players: new Map<string, Player>(player ? [["g1", fakePlayer(player)]] : []),
    guilds: { cache: Object.assign(guilds, { reduce: (fn: (acc: number, g: { memberCount: number }) => number, init: number) => [...guilds.values()].reduce(fn, init) }) },
    user: { username: "뮤직봇", displayAvatarURL: () => "https://avatar.test/a.png" },
    panels: { onBotChannelChanged: async () => seen.push("movePanel") },
  });
  const it = {
    guild: { id: "g1", roles: { cache: new Map(guildRoles.map((r) => [r, { id: r }])) } },
    user: { id: userId },
    member: { id: userId },
    client,
    channel: { id: channelId, toString: () => `<#${channelId}>` },
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
  return { it, log, seen, client };
}

// ── /nowplaying ───────────────────────────────────────────────────────

type Status = { playing: boolean; paused: boolean; volume: number; loop: string | false };

function nowPlayer(track: object | null, status: Status = { playing: true, paused: false, volume: 70, loop: "track" }) {
  const audio = status.playing ? "playing" : status.paused ? "paused" : "idle";
  return { currentTrack: track, getCurrentTime: () => 90_000, audioPlayer: { state: { status: audio } }, volume: status.volume, loop: status.loop };
}

test("/nowplaying: 플레이어나 곡이 없으면 본인에게만 알린다", async () => {
  const none = interaction();
  await run(await command("nowplaying"), none.it, none.client);
  assert.deepEqual(none.log[0][1], noticeReply(errors.notice("no-song")));

  const idle = interaction({ player: nowPlayer(null) });
  await run(await command("nowplaying"), idle.it, idle.client);
  assert.deepEqual(idle.log[0][1], noticeReply(errors.notice("no-song")));
});

test("/nowplaying: 가수 · 앨범 · 플랫폼 · 진행 · 요청자 · 상태를 담는다", async () => {
  const track = { title: "곡", url: "https://youtu.be/x", artist: "가수", album: "앨범", platform: "youtube", duration: 200, requestedBy: { id: "u9" }, thumbnail: "https://thumb" };
  const { it, log, client } = interaction({ player: nowPlayer(track) });

  await run(await command("nowplaying"), it, client);

  const f = nowLines(log[0][1]);
  assert.equal(f["🎤 아티스트"], "가수");
  assert.equal(f["💿 앨범"], "앨범");
  assert.match(f["🌐 출처"], /YouTube/);
  assert.match(f["⏱️ 진행"], /^`1:30` ▬+●▬+ `3:20`$/, "재생 패널과 같은 막대");
  assert.equal(f["👤 요청자"], "<@u9>");
  assert.equal(f["📊 상태"], "▶️ 재생 중 • 🔊 70% • 🔂 한 곡 반복");
  assert.equal(thumbnailOf(log[0][1] as never), "https://thumb");
  assert.deepEqual(log[0][1].flags, [MessageFlags.IsComponentsV2], "모두에게 보인다");
  assert.equal(headOf(log[0][1] as never), "### 🎵 현재 재생 중");
});

test("/nowplaying: 멈춤 · 준비 중 · 대기열 반복, 길이를 모르면 진행을 뺀다, 던지면 입구가 알린다", async () => {
  const paused = interaction({ player: nowPlayer({ title: "곡", url: "u", platform: "direct", duration: 0 }, { playing: false, paused: true, volume: 10, loop: "queue" }) });
  await run(await command("nowplaying"), paused.it, paused.client);
  const f = nowLines(paused.log[0][1]);
  assert.equal(f["📊 상태"], "⏸️ 일시정지 • 🔊 10% • 🔁 대기열 반복");
  assert.equal(f["⏱️ 진행"], undefined);

  const stopped = interaction({ player: nowPlayer({ title: "곡", url: "u" }, { playing: false, paused: false, volume: 1, loop: false }) });
  await run(await command("nowplaying"), stopped.it, stopped.client);
  assert.equal(nowLines(stopped.log[0][1])["📊 상태"], "⏳ 준비 중 • 🔊 1%");

  const broken = interaction({
    player: {
      currentTrack: { title: "곡", duration: 100 },
      getCurrentTime: () => {
        throw new Error("x");
      },
    },
  });
  await runViaEntrance(await command("nowplaying"), broken.it, broken.client);
  assert.deepEqual(broken.log, [["reply", noticeReply(errors.notice("command-failed"))]]);
});

// ── /queue ────────────────────────────────────────────────────────────

const queuePlayer = (current: object | null, queue: object[]) => ({ currentTrack: current, queue });

test("/queue: 플레이어가 없거나 비었으면 알린다", async () => {
  const none = interaction();
  await run(await command("queue"), none.it, none.client);
  assert.deepEqual(none.log[0][1], noticeReply(errors.notice("no-song")));
  const empty = interaction({ player: queuePlayer(null, []) });
  await run(await command("queue"), empty.it, empty.client);
  assert.deepEqual(empty.log[0][1], noticeReply(errors.notice("queue-empty")));
  // 대기열 화면은 다음 곡만 보인다. 지금 곡만 있으면 비었다고 한다
  const onlyNow = interaction({ player: queuePlayer({ title: "지금", pageUrl: "now" }, []) });
  await run(await command("queue"), onlyNow.it, onlyNow.client);
  assert.deepEqual(onlyNow.log[0][1], noticeReply(errors.notice("queue-empty")));
});

// 대기열은 본문(description)에 싣는다. 칸(field)에 나눠 실으면 칸마다 이름 줄이 생겨 빈 여백이 끼었다
const descriptionOf = (payload: Sent) => String(payload.embeds[0].data.description ?? "");

test("/queue: 다음 곡만 쪽마다 나눠 보인다. 없는 쪽은 마지막 쪽으로", async () => {
  const queue = Array.from({ length: 25 }, (_, i) => ({ title: `곡${i + 1}`, pageUrl: `u${i}`, duration: 60 }));
  const first = interaction({ player: queuePlayer({ title: "지금", pageUrl: "now" }, queue) });
  await run(await command("queue"), first.it, first.client);
  const p1 = first.log[0][1];
  assert.match(descriptionOf(p1), /^`1\.` \*\*\[곡1\]\(u0\)\*\*/);
  assert.doesNotMatch(descriptionOf(p1), /지금/, "지금 곡은 재생 패널이 보인다");
  assert.equal(p1.embeds[0].data.fields, undefined, "칸을 쓰지 않는다");
  assert.equal(p1.embeds[0].data.footer?.text, "모두 25곡 • 1/3쪽");

  const last = interaction({ player: queuePlayer({ title: "지금", pageUrl: "now" }, queue), options: { page: 9 } });
  await run(await command("queue"), last.it, last.client);
  const p3 = last.log[0][1];
  assert.match(descriptionOf(p3), /`21\.` \*\*\[곡21\]/, "번호는 쪽을 이어 센다");
  assert.equal(p3.embeds[0].data.footer?.text, "모두 25곡 • 3/3쪽");
});

// 링크가 붙은 긴 유튜브 제목 열 줄이면 칸 하나(1024자)를 넘어 명령이 통째로 실패했다(실사용).
// 본문은 4096자지만 서명된 직접 링크 · 한글이 인코딩된 주소는 수백 자라, 넘치면 주소가 긴 곡부터 링크를 뗀다
test("/queue: 긴 주소가 섞여도 본문 상한 안에 열 줄이 다 들어가고, 링크는 주소가 긴 곡부터 뗀다", async () => {
  const who = { id: "151864213755789312" };
  const long = (i: number) => ({ title: "가".repeat(150), pageUrl: `https://cdn.example.com/${"x".repeat(1000)}/${i}.mp3`, duration: 60, requestedBy: who });
  const short = { title: "짧은 곡", pageUrl: "https://www.youtube.com/watch?v=bbbbbbbbbbb", duration: 60, requestedBy: who };
  const queue = [long(1), short, ...Array.from({ length: 8 }, (_, i) => long(i + 2))];
  const it = interaction({ player: queuePlayer(long(0), queue) });
  await run(await command("queue"), it.it, it.client);
  const text = descriptionOf(it.log[0][1]);
  assert.ok(text.length <= 4096, `${text.length}자`);
  assert.equal(text.split("\n").filter((line) => /^`\d+\.`/.test(line)).length, 10, "줄은 빠지지 않는다");
  assert.match(text, /\[짧은 곡\]\(https:\/\/www\.youtube\.com/, "짧은 주소는 링크가 남는다");
  assert.match(text, /\*\*가{57}\.\.\.\*\*/, "제목은 60자에서 잘라 ...을 붙이고, 링크를 뗀 곡은 제목만");
});

// ── /help · /system ───────────────────────────────────────────────────

test("/help: 명령 묶음과 통계를 담고 새로고침 버튼을 단다", async () => {
  const { it, log, client } = interaction({ player: { any: 1 } });
  await run(await command("help"), it, client);
  const f = fieldsOf(log[0][1]);
  assert.ok(f["🎵 재생"].includes("`/play <곡/URL>`"));
  assert.match(f["📊 통계"], /서버:\*\* 1개/);
  assert.match(f["📊 통계"], /재생 중인 서버:\*\* 1개/);
  // 웹사이트 버튼은 WEBSITE 가 있을 때만 앞에 붙는다. 순서가 아니라 ID 로 찾는다
  const buttons: Array<{ data: { custom_id?: string } }> = log[0][1].components[0].components;
  assert.ok(buttons.some((b) => b.data.custom_id === "help:refresh"));
});

test("/help: 모든 명령을 적는다", async () => {
  const { it, log, client } = interaction();
  await run(await command("help"), it, client);
  const text = Object.values(fieldsOf(log[0][1])).join("\n");
  const { COMMANDS } = await import("../../commands/index.ts");
  const names = COMMANDS.map((c) => c.data.name).filter((name) => name !== "help");
  assert.deepEqual(
    names.filter((name) => !text.includes(`\`/${name}`)),
    [],
  );
});

test("/help: 만들다 던지면 입구가 알린다", async () => {
  const { it, log, client } = interaction();
  client.user.displayAvatarURL = () => {
    throw new Error("x");
  };
  await runViaEntrance(await command("help"), it, client);
  assert.deepEqual(log, [["reply", noticeReply(errors.notice("command-failed"))]]);
});

test("/system: 봇 운영자만. 운영자면 미뤄 두고 시스템 상태로 바꾼다", async () => {
  const saved = config.dashboard.ownerId;
  config.dashboard.ownerId = "owner";
  try {
    const other = interaction({ userId: "u1" });
    await run(await command("system"), other.it, other.client);
    assert.deepEqual(other.log, [["reply", noticeReply(errors.notice("must-owner"))]]);

    const owner = interaction({ userId: "owner" });
    await run(await command("system"), owner.it, owner.client);
    assert.deepEqual(owner.log[0], ["deferReply", { flags: MessageFlags.Ephemeral }]);
    const f = fieldsOf(owner.log[1][1]);
    assert.match(f["🎵 봇 현황"], /서버:\*\* 1개/);
    assert.equal(owner.log[1][1].components[0].components[0].data.custom_id, "system:refresh");
  } finally {
    config.dashboard.ownerId = saved;
  }
});

// ── /cachestatus ──────────────────────────────────────────────────────

test("/cachestatus: 캐시 통계를 담는다(재생 수 · 플랫폼 분포 · TOP · 최근)", async () => {
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

  const { it, log, client } = interaction();
  await run(await command("cachestatus"), it, client);

  assert.deepEqual(log[0], ["deferReply", { flags: MessageFlags.Ephemeral }]);
  const f = fieldsOf(log[1][1]);
  assert.match(f["▶️ 재생 통계"], /총 재생 횟수:\*\* 4회/);
  assert.match(f["▶️ 재생 통계"], /한 번도 안 튼 곡:\*\* 1개/);
  assert.match(f["▶️ 재생 통계"], /평균 곡 길이:\*\* 2분 5초/);
  assert.equal(f["🌐 플랫폼 분포"], "🔴 YouTube: **1**개\n🟠 SoundCloud: **1**개\n🔗 직접 링크: **1**개");
  assert.match(f["🔧 기타"], /주소 기록:\*\* 1개/);
  assert.match(f["🏆 재생 TOP 5"], /^`1\.` \*\*많이 튼 곡\*\*: 3회 \(2:05\)/);
});

// ── 설정 명령 ─────────────────────────────────────────────────────────

test("/setchannel: 지정하면 저장하고 안내한 뒤 패널을 옮긴다. 채널을 안 주면 지금 채널", async () => {
  const { it, log, seen, client } = interaction({ channelId: "c5" });
  await run(await command("setchannel"), it, client);
  settings._reset();
  assert.equal(await settings.getBotChannel("g1"), "c5");
  assert.deepEqual([screenOf(log[0][1]).title, screenOf(log[0][1]).done], ["✅ 전용 채널 설정됨", true]);
  assert.deepEqual(log[0][1].flags, [MessageFlags.IsComponentsV2], "모두에게 보인다");
  assert.deepEqual(seen, ["movePanel"], "안내 뒤에 옮긴다");

  const other = interaction({ options: { channel: { id: "c6", toString: () => "<#c6>" } } });
  await run(await command("setchannel"), other.it, other.client);
  settings._reset();
  assert.equal(await settings.getBotChannel("g1"), "c6");
});

test("/setchannel remove: 지우고 패널을 옮긴 뒤 안내. 저장 실패는 본인에게만", async () => {
  await settings.setBotChannel("g1", "c5");
  const { it, log, seen, client } = interaction({ options: { action: "remove" } });
  await run(await command("setchannel"), it, client);
  settings._reset();
  assert.equal(await settings.getBotChannel("g1"), null);
  assert.deepEqual(seen, ["movePanel"]);
  assert.deepEqual([screenOf(log[0][1]).title, screenOf(log[0][1]).done], ["🔧 전용 채널 해제됨", true], "해제도 설정을 바꾼 것이라 완료 색");

  // 저장이 실패하게 서버 설정 표를 잠깐 치운다
  await whenSettingsBroken(async () => {
    const failed = interaction();
    await run(await command("setchannel"), failed.it, failed.client);
    assert.deepEqual(failed.log[0][1], noticeReply(errors.notice("channel-set-failed")));
  });
});

test("/setdjrole: 서버에 남아 있는 역할만 지금 DJ 로 보이고 메뉴의 기본값으로 둔다", async () => {
  await settings.setDjRoles("g1", ["r1", "gone"]);
  const { it, log, client } = interaction({ guildRoles: ["r1", "r2"] });
  await run(await command("setdjrole"), it, client);
  const screen = screenOf(log[0][1]);
  assert.match(screen.body, /^현재 DJ 역할: <@&r1>\n/);
  assert.deepEqual(screen.roles, ["r1"]);
  assert.deepEqual(screen.buttons, ["djrole:save", "djrole:cancel"]);
  assert.deepEqual(log[0][1].flags, [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]);

  settings._reset();
  storeDb.get().exec("DELETE FROM guild_settings;");
  const none = interaction();
  await run(await command("setdjrole"), none.it, none.client);
  assert.match(screenOf(none.log[0][1]).body, /DJ 역할이 없어 \*\*모두\*\*/);
});

// ── /sponsorblock 과 설정 화면 ────────────────────────────────────────

function sbInteraction({ customId, values = [], messageId = "reply-msg", manage = true }: { customId: string; values?: string[]; messageId?: string; manage?: boolean }) {
  // 받은 것. 이름 다음에 보는 칸
  const log: Array<[string, ...Array<string | number | null | Sent>]> = [];
  const it = {
    customId,
    values,
    guild: { id: "g1" },
    message: { id: messageId },
    memberPermissions: { has: (p: bigint) => manage && p === PermissionFlagsBits.ManageGuild },
    ...interactionKind(customId === "sb:cats" ? "select" : "button"),
    reply: async (p: Sent) => log.push(["reply", p]),
    deferUpdate: async () => log.push(["deferUpdate"]),
    update: async (p: Sent) => {
      const s = screenOf(p);
      log.push(["update", s.title, s.body, s.rows, s.done ? "완료" : "기본"]);
    },
  };
  return { it, log };
}

test("/sponsorblock: 지금 설정으로 화면을 띄우고 보류 상태를 메시지 id 로 남긴다", async () => {
  const { it, log, client } = interaction();
  await run(await command("sponsorblock"), it, client);
  assert.deepEqual(log[0][1].flags, [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]);
  assert.deepEqual(screenOf(log[0][1]).buttons, ["sb:toggle", "sb:save", "sb:cancel"]);

  // 보류 상태를 이어받는지: 토글하면 켬 → 끔
  const toggle = sbInteraction({ customId: "sb:toggle" });
  await interactionCreate.execute(fake<Interaction>(toggle.it));
  assert.match(String(toggle.log[0][2]), /현재 설정: \*\*끔\*\*/);
});

test("SponsorBlock 화면: 서버 관리 권한이 필요하다", async () => {
  const denied = sbInteraction({ customId: "sb:save", manage: false });
  await interactionCreate.execute(fake<Interaction>(denied.it));
  assert.deepEqual(denied.log, [["reply", noticeReply(errors.notice("must-moderator"))]]);
});

test("SponsorBlock 화면: 고르고 저장하면 모르는 구간은 빼고 저장한다. 보류가 없으면 지금 설정에서 시작한다", async () => {
  const pick = sbInteraction({ customId: "sb:cats", values: ["intro", "nope", "intro", "outro"], messageId: "m-save" });
  await interactionCreate.execute(fake<Interaction>(pick.it));
  assert.deepEqual(pick.log, [["deferUpdate"]]);

  const save = sbInteraction({ customId: "sb:save", messageId: "m-save" });
  await interactionCreate.execute(fake<Interaction>(save.it));
  settings._reset();
  assert.deepEqual(await settings.getSponsorBlock("g1"), { enabled: true, categories: ["intro", "outro"] });
  assert.deepEqual([save.log[0][1], save.log[0][4]], ["⏭️ SponsorBlock 설정을 저장했어요", "완료"]);
  assert.match(String(save.log[0][2]), /인트로\/무음 구간, 최종 화면 구간/);
  assert.ok(SKIP_CATEGORIES.includes("intro"));
});

test("SponsorBlock 화면: 끄고 저장하면 끔, 구간을 비우고 저장하면 건너뛰지 않는다고, 취소하면 그대로 닫는다", async () => {
  const toggle = sbInteraction({ customId: "sb:toggle", messageId: "m-off" });
  await interactionCreate.execute(fake<Interaction>(toggle.it));
  const save = sbInteraction({ customId: "sb:save", messageId: "m-off" });
  await interactionCreate.execute(fake<Interaction>(save.it));
  assert.match(String(save.log[0][2]), /구간: 끔/);

  settings._reset();
  storeDb.get().exec("DELETE FROM guild_settings;"); // 앞에서 끈 채로 저장한 값을 지워, 새 보류가 "켬"에서 시작하게
  const empty = sbInteraction({ customId: "sb:cats", values: [], messageId: "m-empty" });
  await interactionCreate.execute(fake<Interaction>(empty.it));
  const saveEmpty = sbInteraction({ customId: "sb:save", messageId: "m-empty" });
  await interactionCreate.execute(fake<Interaction>(saveEmpty.it));
  assert.match(String(saveEmpty.log[0][2]), /고른 구간 없음 \(건너뛰지 않아요\)/);

  const cancel = sbInteraction({ customId: "sb:cancel", messageId: "m-cancel" });
  await interactionCreate.execute(fake<Interaction>(cancel.it));
  assert.deepEqual(cancel.log, [["update", "⏭️ SponsorBlock 설정을 취소했어요", "변경 사항은 반영하지 않았어요.", 0, "기본"]]);
});

test("SponsorBlock 화면: 봇 전체에서 꺼져 있으면 열려 있던 메뉴의 버튼 · 메뉴는 없는 것과 같다(저장하지 않는다)", async () => {
  settings._reset();
  storeDb.get().exec("DELETE FROM guild_settings;");
  const saved = config.sponsorblock.enabled;
  config.sponsorblock.enabled = false;
  try {
    for (const customId of ["sb:toggle", "sb:save", "sb:cats"]) {
      const it = sbInteraction({ customId, values: ["intro"], messageId: "m-off-global" });
      await interactionCreate.execute(fake<Interaction>(it.it));
      assert.deepEqual(it.log, [["reply", noticeReply(errors.notice("unknown-interaction"))]], customId);
    }
    settings._reset();
    assert.deepEqual(await settings.getSponsorBlock("g1"), { enabled: null, categories: null });
  } finally {
    config.sponsorblock.enabled = saved;
  }
});
