// 버튼 처리기의 나머지 갈래를 고정한다(구조 리팩터링 0-B). 조작 전제 조건은 control-entrances.test.ts 의 표가 본다.
// 여기서는 검색 결과 버튼 · 도움말 · 시스템 새로고침 · 자동재생 버튼 · 대기열 버튼 · 옛 세션 · 모르는 버튼 · 조작이 실패했을 때를 본다.
//
// 6단계가 이 파일을 customId 앞머리별 처리기 표로 바꾼다. 권한 판정 · 서버 설정 · 곡 추가 코어는 진짜(서버 설정은 임시 DB),
// 화면 관리자만 가짜다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { ButtonInteraction } from "discord.js";
import { settingsDb } from "../../src/store/settings-db.ts";
import * as stores from "../../src/store/stores.ts";
import { Player } from "../../src/player/player.ts";
import { fake, fakeWith, fakeBot } from "../helpers/fake.ts";
import { youtube } from "../helpers/tracks.ts";
import { useExampleConfig } from "../helpers/example-config.ts";
import { interactionKind } from "../helpers/interaction-kind.ts";
import { withConfig } from "../helpers/config.ts";
import { fakeAdder } from "../helpers/adder.ts";
import { headOf, textsOf, thumbnailOf } from "../helpers/cv2.ts";
import { noticeReply } from "../../src/ui/frame.ts";
import type { Notice } from "../../src/ui/text/notice.ts";
import { COMMANDS } from "../../src/discord/commands/index.ts";

