// src/ui/nowPlayingPanel.js — 서버별 음악 처리 락 (Promise tail 체인).
// 실제 처리(_processMusic)는 스텁하고 직렬화 계약만 검증한다.
// 회귀 대상: 구 "await 후 set" 방식의 A/B/C 경쟁 (앞 작업 finally가 뒤 작업 락을 삭제 → 동시 실행)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import MusicEmbedManager from "../../src/ui/nowPlayingPanel.ts";

function deferred() {
  let resolve, reject;
  const p = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { p, resolve, reject };
}

// _processMusic을 수동 제어 가능한 스텁으로 교체한 인스턴스
function makeManager() {
  const mem = new MusicEmbedManager({ players: new Map() });
  const events = [];
  const gates = new Map(); // id -> deferred (테스트가 완료 시점을 제어)
  let active = 0;
  let maxActive = 0;

  mem._processMusic = async (guildId, trackData) => {
    active++;
    maxActive = Math.max(maxActive, active);
    events.push(`start:${trackData.id}`);
    const gate = deferred();
    gates.set(trackData.id, gate);
    try {
      await gate.p;
      events.push(`end:${trackData.id}`);
      return trackData.id;
    } finally {
      active--;
    }
  };

  const stats = { events, gates };
  Object.defineProperty(stats, "maxActive", { get: () => maxActive });
  return { mem, stats };
}

const tick = () => new Promise((r) => setImmediate(r));

test("같은 서버 동시 3건(A/B/C)은 항상 순차 실행 — 구 락 경쟁 회귀 방지", async () => {
  const { mem, stats } = makeManager();

  // 동기적으로 연속 진입 (실사용: 동시 /play + 메시지 추가 + 검색 선택)
  const pA = mem.handleMusicData("g1", { id: "A" }, null);
  const pB = mem.handleMusicData("g1", { id: "B" }, null);
  const pC = mem.handleMusicData("g1", { id: "C" }, null);

  await tick();
  assert.deepEqual(stats.events, ["start:A"], "A만 시작 — B/C는 대기");

  stats.gates.get("A").resolve();
  assert.equal(await pA, "A");
  await tick();
  assert.deepEqual(stats.events, ["start:A", "end:A", "start:B"], "A 종료 후에야 B 시작");

  // 원 버그의 핵심 시나리오: B 실행 중에 D가 도착 — A의 정리가 락을 지웠다면 D는 B와 동시 실행됐다
  const pD = mem.handleMusicData("g1", { id: "D" }, null);
  await tick();
  assert.ok(!stats.events.includes("start:D"), "B 실행 중 도착한 D는 대기");

  stats.gates.get("B").resolve();
  assert.equal(await pB, "B");
  stats.gates.get("C").resolve();
  await tick();
  assert.equal(await pC, "C");
  stats.gates.get("D").resolve();
  assert.equal(await pD, "D");

  assert.equal(stats.maxActive, 1, "동시 실행은 항상 최대 1");
  assert.deepEqual(stats.events, ["start:A", "end:A", "start:B", "end:B", "start:C", "end:C", "start:D", "end:D"]);
  assert.equal(mem.processingQueue.size, 0, "전부 끝나면 락 맵 비움");
});

test("앞 작업 실패가 뒤 작업을 막지 않음 — 오류는 자기 호출자에게만", async () => {
  const { mem, stats } = makeManager();

  const pA = mem.handleMusicData("g1", { id: "A" }, null);
  const pB = mem.handleMusicData("g1", { id: "B" }, null);

  await tick();
  stats.gates.get("A").reject(new Error("A boom"));
  await assert.rejects(pA, /A boom/);

  await tick();
  assert.ok(stats.events.includes("start:B"), "A가 실패해도 B는 실행");
  stats.gates.get("B").resolve();
  assert.equal(await pB, "B");
  assert.equal(mem.processingQueue.size, 0);
});

test("다른 서버는 직렬화되지 않음 — 서버 간 병렬", async () => {
  const { mem, stats } = makeManager();

  const p1 = mem.handleMusicData("g1", { id: "G1" }, null);
  const p2 = mem.handleMusicData("g2", { id: "G2" }, null);

  await tick();
  assert.ok(stats.events.includes("start:G1") && stats.events.includes("start:G2"), "두 서버 모두 즉시 시작");

  stats.gates.get("G2").resolve();
  assert.equal(await p2, "G2", "g1이 진행 중이어도 g2는 완료 가능");
  stats.gates.get("G1").resolve();
  assert.equal(await p1, "G1");
  assert.equal(mem.processingQueue.size, 0);
});

