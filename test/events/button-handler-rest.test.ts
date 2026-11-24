// src/discord/interactions/button-handler.ts: 버튼 핸들러의 나머지 분기를 고정한다. 조작 전제 조건은 control-entrances.test.ts의 표가 본다.
// 여기서는 도움말, 시스템 새로고침, 자동재생 버튼, 대기열 버튼, 옛 세션, 모르는 버튼, 조작이 실패했을 때를 본다.
//
// 권한 판정, 서버 설정, 곡 추가 코어는 진짜(서버 설정은 임시 DB),
// 화면 관리자만 가짜다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags, type ButtonInteraction } from "discord.js";
import { settingsDb } from "../../src/store/settings-db.ts";
import * as stores from "../../src/store/stores.ts";
import { Player } from "../../src/player/player.ts";
import { fake, fakeWith, fakeBot } from "../helpers/fake.ts";
import { useDefaultDocuments } from "../helpers/config-docs.ts";
import { interactionKind } from "../helpers/interaction-kind.ts";
import { withConfig } from "../helpers/config.ts";
import { fakeAdder } from "../helpers/adder.ts";
import { headOf, textsOf, thumbnailOf } from "../helpers/cv2.ts";
import { noticeReply } from "../../src/ui/frame.ts";
import type { Notice } from "../../src/ui/text/notice.ts";
import { COMMANDS } from "../../src/discord/commands/index.ts";
import { textFor } from "../../src/ui/text/index.ts";