useExampleConfig();

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "button-rest-"));
const audioCache = await import("../../src/store/audio-cache.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
stores.open(TMP);
audioCache.initialize();

const config = (await import("../../src/config/index.ts")).default;
const errors = await import("../../src/ui/text/ko/errors.ts");
// 안내 응답의 머리 줄
const said = (notice: Notice) => headOf(noticeReply(notice));
const settings = await import("../../src/store/guild-settings.ts");
const playerEvents = await import("../../src/player/events.ts");
const interactionCreate = (await import("../../src/discord/events/interaction-create.ts")).default;
const addTracks = await import("../../src/usecases/add-tracks.ts");
const { LIFETIME, lifetimesOf } = await import("../../src/ui/delivery.ts");
const sink = (await import("../../src/infra/log/sink.ts")).default;

// 검색 결과 고르기는 영상을 다시 찾는다. 찾은 주소를 적고 "결과 1" 을 돌려준다
const asked: string[] = [];
addTracks.useLookup({
  resolveQuery: async (query: string) => {
    asked.push(query);
    return { success: true, isPlaylist: false, tracks: [youtube("aaaaaaaaaaa", { title: "결과 1" })] };
  },
  getCollection: async () => ({ tracks: [], total: null, nextOffset: null }),
});

after(() => {
  addTracks.useLookup(null);
  audioCache.close();
  stores.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

beforeEach(() => {
  settings._reset();
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
  };
  const bot = fakeBot({
    client,
    players: new Map<string, Player>(),
    panels: {
      updatePlaying: async () => seen.push("update"),
    },
    // 실행 목록. 도움말 새로고침이 이것으로 명령 줄을 만든다
    commands: new Map(COMMANDS.map((command) => [command.data.name, command])),
  });
  // 곡 담기는 받은 곡의 제목만 적는다
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
    loop: false as string | false,
    releaseLoopForLive() {},
    setAutoplay(v: string | false) {
      seen.push(`autoplay:${v}`);
      p.autoplay = v;
    },
    pauseFor: () => false,
    resumeFor: () => false,
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
  // 조작 뒤 패널 고치기는 플레이어 알림으로 온다
  playerEvents.on("refresh", async (x) => x === registered && seen.push("update"));
  return { guild, member, client, bot, seen, player: p };
}

type Payload = { content?: string; embeds?: { data: { title?: string; description?: string } }[]; components?: Array<{ toJSON(): unknown }> };
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

// ── 앞머리로 가르기 ───────────────────────────────────────────────────

test("음악 버튼: 옛 세션의 버튼은 거절, 모르는 버튼은 알린다, 처리 중 던지면 일반 오류", async () => {
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

test("조작 버튼: 플레이어가 거절하면 실패 문장(일시정지 · 건너뛰기 · 이전곡)", async () => {
  const w = world();
  w.player.currentTrack = { title: "곡", url: "u" };
  w.player.queue = [{ title: "다음" }];
  w.player.previousTracks = [{ title: "앞" }];
  const cases = [
    ["panel:pause:S1", "### ❌ 작업이 실패했어요!"],
    ["panel:skip:S1", "### ⚠️ 작업에 실패했어요!"],
    ["panel:previous:S1", "### ⚠️ 작업에 실패했어요!"],
  ];
  for (const [id, want] of cases) {
    const { it, log, bot } = press(w, id);
    await interactionCreate.execute(bot, it);
    assert.deepEqual(log, [["reply", want]], id);
  }
});

test("조작 버튼: 성공하면 곡 썸네일을 담아 답하고 패널을 갱신한다(일시정지 · 건너뛰기 · 반복)", async () => {
  const w = world();
  w.player.currentTrack = { title: "곡", url: "https://u.test", thumbnail: "https://t.test/a.jpg" };
  w.player.queue = [{ title: "다음" }];
  w.player.pauseFor = () => true;
  w.player.skip = () => true;
  const pause = press(w, "panel:pause:S1");
  await interactionCreate.execute(pause.bot, pause.it);
  assert.deepEqual(pause.log, [["reply", "### ⏸️ 일시정지했어요!"]]);
  const skip = press(w, "panel:skip:S1");
  await interactionCreate.execute(skip.bot, skip.it);
  assert.deepEqual(skip.log, [["reply", "### ⏭️ 곡을 건너뛰었어요!"]]);
  // 한 곡 반복이면 건너뛰지 않고 처음부터 다시 튼다. 머리 줄 없이 그 안내만
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
test("조작 응답: 명령과 패널 버튼이 한 화면을 쓴다(일시정지 · 건너뛰기 · 이전 곡 · 반복)", async () => {
  const commands = { pause: (await import("../../src/discord/commands/pause.ts")).default, skip: (await import("../../src/discord/commands/skip.ts")).default, previous: (await import("../../src/discord/commands/previous.ts")).default, loop: (await import("../../src/discord/commands/loop.ts")).default };
  const ready = () => {
    const w = world();
    w.player.currentTrack = { title: "곡", pageUrl: "https://u.test", thumbnail: "https://t.test/a.jpg" };
    w.player.queue = [{ title: "다음" }];
    w.player.previousTracks = [{ title: "앞" }];
    w.player.pauseFor = () => true;
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
  w.player.pauseFor = () => true;
  let payload: Payload = {};
  const { it, bot } = press(w, "panel:pause:S1", { reply: async (p: Payload) => ((payload = p), { resource: { message: { id: "r1" } } }) });
  await interactionCreate.execute(bot, it);
  assert.equal(thumbnailOf(payload), null);
  assert.deepEqual(textsOf(payload), ["### ⏸️ 일시정지했어요!\n**[곡](https://u.test)**을 일시정지 했어요.", `-# 👤 요청한 사람 <@${USER}>`]);
  assert.deepEqual(lifetimesOf(it), [LIFETIME.result], "조작 결과의 수명");
});

test("하이라이트 버튼: 옮기는 중을 본인에게 먼저 보내고, 그 자리를 지우고 결과는 모두에게. 없으면 조용히 넘긴다", async () => {
  const w = world();
  w.player.currentTrack = { title: "곡", pageUrl: "https://u.test", duration: 300 };
  const p = w.player as typeof w.player & { sponsor?: { highlightAt: number | null }; seek?: () => Promise<void>; isLive?: boolean; isPlayStarting?: boolean };
  p.sponsor = { highlightAt: 42 };
  p.seek = async () => {};
  const done = press(w, "panel:highlight:S1");
  await interactionCreate.execute(done.bot, done.it);
  assert.deepEqual(done.log, [["reply", "✨ 하이라이트로 건너뛰는 중..."], ["deleteReply"], ["send", "### ✨ 하이라이트로 건너 뛰었어요!"]]);
  p.sponsor = { highlightAt: null };
  const none = press(w, "panel:highlight:S1");
  await interactionCreate.execute(none.bot, none.it);
  assert.deepEqual(none.log, [["deferUpdate"]]);
});

test("하이라이트 버튼: 봇 전체에서 SponsorBlock 을 껐으면 남은 패널의 버튼은 없는 것과 같다", async () => {
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

// 대기열 화면은 /queue 와 한 벌이다(ui/queue-view). 한 쪽 10곡, 넘치면 넘기기 버튼(◀ ▶)
type QueueEmbed = { data: { description?: string; fields?: unknown; footer: { text: string } } };
type QueueRow = { components: Array<{ data: { custom_id?: string; label?: string; disabled?: boolean } }> };
type QueuePayload = { content?: string; embeds: QueueEmbed[]; components: QueueRow[] };
const buttonsOf = (p: QueuePayload) => p.components.flatMap((row) => row.components.map((c) => [c.data.label, c.data.custom_id, !!c.data.disabled]));

test("대기열 버튼: 비었으면 알리고, 있으면 /queue 와 같은 첫 쪽과 넘기기 버튼", async () => {
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
  const text = String(payload.embeds[0].data.description);
  assert.match(text, /^`1\.` \*\*\[곡1\]/);
  assert.match(text, /`10\.` \*\*\[곡10\]/);
  assert.doesNotMatch(text, /곡11/, "한 쪽 10곡");
  assert.equal(payload.embeds[0].data.footer.text, "모두 12곡 • 1/2쪽");
  assert.deepEqual(buttonsOf(payload), [
    ["◀", "queue:page:0", true],
    ["▶", "queue:page:2", false],
  ]);
});

test("대기열 넘기기: 그 메시지를 그때의 대기열로 다시 그린다. 곡이 없으면 그렇다고 고친다", async () => {
  const w = world();
  w.player.currentTrack = { title: "지금", pageUrl: "now" };
  w.player.queue = Array.from({ length: 12 }, (_, i) => ({ title: `곡${i + 1}`, pageUrl: `u${i}`, duration: 60 }));
  const updates: QueuePayload[] = [];
  const next = press(w, "queue:page:2", { update: async (p: QueuePayload) => updates.push(p) });
  await interactionCreate.execute(next.bot, next.it);
  const text = String(updates[0].embeds[0].data.description);
  assert.match(text, /^`11\.` \*\*\[곡11\]/, "번호는 쪽을 이어 센다");
  assert.equal(updates[0].embeds[0].data.footer.text, "모두 12곡 • 2/2쪽");
  assert.deepEqual(buttonsOf(updates[0]), [
    ["◀", "queue:page:1", false],
    ["▶", "queue:page:3", true],
  ]);

  // 그사이 곡이 줄어 쪽이 없어졌으면 끝 쪽으로
  w.player.queue = w.player.queue.slice(0, 3);
  await interactionCreate.execute(w.bot, press(w, "queue:page:2", { update: async (p: QueuePayload) => updates.push(p) }).it);
  assert.equal(updates[1].embeds[0].data.footer.text, "모두 3곡");
  assert.deepEqual(updates[1].components, [], "한 쪽이면 버튼이 없다");

  w.player.currentTrack = null;
  w.player.queue = [];
  const gone = press(w, "queue:page:1", { update: async (p: QueuePayload) => updates.push(p) });
  await interactionCreate.execute(gone.bot, gone.it);
  assert.equal(updates.length, 2, "대기열 화면은 안내로 고칠 수 없다");
  assert.deepEqual(gone.log, [["deferUpdate"], ["deleteReply"], ["followUp", said(errors.notice("queue-empty"))]], "그 화면을 지우고 본인에게만 알린다");
});

// ── 자동재생 버튼 ─────────────────────────────────────────────────────

test("자동재생 버튼: 플레이어가 없어도 받는다. 켜져 있으면 끄고 다시 고르기 메뉴, 꺼져 있으면 장르 메뉴", async () => {
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

test("자동재생 버튼: 플레이어가 없으면 만들지 않고 장르 메뉴만 띄운다(고른 뒤에 만든다)", async () => {
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

// /join 뒤 · 대기열이 끝나 기다리는 동안에는 플레이어가 있고 패널은 끝난 패널(세션 자리 idle)이다
test("자동재생 버튼: 끝난 패널의 버튼은 플레이어가 있어도 통한다. 꺼져 있으면 장르 메뉴, 켜져 있으면 끄고 다시 고르기 메뉴", async () => {
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

// ── 도움말 · 시스템 새로고침 ──────────────────────────────────────────

test("도움말 새로고침: 제자리에서 다시 그린다. 실패하면 뒤따라 알린다", async () => {
  const w = world();
  const ok = press(w, "help:refresh");
  await interactionCreate.execute(ok.bot, ok.it);
  assert.deepEqual(ok.log, [["deferUpdate"], ["editReply", "🎵 도움말"]]);

  w.client.user.displayAvatarURL = () => {
    throw new Error("x");
  };
  const bad = press(w, "help:refresh");
  await interactionCreate.execute(bad.bot, bad.it);
  assert.deepEqual(bad.log, [["deferUpdate"], ["followUp", said(errors.notice("refresh-failed"))]]);
});

test("시스템 새로고침: 봇 운영자만", async () => {
  const saved = config.dashboard.ownerId;
  try {
    config.dashboard.ownerId = "owner";
    const w = world();
    const denied = press(w, "system:refresh");
    await interactionCreate.execute(denied.bot, denied.it);
    assert.deepEqual(denied.log, [["reply", said(errors.notice("must-owner"))]]);

    config.dashboard.ownerId = USER;
    const ok = press(w, "system:refresh");
    await interactionCreate.execute(ok.bot, ok.it);
    assert.deepEqual(ok.log, [["deferUpdate"], ["editReply", "🖥️ 시스템 상태"]]);
  } finally {
    config.dashboard.ownerId = saved;
  }
});

// ── 검색 결과 버튼 ────────────────────────────────────────────────────

const PICK = `search:pick:${USER}:1:aaaaaaaaaaa`;

test("검색 버튼: 고르기는 곡 추가와 같은 검사. 봇이 음성에 있으면 재적 규칙, 쉬면 소환할 수 있어야 한다", async () => {
  const other = world({ userVoice: "v2" });
  const a = press(other, PICK);
  await interactionCreate.execute(a.bot, a.it);
  assert.deepEqual(a.log, [["reply", said(errors.notice("must-be-in-same-voice"))]]);

  const idle = world({ botVoice: null, userVoice: null });
  const b = press(idle, PICK);
  await interactionCreate.execute(b.bot, b.it);
  assert.deepEqual(b.log, [["reply", said(errors.notice("must-be-in-voice"))]]);

  const denied = world({ botVoice: null, userVoice: "v1" });
  denied.member.voice.channel = { id: "v1", name: "v1", permissionsFor: () => ({ has: () => false }) };
  const c = press(denied, PICK);
  await interactionCreate.execute(c.bot, c.it);
  assert.deepEqual(c.log, [["reply", said(errors.notice("permission-voice"))]], "봇이 연결 · 말하기 권한이 없으면 /play 처럼 막는다");
  assert.deepEqual(denied.seen, []);
});

test("검색 버튼: 검색한 사람만 누른다. 모르는 동작 · 틀린 영상 ID 는 거절, 취소는 음성에 없어도 되고 결과 화면을 바로 지운다", async () => {
  const w = world();
  const others = press(w, "search:pick:someone:1:aaaaaaaaaaa");
  await interactionCreate.execute(others.bot, others.it);
  assert.deepEqual(others.log, [["reply", said(errors.notice("search-owner-only"))]]);
  const othersCancel = press(w, "search:cancel:someone");
  await interactionCreate.execute(othersCancel.bot, othersCancel.it);
  assert.deepEqual(othersCancel.log, [["reply", said(errors.notice("search-owner-only"))]]);

  for (const id of [`search:pick:${USER}:1:bad`, `search:nope:${USER}:1:aaaaaaaaaaa`]) {
    const bad = press(w, id);
    await interactionCreate.execute(bad.bot, bad.it);
    assert.deepEqual(bad.log, [["reply", said(errors.notice("unknown-interaction"))]], id);
  }
  assert.deepEqual(w.seen, []);

  const away = world({ botVoice: null, userVoice: null });
  const cancel = press(away, `search:cancel:${USER}`);
  await interactionCreate.execute(cancel.bot, cancel.it);
  assert.deepEqual(cancel.log, [["deferUpdate"], ["deleteReply"]]);
});

test("검색 버튼: 고른 영상을 주소로 다시 찾아 코어에 넘기고, 처리 중 표시 뒤 검색 메시지를 치운다", async () => {
  const w = world();
  asked.length = 0;
  const from = sink.buffer.length;
  const { it, log, bot } = press(w, PICK);
  await interactionCreate.execute(bot, it);
  assert.deepEqual(asked, ["https://www.youtube.com/watch?v=aaaaaaaaaaa"]);
  assert.ok(
    sink.buffer.slice(from).some((e) => e.text.startsWith("곡 요청: /search 1번째 | ")),
    "몇 번째를 골랐는지 남긴다",
  );
  assert.deepEqual(w.seen, [{ handle: ["결과 1"] }]);
  assert.deepEqual(log, [["deferUpdate"], ["editReply", "🔄 넣는 중..."], ["deleteReply"]]);
});

test("검색 버튼: 코어가 실패하면 그 안내, 던지면 일반 오류. 검색 메시지를 지우고 본인에게만", async () => {
  const failed = world({ handle: async () => ({ success: false, message: "대기열이 가득 찼습니다" }) });
  const a = press(failed, PICK);
  await interactionCreate.execute(a.bot, a.it);
  assert.deepEqual(a.log.slice(-2), [["deleteReply"], ["followUp", said(errors.notice("cannot-start"))]]);

  const thrown = world({
    handle: async () => {
      throw new Error("boom");
    },
  });
  const b = press(thrown, PICK);
  await interactionCreate.execute(b.bot, b.it);
  assert.deepEqual(b.log.slice(-2), [["deleteReply"], ["followUp", said(errors.notice("processing-failed"))]]);
});
