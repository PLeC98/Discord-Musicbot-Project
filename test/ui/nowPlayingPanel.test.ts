// src/ui/nowPlayingPanel.ts — 재생 패널 그리기 · 끝난 패널 · 진행 막대. 곡 담기의 줄 세우기는 test/usecases/queueTracksOrder.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NowPlayingPanel } from "../../src/ui/nowPlayingPanel.ts";
import { MessageFlags, type Client } from "discord.js";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";
import * as tempStore from "../helpers/tempStore.ts";
import sink from "../../src/infra/log/sink.ts";
import config from "../../config.ts";

const newManager = () => new NowPlayingPanel(fake<Client>({ players: new Map() }));

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
  const player = fakePlayer({ getCurrentTime: () => 0, queue: [], previousTracks: [], loop: false, paused: false });
  const track: QueuedTrack = { title: "주제가", duration: 90, platform: "anisongdb", pageUrl: "https://anilist.co/anime/1", requestKey: "amq:1", audioUrl: "https://nawdist.animemusicquiz.com/a.mp3" };

  const json = JSON.stringify((await mem.createNowPlayingContainer(player, track)).toJSON());
  assert.ok(json.includes("[주제가](https://anilist.co/anime/1)"));
  assert.ok(!json.includes("nawdist"));
});

// ── 끝난 패널 ──
// 부르는 곳이 전부 현재 곡을 먼저 비워, 버튼 끄기가 한 번도 돌지 않았다(2026-09-16).

// 전용 채널은 임시 DB 에 둔다
const store = tempStore.openTempStore("embed-manager-");
after(() => store.close());