useDefaultDocuments();

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "button-rest-"));
const audioCache = await import("../../src/store/audio-cache.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
stores.open(TMP);
audioCache.initialize();

const config = (await import("../../src/config/index.ts")).default;
const errors = textFor("ko").errors;
// 안내 응답의 헤더 줄
const said = (notice: Notice) => headOf(noticeReply(notice));
const settings = await import("../../src/store/guild-settings.ts");
const playerEvents = await import("../../src/player/events.ts");
const interactionCreate = (await import("../../src/discord/events/interaction-create.ts")).default;
const { LIFETIME, lifetimesOf } = await import("../../src/ui/delivery.ts");
after(() => {
  audioCache.close();
  stores.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

beforeEach(() => {
  settings.forgetCache();
  settingsDb.get().exec("DELETE FROM guild_settings;");
});

const USER = "111111111111111111";

type Seen = string | { handle: Array<string | null> };
type FakeTrack = { title: string; url?: string; pageUrl?: string; thumbnail?: string; duration?: number };
type World = ReturnType<typeof world>;

function world({ botVoice = "v1", userVoice = "v1", player = true, handle = async (): Promise<object> => ({ success: true }) }: { botVoice?: string | null; userVoice?: string | null; player?: boolean; handle?: (trackData: object) => Promise<object> } = {}) {
  const voice = (id: string | null) => (id ? { id, name: id, permissionsFor: () => ({ has: () => true }) } : null);
  const seen: Seen[] = [];
  const client = {
    guilds: { cache: Object.assign(new Map(), { reduce: (_fn: unknown, init: number) => init }) },
    user: { id: "bot", username: "뮤직봇", displayAvatarURL: () => "https://avatar.test/a.png" },
    // /system 새로고침이 대시보드와 같은 상태 값을 모을 때 읽는다
    ws: { ping: 42, status: 0 },
    isReady: () => true,
  };
  const bot = fakeBot({
    client,
    players: new Map<string, Player>(),
    panels: {
      updatePlaying: async () => seen.push("update"),
    },
    // 실행 목록. 도움말 새로고침이 이것으로 명령 줄을 만든다
    commands: new Map(COMMANDS.map((command) => [command.name, command])),
  });
  // 곡 추가는 받은 곡의 제목만 적는다
  fakeAdder(bot, async (_bot, _guildId, trackData) => {
    seen.push({ handle: trackData.tracks.map((t) => t.title) });
    return handle(trackData);
  });
  const guild = { id: "g1", client, members: { me: { id: "bot", voice: { channel: voice(botVoice) } } }, channels: { cache: new Map() }, roles: { cache: new Map() } };
  const member = { id: USER, user: { id: USER }, displayName: "사용자", guild, voice: { channel: voice(userVoice) }, permissions: { has: () => false }, roles: { cache: { has: () => false } }, toString: () => `<@${USER}>` };
  const p = {
    sessionId: "S1",
    queue: [] as FakeTrack[],
    previousTracks: [] as FakeTrack[],
    currentTrack: null as FakeTrack | null,
    autoplay: false as string | false,
    paused: false,
    isLive: false,
    getCurrentTime: () => 0,
    loop: false as string | false,
    releaseLoopForLive() {},
    setAutoplay(v: string | false) {
      seen.push(`autoplay:${v}`);
      p.autoplay = v;
    },
    pause: {
      userPaused: false,
      heldBy: null,
      setUser(on: boolean) {
        this.userPaused = on;
        p.paused = on;
      },
    },
    skip: () => false,
    previous: () => false,
    _restartsOnPrevious: Player.prototype._restartsOnPrevious,
    bindChannels: Player.prototype.bindChannels,
    movePanel: Player.prototype.movePanel,
    restoreSettings: Player.prototype.restoreSettings,
    hasLiveTrack: () => false,
    setLoop(m: string) {
      p.loop = m;
    },
  };
  const registered = fake<Player>(p);
  if (player) bot.players.set("g1", registered);
  // 조작 뒤 패널 갱신은 플레이어 알림으로 온다
  playerEvents.on("refresh", async (x) => x === registered && seen.push("update"));
  return { guild, member, client, bot, seen, player: p };
}

type Payload = { content?: string; embeds?: { data: { title?: string; description?: string } }[]; components?: Array<{ toJSON(): unknown }>; files?: Array<{ name: string }>; attachments?: unknown[] };
type Entry = [string] | [string, unknown];

function press(w: World, customId: string, extra: object = {}) {
  const log: Entry[] = [];
  const it = fakeWith<ButtonInteraction>()({
    customId,
    guild: w.guild,
    member: w.member,
    user: w.member.user,
    client: w.client,
    channel: { id: "c1", send: async (p: Payload) => (log.push(["send", headOf(p)]), { id: "x", delete: async () => {} }) },
    message: { id: "search-msg" },
    replied: false,
    deferred: false,
    ...interactionKind("button"),
    reply: async (p: Payload) => {
      it.replied = true;
      log.push(["reply", p.content ?? p.embeds?.[0]?.data?.title ?? headOf(p) ?? "(메뉴)"]);
      return { resource: { message: { id: "r1" } } };
    },
    update: async (p: Payload) => log.push(["update", p.embeds?.[0]?.data.title]),
    deferUpdate: async () => {
      it.deferred = true;
      log.push(["deferUpdate"]);
    },
    editReply: async (p: Payload) => log.push(["editReply", p.content ?? p.embeds?.[0]?.data?.title ?? p.embeds?.[0]?.data?.description ?? headOf(p)]),
    followUp: async (p: Payload) => (log.push(["followUp", p.content ?? headOf(p)]), { id: "f1" }),
    deleteReply: async () => log.push(["deleteReply"]),
    ...extra,
  });
  return { it, log, bot: w.bot };
}

// ── 접두사로 분기 ───────────────────────────────────────────────────

test("음악 버튼: 옛 세션의 버튼은 거절, 모르는 버튼은 알린다, 처리 중 예외를 던지면 일반 오류", async () => {
  const w = world();
  const stale = press(w, "panel:skip:OLD");
  await interactionCreate.execute(stale.bot, stale.it);
  assert.deepEqual(stale.log, [["reply", said(errors.notice("stale-session"))]]);

  const unknown = press(w, "panel:nope:S1");
  await interactionCreate.execute(unknown.bot, unknown.it);
  assert.deepEqual(unknown.log, [["reply", said(errors.notice("unknown-interaction"))]]);

  Object.defineProperty(w.player, "queue", {
    get() {
      throw new Error("boom");
    },
  });
  const broken = press(w, "panel:queue:S1");
  await interactionCreate.execute(broken.bot, broken.it);
  assert.deepEqual(broken.log, [["reply", said(errors.notice("processing-failed"))]]);
});

// ── 조작이 실패했을 때의 답 ───────────────────────────────────────────

test("조작 버튼: 플레이어가 거절하면 실패 문장(건너뛰기, 이전곡)", async () => {
  const w = world();
  w.player.currentTrack = { title: "곡", url: "u" };
  w.player.queue = [{ title: "다음" }];
  w.player.previousTracks = [{ title: "앞" }];
  const cases = [
    ["panel:skip:S1", "### ⚠️ 작업에 실패했어요!"],
    ["panel:previous:S1", "### ⚠️ 작업에 실패했어요!"],
  ];
  for (const [id, want] of cases) {
    const { it, log, bot } = press(w, id);
    await interactionCreate.execute(bot, it);
    assert.deepEqual(log, [["reply", want]], id);
  }
});

test("조작 버튼: 성공하면 곡 썸네일을 담아 응답하고 패널을 갱신한다(일시정지, 건너뛰기, 반복)", async () => {
  const w = world();
  w.player.currentTrack = { title: "곡", url: "https://u.test", thumbnail: "https://t.test/a.jpg" };
  w.player.queue = [{ title: "다음" }];
  w.player.skip = () => true;
  const pause = press(w, "panel:pause:S1");
  await interactionCreate.execute(pause.bot, pause.it);
  assert.deepEqual(pause.log, [["reply", "### ⏸️ 일시정지했어요!"]]);
  const skip = press(w, "panel:skip:S1");
  await interactionCreate.execute(skip.bot, skip.it);
  assert.deepEqual(skip.log, [["reply", "### ⏭️ 곡을 건너뛰었어요!"]]);
  // 한 곡 반복이면 건너뛰지 않고 처음부터 다시 튼다. 헤더 줄 없이 그 안내만
  w.player.loop = "track";
  const again = press(w, "panel:skip:S1");
  await interactionCreate.execute(again.bot, again.it);
  assert.deepEqual(again.log, [["reply", "### 🔂 곡을 되감았어요!"]]);
  w.player.loop = false;
  const loop = press(w, "panel:loop:S1");
  await interactionCreate.execute(loop.bot, loop.it);
  assert.equal(w.player.loop, "track");
  assert.ok(w.seen.filter((x) => x === "update").length >= 3);
});

// 같은 조작이면 명령과 패널 버튼이 같은 화면(Components V2)을 그린다
test("조작 응답: 명령과 패널 버튼이 한 화면을 쓴다(일시정지, 건너뛰기, 이전 곡, 반복)", async () => {
  const commands = { pause: (await import("../../src/discord/commands/pause.ts")).default, skip: (await import("../../src/discord/commands/skip.ts")).default, previous: (await import("../../src/discord/commands/previous.ts")).default, loop: (await import("../../src/discord/commands/loop.ts")).default };
  const ready = () => {
    const w = world();
    w.player.currentTrack = { title: "곡", pageUrl: "https://u.test", thumbnail: "https://t.test/a.jpg" };
    w.player.queue = [{ title: "다음" }];
    w.player.previousTracks = [{ title: "앞" }];
    w.player.skip = () => true;
    w.player.previous = () => true;
    return w;
  };
  for (const [name, command] of Object.entries(commands)) {
    const sent: unknown[] = [];
    const record = async (p: { toJSON?: unknown; components?: Array<{ toJSON(): unknown }>; flags?: unknown }) => {
      sent.push({ components: p.components?.map((c) => c.toJSON()), flags: p.flags });
      return { resource: { message: { id: "r1" } } };
    };
    const b = ready();
    await interactionCreate.execute(b.bot, press(b, `panel:${name}:S1`, { reply: record }).it);
    const c = ready();
    const asked = fake<Parameters<typeof command.execute>[0]>({ ...interactionKind("command"), guild: c.guild, member: c.member, options: { getString: () => null }, reply: record, deleteReply: async () => {} });
    await command.execute(asked, c.bot);
    assert.equal(sent.length, 2, name);
    assert.deepEqual(sent[1], sent[0], name);
  }
});

test("조작 응답: 누가 했나는 Components V2 화면에 담고, 일시정지는 썸네일을 붙이지 않는다", async () => {
  const w = world();
  w.player.currentTrack = { title: "곡", pageUrl: "https://u.test", thumbnail: "https://t.test/a.jpg" };
  let payload: Payload = {};
  const { it, bot } = press(w, "panel:pause:S1", { reply: async (p: Payload) => ((payload = p), { resource: { message: { id: "r1" } } }) });
  await interactionCreate.execute(bot, it);
  assert.equal(thumbnailOf(payload), null);
  assert.deepEqual(textsOf(payload), ["### ⏸️ 일시정지했어요!\n**[곡](https://u.test)**을 일시정지했어요.", `-# 👤 요청한 사람 <@${USER}>`]);
  assert.deepEqual(lifetimesOf(it), [LIFETIME.result], "조작 결과의 수명");
});

test("하이라이트 버튼: 옮기는 중을 본인에게 먼저 보내고, 그 메시지를 삭제하고 결과는 모두에게. 없으면 조용히 넘긴다", async () => {
  const w = world();
  w.player.currentTrack = { title: "곡", pageUrl: "https://u.test", duration: 300 };
  const p = w.player as typeof w.player & { sponsor?: { highlightAt: number | null }; seek?: () => Promise<void>; isLive?: boolean; isPlayStarting?: boolean };
  p.sponsor = { highlightAt: 42 };
  p.seek = async () => {};
  const done = press(w, "panel:highlight:S1");
  await interactionCreate.execute(done.bot, done.it);
  assert.deepEqual(done.log, [["reply", "🔄 하이라이트로 건너뛰는 중..."], ["deleteReply"], ["send", "### ✨ 하이라이트로 건너뛰었어요!"]]);
  p.sponsor = { highlightAt: null };
  const none = press(w, "panel:highlight:S1");
  await interactionCreate.execute(none.bot, none.it);
  assert.deepEqual(none.log, [["deferUpdate"]]);
});

test("하이라이트 버튼: 봇 전체에서 SponsorBlock을 껐으면 남은 패널의 버튼은 없는 것과 같다", async () => {
  const w = world();
  w.player.currentTrack = { title: "곡", pageUrl: "https://u.test", duration: 300 };
  const p = w.player as typeof w.player & { sponsor?: { highlightAt: number | null }; seek?: () => Promise<void> };
  p.sponsor = { highlightAt: 42 };
  let seeked = false;
  p.seek = async () => void (seeked = true);
  const off = press(w, "panel:highlight:S1");
  await withConfig({ sponsorblock: { enabled: false } }, () => interactionCreate.execute(off.bot, off.it));
  assert.deepEqual(off.log, [["reply", said(errors.notice("unknown-interaction"))]]);
  assert.equal(seeked, false);
});

// ── 대기열 버튼 ───────────────────────────────────────────────────────

// 대기열 화면은 /queue와 한 벌이다(ui/queue-view). 한 페이지 10곡, 넘치면 넘기기 버튼(아이콘만, 앱 이모지를 동기화하기 전에는 ◀ ▶)과 페이지 버튼, 끝에 편집 버튼
type QueuePayload = Payload & { flags?: unknown };
type QueueNode = { type?: number; custom_id?: string; disabled?: boolean; components?: QueueNode[] };
function buttonsOf(p: QueuePayload) {
  const out: Array<[string | undefined, boolean]> = [];
  const walk = (node: QueueNode) => {
    if (node.type === 2) out.push([node.custom_id, node.disabled ?? false]);
    node.components?.forEach(walk);
  };
  p.components?.forEach((c) => walk(c.toJSON() as QueueNode));
  return out;
}
const cv2Message = { id: "queue-msg", flags: { has: (flag: number) => flag === MessageFlags.IsComponentsV2 } };

test("대기열 버튼: 비었으면 알리고, 있으면 /queue와 같은 첫 페이지와 넘기기 버튼(본인에게만, Components V2)", async () => {
  const w = world();
  const empty = press(w, "panel:queue:S1");
  await interactionCreate.execute(empty.bot, empty.it);
  assert.deepEqual(empty.log, [["reply", said(errors.notice("queue-empty"))]]);
  w.player.currentTrack = { title: "지금", pageUrl: "now" };
  const onlyNow = press(w, "panel:queue:S1");
  await interactionCreate.execute(onlyNow.bot, onlyNow.it);
  assert.deepEqual(onlyNow.log, [["reply", said(errors.notice("queue-empty"))]], "지금 곡만 있으면 비었다");

  w.player.currentTrack = { title: "지금", pageUrl: "now" };
  w.player.queue = Array.from({ length: 12 }, (_, i) => ({ title: `곡${i + 1}`, pageUrl: `u${i}`, duration: 60 }));
  const got: { payload?: QueuePayload } = {};
  const full = press(w, "panel:queue:S1", {
    reply: async (p: QueuePayload) => {
      got.payload = p;
    },
  });
  await interactionCreate.execute(full.bot, full.it);
  const payload = got.payload;
  assert.ok(payload);
  assert.deepEqual([payload.flags].flat(), [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]);
  const text = textsOf(payload).join("\n");
  assert.ok(text.includes("`1` **[곡1]") && text.includes("`10` **[곡10]"), text);
  assert.ok(!text.includes("곡11"), "한 페이지 10곡");
  assert.ok(text.includes("-# 총 12곡"), text);
  assert.deepEqual(buttonsOf(payload), [
    ["queue:page:0", true],
    ["queue:goto:browse:1", false],
    ["queue:page:2", false],
    ["queue:edit:1", false],
  ]);
});

test("대기열 넘기기: 그 메시지를 그때의 대기열로 다시 그린다(미룬 뒤 고친다). 곡이 없으면 지우고 알리고, 옛 임베드 화면은 모른다고 한다", async () => {
  const w = world();
  w.player.currentTrack = { title: "지금", pageUrl: "now" };
  w.player.queue = Array.from({ length: 12 }, (_, i) => ({ title: `곡${i + 1}`, pageUrl: `u${i}`, duration: 60 }));
  const edits: QueuePayload[] = [];
  const turn = (id: string) => press(w, id, { message: cv2Message, editReply: async (p: QueuePayload) => edits.push(p) });
  const next = turn("queue:page:2");
  await interactionCreate.execute(next.bot, next.it);
  assert.deepEqual(next.log, [["deferUpdate"]]);
  assert.ok(textsOf(edits[0]).join("\n").includes("`11` **[곡11]"), "번호는 페이지를 이어 센다");
  assert.deepEqual(edits[0].attachments, [], "붙어 있던 이미지를 뗀다");
  assert.deepEqual(buttonsOf(edits[0]), [
    ["queue:page:1", false],
    ["queue:goto:browse:2", false],
    ["queue:page:3", true],
    ["queue:edit:2", false],
  ]);

  // 그사이 곡이 줄어 페이지가 없어졌으면 끝 페이지로. 한 페이지면 편집 버튼만
  w.player.queue = w.player.queue.slice(0, 3);
  await interactionCreate.execute(w.bot, turn("queue:page:2").it);
  assert.ok(textsOf(edits[1]).join("\n").includes("-# 총 3곡"));
  assert.deepEqual(buttonsOf(edits[1]), [["queue:edit:1", false]]);

  const old = press(w, "queue:page:1", { message: { id: "old", flags: { has: () => false } } });
  await interactionCreate.execute(old.bot, old.it);
  assert.deepEqual(old.log, [["reply", said(errors.notice("unknown-interaction"))]], "업데이트 전의 임베드 화면");

  w.player.currentTrack = null;
  w.player.queue = [];
  const gone = turn("queue:page:1");
  await interactionCreate.execute(gone.bot, gone.it);
  assert.equal(edits.length, 2, "대기열 화면은 안내로 고칠 수 없다");
  assert.deepEqual(gone.log, [["deferUpdate"], ["deleteReply"], ["followUp", said(errors.notice("queue-empty"))]], "그 화면을 지우고 본인에게만 알린다");
});

// ── 자동재생 버튼 ─────────────────────────────────────────────────────

test("자동재생 버튼: 플레이어가 없어도 받는다. 켜져 있으면 끄고 다시 선택 메뉴, 꺼져 있으면 장르 메뉴", async () => {
  const on = world();
  on.player.autoplay = "가요";
  const a = press(on, "panel:autoplay:S1");
  await interactionCreate.execute(a.bot, a.it);
  assert.deepEqual(on.seen, ["autoplay:false", "update"]);
  assert.equal(a.log[0][0], "reply");
  assert.deepEqual(lifetimesOf(a.it), [LIFETIME.menu], "다시 고르기 메뉴는 메뉴 수명 뒤 지운다");

  const off = world();
  const b = press(off, "panel:autoplay:S1");
  await interactionCreate.execute(b.bot, b.it);
  assert.deepEqual(off.seen, []);
  assert.equal(b.log[0][0], "reply");
  assert.deepEqual(lifetimesOf(b.it), [LIFETIME.menu], "장르 메뉴도 메뉴 수명 뒤 지운다");
});

test("자동재생 버튼: 플레이어가 없으면 만들지 않고 장르 메뉴만 표시한다(선택한 뒤에 만든다)", async () => {
  const none = world({ player: false });
  const { it, log, bot } = press(none, "panel:autoplay:idle");
  await interactionCreate.execute(bot, it);
  assert.equal(log.length, 1);
  assert.equal(log[0][0], "reply");
  assert.equal(none.bot.players.size, 0);
});

test("자동재생 버튼: 옛 세션의 패널 버튼은 거절하고 자동재생을 건드리지 않는다", async () => {
  const w = world();
  w.player.autoplay = "가요";
  const { it, log, bot } = press(w, "panel:autoplay:OLD");
  await interactionCreate.execute(bot, it);
  assert.deepEqual(log, [["reply", said(errors.notice("stale-session"))]]);
  assert.deepEqual(w.seen, []);
});

// /join 뒤, 대기열이 끝나 기다리는 동안에는 플레이어가 있고 패널은 끝난 패널(세션 슬롯 idle)이다
test("자동재생 버튼: 끝난 패널의 버튼은 플레이어가 있어도 통한다. 꺼져 있으면 장르 메뉴, 켜져 있으면 끄고 다시 선택 메뉴", async () => {
  const off = world();
  const a = press(off, "panel:autoplay:idle");
  await interactionCreate.execute(a.bot, a.it);
  assert.equal(a.log[0][0], "reply");
  assert.notEqual(a.log[0][1], said(errors.notice("stale-session")));
  assert.deepEqual(lifetimesOf(a.it), [LIFETIME.menu]);

  const on = world();
  on.player.autoplay = "가요";
  const b = press(on, "panel:autoplay:idle");
  await interactionCreate.execute(b.bot, b.it);
  assert.deepEqual(on.seen, ["autoplay:false", "update"]);
  assert.deepEqual(lifetimesOf(b.it), [LIFETIME.menu]);
});

test("자동재생 버튼: DJ 계층, 봇이 쉬면 소환할 수 있어야 한다", async () => {
  const idle = world({ botVoice: null, userVoice: null });
  const { it, log, bot } = press(idle, "panel:autoplay:S1");
  await interactionCreate.execute(bot, it);
  assert.deepEqual(log, [["reply", said(errors.notice("must-be-in-voice"))]]);
});

// ── 핑 다시 재기 ─────────────────────────────────────────────

test("핑 다시 재기: 같은 메시지를 측정 중 화면으로 고친 시각으로 응답 시간을 재고, 잰 값으로 다시 고친다", async () => {
  const edits: Payload[] = [];
  const updates: Payload[] = [];
  const w = world();
  const at = Date.now();
  const { it, log, bot } = press(w, "ping:again", {
    createdTimestamp: at,
    update: async (p: Payload) => (updates.push(p), { resource: { message: { editedTimestamp: at + 120 } } }),
    editReply: async (p: Payload) => edits.push(p),
  });
  await interactionCreate.execute(bot, it);
  assert.deepEqual(log, []);
  assert.ok(textsOf(updates[0]).join("\n").includes("핑 측정 중..."));
  const done = textsOf(edits[0]).join("\n");
  assert.ok(done.includes("**응답 시간** `120ms`"), done);
  assert.ok(done.includes("**게이트웨이** `42ms`"));
});

// ── 시스템 새로고침 ──────────────────────────────────────────

test("시스템 새로고침: 봇 운영자만. 같은 메시지의 이미지를 교체하고(기존 첨부는 비운다), 업데이트 전에 보낸 임베드 메시지는 오래된 버튼 안내", async () => {
  const saved = config.dashboard.ownerId;
  const v2 = { message: { id: "system-msg", flags: { has: (flag: number) => flag === MessageFlags.IsComponentsV2 } } };
  try {
    config.dashboard.ownerId = "owner";
    const w = world();
    const denied = press(w, "system:refresh", v2);
    await interactionCreate.execute(denied.bot, denied.it);
    assert.deepEqual(denied.log, [["reply", said(errors.notice("must-owner"))]]);

    config.dashboard.ownerId = USER;
    const edits: Payload[] = [];
    const ok = press(w, "system:refresh", { ...v2, editReply: async (p: Payload) => edits.push(p) });
    await interactionCreate.execute(ok.bot, ok.it);
    assert.deepEqual(ok.log, [["deferUpdate"]]);
    assert.equal(headOf(edits[0]), "### 🖥️ 시스템 상태");
    assert.deepEqual(edits[0].attachments, []);
    assert.deepEqual(
      edits[0].files?.map((f) => f.name),
      ["system.png", "history.png"],
    );

    const old = press(w, "system:refresh", { message: { id: "embed-msg", flags: { has: () => false } } });
    await interactionCreate.execute(old.bot, old.it);
    assert.deepEqual(old.log, [["reply", said(errors.notice("unknown-interaction"))]]);
  } finally {
    config.dashboard.ownerId = saved;
  }
});