// CV2 Section은 액세서리(썸네일/버튼)가 없으면 전송 시 검증에서 거부된다.
// 직접 링크는 thumbnail이 null이라 now-playing 갱신이 매번 CombinedError로 죽었다
// (2026-09-08 실사용 발견 — 재생은 되는데 임베드만 계속 실패).
test("now-playing 컨테이너: 썸네일 유무와 무관하게 전송 가능한 형태여야 한다", async () => {
  const mem = new MusicEmbedManager({ players: new Map() });
  const player = {
    getCurrentTime: () => 0,
    queue: [],
    previousTracks: [],
    loop: false,
    paused: false,
    isPlaybackActive: () => true,
    getStatus: () => ({ playing: true, paused: false, volume: 100, loop: false }),
  };
  const base = { title: "Test", url: "https://example.org/a.mp3", duration: 127, platform: "direct" };

  for (const thumbnail of [null, undefined, "", "https://example.org/t.jpg"]) {
    const container = await mem.createNowPlayingContainer(player, { ...base, thumbnail });
    // toJSON이 실제 전송 시 도는 검증 — 썸네일이 없을 때 여기서 터졌다
    const json = container.toJSON();
    assert.ok(JSON.stringify(json).includes("Test"), `제목이 담겨야 한다 (thumbnail=${thumbnail})`);
  }
});

test("now-playing 컨테이너: 제목 링크는 음원 파일이 아니라 보여 줄 링크(pageUrl)다", async () => {
  const mem = new MusicEmbedManager({ players: new Map() });
  const player = { getCurrentTime: () => 0, queue: [], previousTracks: [], loop: false, paused: false, isPlaybackActive: () => true, getStatus: () => ({ playing: true, paused: false, volume: 100, loop: false }) };
  const track = { title: "주제가", duration: 90, platform: "anisongdb", pageUrl: "https://anilist.co/anime/1", audioUrl: "https://nawdist.animemusicquiz.com/a.mp3" };

  const json = JSON.stringify((await mem.createNowPlayingContainer(player, track)).toJSON());
  assert.ok(json.includes("[주제가](https://anilist.co/anime/1)"));
  assert.ok(!json.includes("nawdist"));
});

// ── 끝난 패널 ──
// 부르는 곳이 전부 현재 곡을 먼저 비워, 버튼 끄기가 한 번도 돌지 않았다(2026-09-16).

const tempStore = (await import("../helpers/tempStore.ts")).default;
// 전용 채널은 임시 DB 에 둔다
const store = tempStore.openTempStore("embed-manager-");
after(() => store.close());

function panelPlayer(over = {}) {
  return {
    guild: { id: "g1" },
    sessionId: "s1",
    requesterId: "u1",
    getCurrentTime: () => 0,
    queue: [],
    previousTracks: [],
    loop: false,
    paused: false,
    currentTrack: null,
    ...over,
  };
}
const shape = (json) => json.components.map((c) => c.type);
const buttonsOf = (json) => json.components.filter((c) => c.type === 1).flatMap((row) => row.components);

test("종료 모양: 재생 화면과 구성이 같고, 자동재생만 눌리고, 썸네일 자리는 첨부한 투명 이미지다", async () => {
  const mem = new MusicEmbedManager({ players: new Map() });
  const player = panelPlayer();
  const playing = (await mem.createNowPlayingContainer(player, { title: "곡", url: "https://example.org/a", duration: 100, platform: "youtube", thumbnail: "https://example.org/t.jpg" })).toJSON();
  const { components, files } = await mem.createIdleContainer({ reason: "stop" });
  const idle = components[0].toJSON();

  assert.deepEqual(shape(idle), shape(playing));
  assert.equal(buttonsOf(idle).length, buttonsOf(playing).length);
  // 자동재생만 살린다 — 끝난 패널에서 다시 틀 수 있는 유일한 길이다(3단계). 나머지는 대기열 버튼까지 꺼진다.
  const alive = buttonsOf(idle).filter((b) => !b.disabled);
  assert.deepEqual(
    alive.map((b) => (b.custom_id || "").split(":")[0]),
    ["music_autoplay"],
    "자동재생 하나만 눌린다",
  );
  assert.ok(buttonsOf(idle).length > 1, "나머지 버튼도 같은 자리에 그려진다(모양 유지)");
  assert.equal(idle.components[0].accessory.media.url, "attachment://blank.png");
  assert.equal(files[0].name, "blank.png");
});