function panelPlayer(over: object = {}) {
  return fakePlayer({
    guild: { id: "g1" },
    sessionId: "s1",
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

// 대시보드 주소를 정해 두고 부른다. 시험은 로컬 .env 를 읽으므로 주소가 링크를 가르는 시험은 값을 정한다
async function withDashboardUrl<T>(url: string, run: () => Promise<T>) {
  const saved = config.dashboard.url;
  config.dashboard.url = url;
  try {
    return await run();
  } finally {
    config.dashboard.url = saved;
  }
}

test("종료 모양: 재생 화면과 구성이 같고, 자동재생만 눌리고, 썸네일 자리는 첨부한 투명 이미지다", async () => {
  const mem = newManager();
  const player = panelPlayer();
  const { playing, components, files } = await withDashboardUrl("https://music.example.com", async () => ({
    playing: jsonOf(await mem.createNowPlayingContainer(player, { title: "곡", pageUrl: "https://example.org/a", requestKey: "https://example.org/a", duration: 100, platform: "youtube", thumbnail: "https://example.org/t.jpg" })),
    ...(await mem.createIdleContainer({ reason: "stop" })),
  }));
  const idle = jsonOf(components[0]);

  assert.deepEqual(shape(idle), shape(playing));
  assert.equal(buttonsOf(idle).length, buttonsOf(playing).length);
  // 자동재생만 살린다 — 끝난 패널에서 다시 틀 수 있는 유일한 길이다(3단계). 나머지는 대기열 버튼까지 꺼진다.
  const alive = buttonsOf(idle).filter((b) => !b.disabled);
  assert.deepEqual(
    alive.map((b) => b.custom_id),
    ["panel:autoplay:idle"],
    "자동재생 하나만 눌린다",
  );
  assert.ok(buttonsOf(idle).length > 1, "나머지 버튼도 같은 자리에 그려진다(모양 유지)");
  assert.equal(idle.components[0].accessory?.media.url, "attachment://blank.png");
  assert.equal(files[0].name, "blank.png");
});

// 기본값 localhost · 사설 주소는 다른 사람이 열 수 없다(G20)
test("대시보드 링크는 DASHBOARD_URL 이 공개 주소일 때만. 없으면 재생 화면은 플랫폼만, 끝난 화면은 아래 줄이 없다", async () => {
  const mem = newManager();
  const track: QueuedTrack = { title: "곡", pageUrl: "https://example.org/a", requestKey: "https://example.org/a", duration: 100, platform: "youtube" };
  const draw = (url: string) =>
    withDashboardUrl(url, async () => ({
      playing: JSON.stringify((await mem.createNowPlayingContainer(panelPlayer(), track)).toJSON()),
      idle: JSON.stringify((await mem.createIdleContainer({ reason: "stop" })).components[0].toJSON()),
    }));

  const shown = await draw("https://music.example.com");
  assert.match(shown.playing, /-# 🔗 \[대시보드\]\(https:\/\/music\.example\.com\) {2}\| {2}🖥️ /);
  assert.match(shown.idle, /-# 🔗 \[대시보드\]\(https:\/\/music\.example\.com\)/);

  for (const url of ["http://localhost:33333", "http://192.168.0.10:33333"]) {
    const hidden = await draw(url);
    assert.ok(!hidden.playing.includes("대시보드") && !hidden.idle.includes("대시보드"), url);
    const count = (json: string) => (JSON.parse(json) as { components: unknown[] }).components.length;
    assert.equal(count(hidden.idle), count(shown.idle) - 2, `${url}: 끝난 화면에는 구분선과 아래 줄이 없다`);
    assert.match(hidden.playing, /"-# 🖥️ /, `${url}: 재생 화면에는 플랫폼만`);
  }
});

test("종료 모양의 문구는 사유를 따른다", async () => {
  const mem = newManager();
  const text = async (opts: Parameters<NowPlayingPanel["createIdleContainer"]>[0]) => JSON.stringify((await mem.createIdleContainer(opts)).components[0].toJSON());

  const waiting = await text({ reason: "queue-end", leavesAt: 1_600_000 });
  assert.match(waiting, /재생 대기 중/);
  assert.match(waiting, /재생이 끝났어요/);
  assert.match(waiting, /<t:\d+:R> 쉬러 갈게요/);
  assert.match(await text({ reason: "leave" }), /듣고 있던 곡이 있어요.*\/join/);
  assert.match(await text({ reason: "stop", dedicated: true }), /쉬는 중이에요.*곡을 입력하면/);
  assert.match(await text({ reason: "disconnected" }), /쉬는 중이에요.*\/play/);
  const failed = await text({ reason: "failures" });
  assert.match(failed, /곡 재생에 연달아 실패해서 재생을 멈췄어요.*곡을 넣으면 다시 틀게요/);
  assert.doesNotMatch(failed, /쉬러 갈게요/, "대기열이 남으면 나가지 않으니 나갈 시각을 보이지 않는다");
});

test("곡이 연달아 실패해 멈춘 것은 전용 채널 밖이어도 '모든 노래가 재생되었습니다' 메시지를 보내지 않는다(채널 알림이 따로 간다)", async () => {
  tempStore.setGuild("g1", { botChannel: null });
  const mem = newManager();
  const sent: unknown[] = [];
  const player = panelPlayer({
    nowPlayingMessage: { id: "100" },
    nowPlayingWebhook: { editMessage: async () => {} },
    textChannel: { id: "chan-1", send: async (payload: unknown) => sent.push(payload) },
  });

  await mem.drawEndedPanel(player, { reason: "failures" });

  assert.equal(sent.length, 0);
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

      await mem.drawEndedPanel(player, { reason: "queue-end" });

      assert.equal(edits.length, 1, `패널을 고친다 (전용 채널=${botChannel})`);
      assert.equal(edits[0].id, "100");
      const idleButtons = buttonsOf(jsonOf(edits[0].payload.components[0]));
      assert.ok(
        idleButtons.filter((b) => !b.disabled).every((b) => (b.custom_id || "").startsWith("panel:autoplay:")),
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

test("끝 안내는 다 틀었거나 끊겼을 때만(끊김은 그 까닭으로). 사람이 멈추거나 내보낸 것 · 연달아 실패는 보내지 않는다", async () => {
  const cases: Array<[reason: string, cause: string | undefined, notice: string | null]> = [
    ["queue-end", undefined, "재생이 끝났어요"],
    ["stop", "stop", null],
    ["leave", "leave", null],
    ["disconnected", "stop", null],
    ["failures", undefined, null],
    ["disconnected", "inactivity-timeout", "쉬러 갔어요"],
    ["disconnected", "forced-disconnect", "내보냈어요"],
    ["disconnected", "operator-leave", "봇 운영자가"],
    ["disconnected", "voice-lost", "다시 붙지 못했어요"],
    ["disconnected", "channel-gone", "채널이 사라졌어요"],
    ["stop", "fault", "되풀이되어"],
  ];
  for (const [reason, cause, notice] of cases) {
    const sent: unknown[] = [];
    const player = panelPlayer({
      nowPlayingMessage: { id: "100" },
      nowPlayingWebhook: { editMessage: async () => {} },
      textChannel: { id: "chan-1", send: async (payload: unknown) => sent.push(payload) },
    });
    await newManager().drawEndedPanel(player, { reason, cause });
    const label = `${reason}/${cause}`;
    if (!notice) {
      assert.equal(sent.length, 0, label);
      continue;
    }
    assert.equal(sent.length, 1, label);
    assert.deepEqual((sent[0] as { flags: unknown }).flags, [MessageFlags.IsComponentsV2], `${label}: 응답 틀(Components V2)`);
    assert.match(JSON.stringify(sent[0]), new RegExp(notice), label);
  }
});

test("/join만 했을 때: 곡을 기다리는 문구와 퇴장 시각", async () => {
  const mem = newManager();
  const json = JSON.stringify((await mem.createIdleContainer({ reason: "joined", leavesAt: 1_600_000 })).components[0].toJSON());
  assert.match(json, /곡을 기다리고 있어요/);
  assert.match(json, /<t:1600:R> 쉬러 갈게요/);
});

test("진행 막대: 한 번 갱신이 모르는 오류로 던지면 남기고 이 곡의 갱신을 멈춘다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mem = newManager();
  const player = fakePlayer({ guild: { id: "g1", name: "서버" }, currentTrack: { title: "곡" }, nowPlayingMessage: { id: "m1" } });
  mem._tickProgress = async () => {
    throw new Error("boom");
  };
  const from = sink.buffer.length;
  mem.startProgressUpdate(player);
  t.mock.timers.tick(5000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mem.progressTimers.has("g1"), false);
  assert.deepEqual(
    sink.buffer
      .slice(from)
      .filter((e) => e.text.startsWith("진행 막대"))
      .map((e) => [e.level, e.text.split("\n")[0]]),
    [["error", "진행 막대 갱신이 던져 이 곡의 갱신을 멈춤 (서버): Error: boom"]],
  );
});

// 디스코드가 5초 넘게 걸려도 두 갱신이 겹치지 않는다(G38)
test("진행 막대: 앞 갱신이 끝난 뒤 5초에 다음을 건다. 갱신 중에 멈추면 다시 걸지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mem = newManager();
  const player = fakePlayer({ guild: { id: "g1", name: "서버" }, currentTrack: { title: "곡" }, nowPlayingMessage: { id: "m1" } });
  let running = 0;
  let started = 0;
  let release = () => {};
  mem._tickProgress = () => {
    started++;
    running++;
    return new Promise<void>((done) => {
      release = () => {
        running--;
        done();
      };
    });
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  mem.startProgressUpdate(player);
  mem.stopProgressUpdate("g1");
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(started, 0, "갱신 전에 멈추면 한 번도 돌지 않는다");

  mem.startProgressUpdate(player);
  t.mock.timers.tick(5_000);
  await flush();
  assert.equal(started, 1);
  t.mock.timers.tick(20_000);
  await flush();
  assert.equal(started, 1, "앞 갱신이 안 끝났으면 다음을 걸지 않는다");

  release();
  await flush();
  t.mock.timers.tick(4_999);
  await flush();
  assert.equal(started, 1, "끝난 뒤부터 5초");
  t.mock.timers.tick(1);
  await flush();
  assert.equal(started, 2);
  assert.equal(running, 1);

  mem.stopProgressUpdate("g1");
  release();
  await flush();
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(started, 2, "갱신 중에 멈췄으면 다시 걸지 않는다");
  assert.equal(mem.progressTimers.has("g1"), false);
});
