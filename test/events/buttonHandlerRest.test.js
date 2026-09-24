// 버튼 처리기의 나머지 갈래를 고정한다(구조 리팩터링 0-B). 조작 전제 조건은 controlEntrances.test.js 의 표가 본다.
// 여기서는 검색 결과 버튼 · 도움말 · 시스템 새로고침 · 자동재생 버튼 · 대기열 버튼 · 옛 세션 · 모르는 버튼 · 조작이 실패했을 때를 본다.
//
// 6단계가 이 파일을 customId 앞머리별 처리기 표로 바꾼다. 권한 판정 · 서버 설정 · 곡 추가 코어는 진짜(서버 설정은 임시 DB),
// 화면 관리자만 가짜다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import * as storeDb from "../../src/store/db.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "button-rest-"));
const audioCache = await import("../../src/store/audioCache.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
audioCache.initialize(path.join(TMP, "cache.db"));

const config = (await import("../../config.ts")).default;
const S = (await import("../../src/ui/strings.js")).default;
const settings = await import("../../src/store/guildSettings.ts");
const playerEvents = (await import("../../src/player/events.ts")).default;
const buttonHandler = (await import("../../events/buttonHandler.js")).default;

after(() => {
  audioCache.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

beforeEach(() => {
  settings._reset();
  storeDb.get().exec("DELETE FROM guild_settings;");
});

const USER = "111111111111111111";

function world({ botVoice = "v1", userVoice = "v1", player = true, handle = async () => ({ success: true }) } = {}) {
  const voice = (id) => (id ? { id, name: id, permissionsFor: () => ({ has: () => true }) } : null);
  const guild = { id: "g1", members: { me: { id: "bot", voice: { channel: voice(botVoice) } } }, channels: { cache: new Map() }, roles: { cache: new Map() } };
  const member = { id: USER, user: { id: USER }, displayName: "사용자", guild, voice: { channel: voice(userVoice) }, permissions: { has: () => false }, roles: { cache: { has: () => false } }, toString: () => `<@${USER}>` };
  const seen = [];
  const client = {
    players: new Map(),
    guilds: { cache: Object.assign(new Map(), { reduce: (fn, init) => init }) },
    user: { id: "bot", username: "뮤직봇", displayAvatarURL: () => "https://avatar.test/a.png" },
    searchResults: new Map(),
    musicEmbedManager: {
      handleMusicData: async (guildId, trackData) => {
        seen.push({ handle: trackData.tracks.map((t) => t.title) });
        return handle(trackData);
      },
      updateNowPlayingEmbed: async () => seen.push("update"),
    },
  };
  guild.client = client;
  const p = {
    sessionId: "S1",
    queue: [],
    previousTracks: [],
    currentTrack: null,
    autoplay: false,
    paused: false,
    loop: false,
    releaseLoopForLive() {},
    getQueue() {
      return { current: this.currentTrack, queue: this.queue };
    },
    setAutoplay(v) {
      seen.push(`autoplay:${v}`);
      this.autoplay = v;
    },
    pause: () => false,
    resume: () => false,
    skip: () => false,
    previous: () => false,
    hasLiveTrack: () => false,
    setLoop(m) {
      this.loop = m;
    },
  };
  if (player) client.players.set("g1", p);
  // 조작 뒤 패널 고치기는 플레이어 알림으로 온다
  playerEvents.on("refresh", async (x) => x === p && seen.push("update"));
  return { guild, member, client, seen, player: p };
}

function press(w, customId, extra = {}) {
  const log = [];
  const it = {
    customId,
    guild: w.guild,
    member: w.member,
    user: w.member.user,
    client: w.client,
    channel: { id: "c1", send: async () => ({ id: "x" }) },
    message: { id: "search-msg" },
    replied: false,
    deferred: false,
    isButton: () => true,
    reply: async (p) => {
      it.replied = true;
      log.push(["reply", p.content ?? p.embeds?.[0]?.data?.title ?? "(메뉴)"]);
    },
    update: async (p) => log.push(["update", p.embeds[0].data.title]),
    deferUpdate: async () => {
      it.deferred = true;
      log.push(["deferUpdate"]);
    },
    editReply: async (p) => log.push(["editReply", p.content ?? p.embeds?.[0]?.data?.title ?? p.embeds?.[0]?.data?.description]),
    followUp: async (p) => log.push(["followUp", p.content]),
    deleteReply: async () => log.push(["deleteReply"]),
    ...extra,
  };
  return { it, log };
}

// ── 앞머리로 가르기 ───────────────────────────────────────────────────

test("djrole: · sb: 버튼은 전용 처리기가 맡아 건드리지 않는다. 버튼이 아니면 무시", async () => {
  const w = world();
  for (const id of ["djrole:save", "sb:toggle"]) {
    const { it, log } = press(w, id);
    await buttonHandler.execute(it);
    assert.deepEqual(log, [], id);
  }
  const notButton = press(w, "music_skip:u:S1", { isButton: () => false });
  await buttonHandler.execute(notButton.it);
  assert.deepEqual(notButton.log, []);
});

test("음악 버튼: 옛 세션의 버튼은 거절, 모르는 버튼은 알린다, 처리 중 던지면 일반 오류", async () => {
  const w = world();
  const stale = press(w, "music_skip:u:OLD");
  await buttonHandler.execute(stale.it);
  assert.deepEqual(stale.log, [["reply", S.ERR_SESSION_INVALID]]);

  const unknown = press(w, "music_nope:u:S1");
  await buttonHandler.execute(unknown.it);
  assert.deepEqual(unknown.log, [["reply", "❌ 알 수 없는 상호작용!"]]);

  w.player.getQueue = () => {
    throw new Error("boom");
  };
  const broken = press(w, "music_queue:u:S1");
  await buttonHandler.execute(broken.it);
  assert.deepEqual(broken.log, [["reply", S.ERR_PROCESSING]]);
});

// ── 조작이 실패했을 때의 답 ───────────────────────────────────────────

test("조작 버튼: 플레이어가 거절하면 실패 문장(일시정지 · 건너뛰기 · 이전곡)", async () => {
  const w = world();
  w.player.currentTrack = { title: "곡", url: "u" };
  w.player.queue = [{ title: "다음" }];
  w.player.previousTracks = [{ title: "앞" }];
  const cases = [
    ["music_pause:u:S1", "❌ 작업이 실패했습니다!"],
    ["music_skip:u:S1", "❌ 노래가 건너뛰어지지 않았습니다!"],
    ["music_previous:u:S1", "❌ 이전 노래로 이동하지 못했습니다!"],
  ];
  for (const [id, want] of cases) {
    const { it, log } = press(w, id);
    await buttonHandler.execute(it);
    assert.deepEqual(log, [["reply", want]], id);
  }
});

test("조작 버튼: 성공하면 곡 썸네일을 담아 답하고 패널을 갱신한다(일시정지 · 건너뛰기 · 반복)", async () => {
  const w = world();
  w.player.currentTrack = { title: "곡", url: "https://u.test", thumbnail: "https://t.test/a.jpg" };
  w.player.queue = [{ title: "다음" }];
  w.player.pause = () => true;
  w.player.skip = () => true;
  const pause = press(w, "music_pause:u:S1");
  await buttonHandler.execute(pause.it);
  assert.deepEqual(pause.log, [["reply", "⏸️ 음악 일시정지됨"]]);
  const skip = press(w, "music_skip:u:S1");
  await buttonHandler.execute(skip.it);
  assert.deepEqual(skip.log, [["reply", "⏭️ 노래 건너뜀"]]);
  const loop = press(w, "music_loop:u:S1");
  await buttonHandler.execute(loop.it);
  assert.equal(w.player.loop, "track");
  assert.ok(w.seen.filter((x) => x === "update").length >= 3);
});

// ── 대기열 버튼 ───────────────────────────────────────────────────────

test("대기열 버튼: 비었으면 알리고, 있으면 앞 10곡과 나머지 수를 보인다", async () => {
  const w = world();
  const empty = press(w, "music_queue:u:S1");
  await buttonHandler.execute(empty.it);
  assert.deepEqual(empty.log, [["reply", S.ERR_NO_SONGS_IN_QUEUE]]);

  w.player.currentTrack = { title: "지금", pageUrl: "now" };
  w.player.queue = Array.from({ length: 12 }, (_, i) => ({ title: `곡${i + 1}`, pageUrl: `u${i}`, duration: 60 }));
  const full = press(w, "music_queue:u:S1");
  let payload;
  full.it.reply = async (p) => (payload = p);
  await buttonHandler.execute(full.it);
  const fields = Object.fromEntries(payload.embeds[0].data.fields.map((f) => [f.name, f.value]));
  assert.equal(fields["🎵 현재 재생 중"], "**[지금](now)**");
  assert.match(fields["📋 다음 노래들 (12개)"], /\*\.\.\. 그리고 2개 더\*$/);
  assert.equal(payload.embeds[0].data.footer.text, "총 13개의 노래");
});

// ── 자동재생 버튼 ─────────────────────────────────────────────────────

test("자동재생 버튼: 플레이어가 없어도 받는다. 켜져 있으면 끄고 다시 고르기 메뉴, 꺼져 있으면 장르 메뉴", async () => {
  const on = world();
  on.player.autoplay = "가요";
  const a = press(on, "music_autoplay:u:S1");
  await buttonHandler.execute(a.it);
  assert.deepEqual(on.seen, ["autoplay:false", "update"]);
  assert.equal(a.log[0][0], "reply");

  const off = world();
  const b = press(off, "music_autoplay:u:S1");
  await buttonHandler.execute(b.it);
  assert.deepEqual(off.seen, []);
  assert.equal(b.log[0][0], "reply");
});

test("자동재생 버튼: DJ 계층, 봇이 쉬면 소환할 수 있어야 한다", async () => {
  const idle = world({ botVoice: null, userVoice: null });
  const { it, log } = press(idle, "music_autoplay:u:S1");
  await buttonHandler.execute(it);
  assert.deepEqual(log, [["reply", S.ERR_VOICE_REQUIRED]]);
});

// ── 도움말 · 시스템 새로고침 ──────────────────────────────────────────

test("도움말 새로고침: 제자리에서 다시 그린다. 실패하면 뒤따라 알린다", async () => {
  const w = world();
  const ok = press(w, "help_refresh");
  await buttonHandler.execute(ok.it);
  assert.deepEqual(ok.log, [["deferUpdate"], ["editReply", "🎵 도움말"]]);

  w.client.user.displayAvatarURL = () => {
    throw new Error("x");
  };
  const bad = press(w, "help_refresh");
  await buttonHandler.execute(bad.it);
  assert.deepEqual(bad.log, [["deferUpdate"], ["followUp", "❌ 도움말을 새로고침하는 중 오류가 발생했습니다!"]]);
});

test("시스템 새로고침: 봇 운영자만", async () => {
  const saved = config.dashboard.ownerId;
  try {
    config.dashboard.ownerId = "owner";
    const w = world();
    const denied = press(w, "system_refresh");
    await buttonHandler.execute(denied.it);
    assert.deepEqual(denied.log, [["reply", "❌ 봇 운영자만 사용할 수 있습니다!"]]);

    config.dashboard.ownerId = USER;
    const ok = press(w, "system_refresh");
    await buttonHandler.execute(ok.it);
    assert.deepEqual(ok.log, [["deferUpdate"], ["editReply", "🖥️ 시스템 상태"]]);
  } finally {
    config.dashboard.ownerId = saved;
  }
});

// ── 검색 결과 버튼 ────────────────────────────────────────────────────

function withResults(w, { userId = USER, results = [{ title: "결과 1", url: "https://youtu.be/aaaaaaaaaaa" }] } = {}) {
  w.client.searchResults.set("search-msg", { userId, query: "q", results, timestamp: Date.now() });
}

test("검색 버튼: 봇이 음성에 있으면 재적 규칙, 쉬면 본인이 음성에 있어야 한다", async () => {
  const other = world({ userVoice: "v2" });
  const a = press(other, "search_select_0");
  await buttonHandler.execute(a.it);
  assert.deepEqual(a.log, [["reply", S.ERR_SAME_CHANNEL]]);

  const idle = world({ botVoice: null, userVoice: null });
  const b = press(idle, "search_select_0");
  await buttonHandler.execute(b.it);
  assert.deepEqual(b.log, [["reply", S.ERR_VOICE_REQUIRED]]);
});

test("검색 버튼: 결과가 없거나 남의 검색이거나 번호가 틀리면 거절, 취소하면 지운다", async () => {
  const w = world();
  const gone = press(w, "search_select_0");
  await buttonHandler.execute(gone.it);
  assert.deepEqual(gone.log, [["reply", "❌ 검색 결과를 찾을 수 없거나 만료되었습니다! 다시 검색해 주세요."]]);

  withResults(w, { userId: "someone" });
  const others = press(w, "search_select_0");
  await buttonHandler.execute(others.it);
  assert.deepEqual(others.log, [["reply", "❌ 검색을 요청한 사용자만 선택할 수 있습니다!"]]);

  withResults(w);
  const bad = press(w, "search_select_7");
  await buttonHandler.execute(bad.it);
  assert.deepEqual(bad.log, [["reply", "❌ 잘못된 선택입니다!"]]);

  const cancel = press(w, "search_cancel");
  await buttonHandler.execute(cancel.it);
  assert.deepEqual(cancel.log, [["update", "❌ 검색 취소됨"]]);
  assert.equal(w.client.searchResults.has("search-msg"), false);
});

test("검색 버튼: 고른 곡을 코어에 넘기고, 처리 중 표시 뒤 검색 메시지를 치운다", async () => {
  const w = world();
  withResults(w);
  const { it, log } = press(w, "search_select_0");
  await buttonHandler.execute(it);
  assert.deepEqual(w.seen, [{ handle: ["결과 1"] }]);
  assert.deepEqual(log, [["deferUpdate"], ["editReply", "🔄 처리 중..."], ["deleteReply"]]);
  assert.equal(w.client.searchResults.has("search-msg"), false);
});

test("검색 버튼: 코어가 실패하면 그 문장, 던지면 일반 오류로 바꾼다", async () => {
  const failed = world({ handle: async () => ({ success: false, message: "대기열이 가득 찼습니다" }) });
  withResults(failed);
  const a = press(failed, "search_select_0");
  await buttonHandler.execute(a.it);
  assert.deepEqual(a.log.at(-1), ["editReply", "❌ 오류"]);

  const thrown = world({
    handle: async () => {
      throw new Error("boom");
    },
  });
  withResults(thrown);
  const b = press(thrown, "search_select_0");
  await buttonHandler.execute(b.it);
  assert.deepEqual(b.log.at(-1), ["editReply", "❌ 오류"]);
});
