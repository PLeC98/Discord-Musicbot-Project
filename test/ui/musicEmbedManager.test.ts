// src/ui/nowPlayingPanel.js — 서버별 음악 처리 락 (Promise tail 체인).
// 실제 처리(_processMusic)는 스텁하고 직렬화 계약만 검증한다.
// 회귀 대상: 구 "await 후 set" 방식의 A/B/C 경쟁 (앞 작업 finally가 뒤 작업 락을 삭제 → 동시 실행)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { MusicEmbedManager, type TrackData } from "../../src/ui/nowPlayingPanel.ts";
import type { Client } from "discord.js";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";

const newManager = () => new MusicEmbedManager(fake<Client>({ players: new Map() }));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const p = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { p, resolve, reject };
}

// 작업 이름. 첫 곡의 제목에 싣는다
const job = (id: string): TrackData => ({ tracks: [{ title: id, pageUrl: "", requestKey: id, platform: "youtube", duration: 0 }] });

// 실제 처리(_processMusic)를 시험이 끝낼 때까지 붙잡는 관리자. 끝나면 작업 이름을 message 로 돌려준다
class GatedManager extends MusicEmbedManager {
  events: string[] = [];
  gates = new Map<string, ReturnType<typeof deferred>>(); // id -> deferred (테스트가 완료 시점을 제어)
  active = 0;
  maxActive = 0;

  async _processMusic(_guildId: string, trackData: TrackData) {
    const id = trackData.tracks[0].title;
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.events.push(`start:${id}`);
    const gate = deferred();
    this.gates.set(id, gate);
    try {
      await gate.p;
      this.events.push(`end:${id}`);
      return { success: true, message: id };
    } finally {
      this.active--;
    }
  }

  // 붙잡아 둔 작업 하나
  gate(id: string) {
    const gate = this.gates.get(id);
    assert.ok(gate, `${id} 가 시작했다`);
    return gate;
  }
}

function makeManager() {
  const mem = new GatedManager(fake<Client>({ players: new Map() }));
  return { mem, stats: mem };
}
// 끝난 작업의 이름
const doneAs = async (p: Promise<{ message?: string }>) => (await p).message;

const tick = () => new Promise((r) => setImmediate(r));

test("같은 서버 동시 3건(A/B/C)은 항상 순차 실행 — 구 락 경쟁 회귀 방지", async () => {
  const { mem, stats } = makeManager();

  // 동기적으로 연속 진입 (실사용: 동시 /play + 메시지 추가 + 검색 선택)
  const pA = mem.handleMusicData("g1", job("A"), null);
  const pB = mem.handleMusicData("g1", job("B"), null);
  const pC = mem.handleMusicData("g1", job("C"), null);

  await tick();
  assert.deepEqual(stats.events, ["start:A"], "A만 시작 — B/C는 대기");

  stats.gate("A").resolve();
  assert.equal(await doneAs(pA), "A");
  await tick();
  assert.deepEqual(stats.events, ["start:A", "end:A", "start:B"], "A 종료 후에야 B 시작");

  // 원 버그의 핵심 시나리오: B 실행 중에 D가 도착 — A의 정리가 락을 지웠다면 D는 B와 동시 실행됐다
  const pD = mem.handleMusicData("g1", job("D"), null);
  await tick();
  assert.ok(!stats.events.includes("start:D"), "B 실행 중 도착한 D는 대기");

  stats.gate("B").resolve();
  assert.equal(await doneAs(pB), "B");
  stats.gate("C").resolve();
  await tick();
  assert.equal(await doneAs(pC), "C");
  stats.gate("D").resolve();
  assert.equal(await doneAs(pD), "D");

  assert.equal(stats.maxActive, 1, "동시 실행은 항상 최대 1");
  assert.deepEqual(stats.events, ["start:A", "end:A", "start:B", "end:B", "start:C", "end:C", "start:D", "end:D"]);
  assert.equal(mem.processingQueue.size, 0, "전부 끝나면 락 맵 비움");
});

test("앞 작업 실패가 뒤 작업을 막지 않음 — 오류는 자기 호출자에게만", async () => {
  const { mem, stats } = makeManager();

  const pA = mem.handleMusicData("g1", job("A"), null);
  const pB = mem.handleMusicData("g1", job("B"), null);

  await tick();
  stats.gate("A").reject(new Error("A boom"));
  await assert.rejects(pA, /A boom/);

  await tick();
  assert.ok(stats.events.includes("start:B"), "A가 실패해도 B는 실행");
  stats.gate("B").resolve();
  assert.equal(await doneAs(pB), "B");
  assert.equal(mem.processingQueue.size, 0);
});

test("다른 서버는 직렬화되지 않음 — 서버 간 병렬", async () => {
  const { mem, stats } = makeManager();

  const p1 = mem.handleMusicData("g1", job("G1"), null);
  const p2 = mem.handleMusicData("g2", job("G2"), null);

  await tick();
  assert.ok(stats.events.includes("start:G1") && stats.events.includes("start:G2"), "두 서버 모두 즉시 시작");

  stats.gate("G2").resolve();
  assert.equal(await doneAs(p2), "G2", "g1이 진행 중이어도 g2는 완료 가능");
  stats.gate("G1").resolve();
  assert.equal(await doneAs(p1), "G1");
  assert.equal(mem.processingQueue.size, 0);
});