test("종료 모양의 문구는 사유를 따른다", async () => {
  const mem = new MusicEmbedManager({ players: new Map() });
  const text = async (opts) => JSON.stringify((await mem.createIdleContainer(opts)).components[0].toJSON());

  const waiting = await text({ reason: "queue-end", leavesAt: 1_600_000 });
  assert.match(waiting, /재생 대기 중/);
  assert.match(waiting, /재생이 끝났어요/);
  assert.match(waiting, /<t:\d+:R> 쉬러 갈게요/);
  assert.match(await text({ reason: "leave" }), /듣고 있던 곡이 있어요.*\/join/);
  assert.match(await text({ reason: "stop", dedicated: true }), /쉬는 중이에요.*곡을 입력하면/);
  assert.match(await text({ reason: "disconnected" }), /쉬는 중이에요.*\/play/);
});

test("재생이 끝나면 현재 곡을 이미 비웠어도 패널을 종료 모양으로 바꾼다 — 종료 메시지는 전용 채널 밖에서만", async () => {
  try {
    for (const [botChannel, expectNotice] of [
      ["chan-1", false],
      [null, true],
    ]) {
      tempStore.setGuild("g1", { botChannel });
      const mem = new MusicEmbedManager({ players: new Map() });
      const edits = [];
      const sent = [];
      const player = panelPlayer({
        nowPlayingMessage: { id: "100" },
        nowPlayingWebhook: { editMessage: async (id, payload) => edits.push({ id, payload }) },
        textChannel: { id: "chan-1", send: async (payload) => sent.push(payload) },
      });

      await mem.handlePlaybackEnd(player, { reason: "stop" });

      assert.equal(edits.length, 1, `패널을 고친다 (전용 채널=${botChannel})`);
      assert.equal(edits[0].id, "100");
      const idleButtons = buttonsOf(edits[0].payload.components[0].toJSON());
      assert.ok(
        idleButtons.filter((b) => !b.disabled).every((b) => (b.custom_id || "").startsWith("music_autoplay:")),
        "자동재생 외에는 전부 꺼진다",
      );
      assert.equal(edits[0].payload.files[0].name, "blank.png");
      assert.equal(sent.length, expectNotice ? 1 : 0, `종료 메시지 (전용 채널=${botChannel})`);
      assert.equal(player.nowPlayingMessage, null);
    }
  } finally {
    tempStore.setGuild("g1", { botChannel: null });
  }
});

test("/join만 했을 때: 곡을 기다리는 문구와 퇴장 시각", async () => {
  const mem = new MusicEmbedManager({ players: new Map() });
  const json = JSON.stringify((await mem.createIdleContainer({ reason: "joined", leavesAt: 1_600_000 })).components[0].toJSON());
  assert.match(json, /곡을 기다리고 있어요/);
  assert.match(json, /<t:1600:R> 쉬러 갈게요/);
});

// ── 패널에 보일 출처 이름 ─────────────────────────────────────────────────

// 회귀 대상: platform 을 그대로 첫 글자만 올려 썼다. platform 은 내부 분류 코드라
// "Lbradio"·"Vocadb"·"Lastfm" 처럼 아무도 안 쓰는 표기가 패널에 그대로 나왔다.
test("출처 이름은 그 서비스가 쓰는 표기를 따른다", () => {
  const label = (p) => MusicEmbedManager.prototype.getPlatformLabel.call({}, p);

  assert.equal(label("lbradio"), "ListenBrainz Radio");
  assert.equal(label("lastfm"), "Last.fm");
  assert.equal(label("vocadb"), "VocaDB");
  assert.equal(label("utaitedb"), "UtaiteDB");
  assert.equal(label("touhoudb"), "TouhouDB");
  assert.equal(label("animethemes"), "AnimeThemes");
  assert.equal(label("youtube"), "YouTube");
  assert.equal(label("soundcloud"), "SoundCloud");
  assert.equal(label("direct"), "직접 링크");

  // 모르는 값은 첫 글자만 올린다 — 없는 것보다 낫다
  assert.equal(label("새소스"), "새소스");
  assert.equal(label("mixcloud"), "Mixcloud");
  assert.equal(label(null), "-");
});