// CV2 Section은 액세서리(썸네일/버튼)가 없으면 전송 시 검증에서 거부된다.
// 직접 링크는 thumbnail이 null이라 now-playing 갱신이 매번 CombinedError로 죽었다
// (2026-09-08 실사용 발견 — 재생은 되는데 임베드만 계속 실패).
test("now-playing 컨테이너: 썸네일 유무와 무관하게 전송 가능한 형태여야 한다", async () => {
  const mem = newManager();
  const player = fakePlayer({
    getCurrentTime: () => 0,
    queue: [],
    previousTracks: [],
    loop: false,
    paused: false,
    isPlaybackActive: () => true,
    getStatus: () => ({ playing: true, paused: false, volume: 100, loop: false }),
  });
  const base: QueuedTrack = { title: "Test", pageUrl: "https://example.org/a.mp3", requestKey: "https://example.org/a.mp3", duration: 127, platform: "direct" };

  for (const thumbnail of [null, undefined, "", "https://example.org/t.jpg"]) {
    const container = await mem.createNowPlayingContainer(player, { ...base, thumbnail });
    // toJSON이 실제 전송 시 도는 검증 — 썸네일이 없을 때 여기서 터졌다
    const json = container.toJSON();
    assert.ok(JSON.stringify(json).includes("Test"), `제목이 담겨야 한다 (thumbnail=${thumbnail})`);
  }
});

test("now-playing 컨테이너: 제목 링크는 음원 파일이 아니라 보여 줄 링크(pageUrl)다", async () => {
  const mem = newManager();
  const player = fakePlayer({ getCurrentTime: () => 0, queue: [], previousTracks: [], loop: false, paused: false, isPlaybackActive: () => true, getStatus: () => ({ playing: true, paused: false, volume: 100, loop: false }) });
  const track: QueuedTrack = { title: "주제가", duration: 90, platform: "anisongdb", pageUrl: "https://anilist.co/anime/1", requestKey: "amq:1", audioUrl: "https://nawdist.animemusicquiz.com/a.mp3" };

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

function panelPlayer(over: object = {}) {
  return fakePlayer({
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
  });
}
// 컨테이너 JSON 에서 보는 칸
type Json = { components: Array<{ type: number; components?: Array<{ disabled?: boolean; custom_id?: string }>; accessory?: { media: { url: string } } }> };
const shape = (json: Json) => json.components.map((c) => c.type);
const buttonsOf = (json: Json) => json.components.filter((c) => c.type === 1).flatMap((row) => row.components ?? []);
// 빌더를 JSON 으로
const jsonOf = (builder: { toJSON(): unknown }) => builder.toJSON() as Json;

test("종료 모양: 재생 화면과 구성이 같고, 자동재생만 눌리고, 썸네일 자리는 첨부한 투명 이미지다", async () => {
  const mem = newManager();
  const player = panelPlayer();
  const playing = jsonOf(await mem.createNowPlayingContainer(player, { title: "곡", pageUrl: "https://example.org/a", requestKey: "https://example.org/a", duration: 100, platform: "youtube", thumbnail: "https://example.org/t.jpg" }));
  const { components, files } = await mem.createIdleContainer({ reason: "stop" });
  const idle = jsonOf(components[0]);

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
  assert.equal(idle.components[0].accessory?.media.url, "attachment://blank.png");
  assert.equal(files[0].name, "blank.png");
});

test("종료 모양의 문구는 사유를 따른다", async () => {
  const mem = newManager();
  const text = async (opts: Parameters<MusicEmbedManager["createIdleContainer"]>[0]) => JSON.stringify((await mem.createIdleContainer(opts)).components[0].toJSON());

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
    const cases: Array<[botChannel: string | null, expectNotice: boolean]> = [
      ["chan-1", false],
      [null, true],
    ];
    for (const [botChannel, expectNotice] of cases) {
      tempStore.setGuild("g1", { botChannel });
      const mem = newManager();
      // 패널을 고친 내용. 여기서 보는 칸만
      const edits: Array<{ id: string; payload: { components: Array<{ toJSON(): unknown }>; files: Array<{ name: string }> } }> = [];
      const sent: unknown[] = [];
      const player = panelPlayer({
        nowPlayingMessage: { id: "100" },
        nowPlayingWebhook: { editMessage: async (id: string, payload: (typeof edits)[number]["payload"]) => edits.push({ id, payload }) },
        textChannel: { id: "chan-1", send: async (payload: unknown) => sent.push(payload) },
      });

      await mem.handlePlaybackEnd(player, { reason: "stop" });

      assert.equal(edits.length, 1, `패널을 고친다 (전용 채널=${botChannel})`);
      assert.equal(edits[0].id, "100");
      const idleButtons = buttonsOf(jsonOf(edits[0].payload.components[0]));
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
  const mem = newManager();
  const json = JSON.stringify((await mem.createIdleContainer({ reason: "joined", leavesAt: 1_600_000 })).components[0].toJSON());
  assert.match(json, /곡을 기다리고 있어요/);
  assert.match(json, /<t:1600:R> 쉬러 갈게요/);
});

// ── 패널에 보일 출처 이름 ─────────────────────────────────────────────────

// 회귀 대상: platform 을 그대로 첫 글자만 올려 썼다. platform 은 내부 분류 코드라
// "Lbradio"·"Vocadb"·"Lastfm" 처럼 아무도 안 쓰는 표기가 패널에 그대로 나왔다.
test("출처 이름은 그 서비스가 쓰는 표기를 따른다", () => {
  const label = (p: string | null) => newManager().getPlatformLabel(p);

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
