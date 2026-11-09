// src/ui/now-playing-panel.ts: 재생 패널 그리기, 끝난 패널, 진행 막대. 곡 추가의 순서는 test/usecases/queue-tracks-order.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NowPlayingPanel } from "../../src/ui/now-playing-panel.ts";
import { Collection, MessageFlags, WebhookClient, type Client, type GuildTextBasedChannel } from "discord.js";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";
import * as tempStore from "../helpers/temp-store.ts";
import sink from "../../src/infra/log/sink.ts";
import config from "../../src/config/index.ts";
import { _internals as discordArt } from "../../src/ui/discord-art.ts";
import { remember } from "../helpers/tagged-audio.ts";

// 큰 썸네일 확인은 네트워크로 나가지 않게: 모든 영상에 큰 썸네일이 있다고 답한다
discordArt.useHead(async () => ({ ok: true, status: 200 }));

const newManager = () => new NowPlayingPanel(fake<Client>({}), new Map());

test("점프 메뉴: 값은 대기열 ID(entry:N), 번호는 이름에만. ID 가 없거나 겹치는 곡은 빼고(값이 겹친 메뉴는 디스코드가 메시지째 거절한다), 남는 곡이 없으면 메뉴 없음", async () => {
  const entered = (title: string, entry?: number) => {
    const track = { title } as QueuedTrack;
    return entry === undefined ? track : Object.defineProperty(track, "entry", { value: entry, enumerable: false });
  };
  const a = entered("A", 7);
  const row = await newManager().createJumpToRow({ sessionId: "s1", queue: [a, entered("B", 3), a, entered("ID 없음")] });
  const options = row?.toJSON().components[0].options ?? [];
  assert.deepEqual(
    options.map((o) => [o.label, o.value]),
    [
      ["1. A", "entry:7"],
      ["2. B", "entry:3"],
    ],
  );
  assert.equal(await newManager().createJumpToRow({ sessionId: "s1", queue: [entered("ID 없음")] }), null);
});

// CV2 Section은 액세서리(썸네일/버튼)가 없으면 전송 시 검증에서 거부된다.
// 직접 링크는 thumbnail이 null 일 수 있다(그대로 보내면 갱신이 매번 CombinedError 로 실패한다).
test("now-playing 컨테이너: 썸네일 유무와 무관하게 전송 가능한 형태여야 한다", async () => {
  const mem = newManager();
  const player = fakePlayer({
    getCurrentTime: () => 0,
    queue: [],
    previousTracks: [],
    loop: false,
    paused: false,
    pause: { heldBy: null, userPaused: false },
  });
  const base: QueuedTrack = { title: "Test", pageUrl: "https://example.org/a.mp3", requestKey: "https://example.org/a.mp3", duration: 127, platform: "direct" };

  for (const thumbnail of [null, undefined, "", "https://example.org/t.jpg"]) {
    const container = await mem.createNowPlayingContainer(player, { ...base, thumbnail });
    // toJSON이 실제 전송 시 도는 검증. 썸네일이 없어도 여기서 던지지 않는다
    const json = container.toJSON();
    assert.ok(JSON.stringify(json).includes("Test"), `제목이 담겨야 한다 (thumbnail=${thumbnail})`);
  }
});

test("그림이 없는 곡은 음표 썸네일: 패널 메시지에 한 번만 올리고(5초 갱신마다 다시 올리지 않는다) 그림이 있는 곡으로 바뀌면 뗀다", async () => {
  const mem = newManager();
  const player = fakePlayer({ guild: { id: "g-art" }, getCurrentTime: () => 0, queue: [], previousTracks: [], loop: false, paused: false, pause: { heldBy: null, userPaused: false } });
  const bare: QueuedTrack = { title: "파일", pageUrl: "https://example.org/a.mp3", requestKey: "https://example.org/a.mp3", duration: 127, platform: "direct", thumbnail: null };
  const art: QueuedTrack = { ...bare, title: "영상", thumbnail: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" };
  const shape = (payload: { files?: Array<{ name: string }>; attachments?: [] }) => [payload.files?.map((one) => one.name) ?? null, payload.attachments ?? null];

  const sent = await mem._playingPayload(player, bare, true);
  assert.deepEqual(shape(sent), [["no-art.png"], []], "새 패널: 올린다");
  assert.ok(JSON.stringify(sent.components[0].toJSON()).includes("attachment://no-art.png"));
  assert.deepEqual(shape(await mem._playingPayload(player, bare)), [null, null], "같은 패널의 갱신: 다시 올리지 않는다");
  const swapped = await mem._playingPayload(player, art);
  assert.deepEqual(shape(swapped), [null, []], "그림이 있는 곡: 뗀다");
  assert.ok(JSON.stringify(swapped.components[0].toJSON()).includes("https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg"), "그림은 큰 것으로(ui/discord-art)");
  assert.deepEqual(shape(await mem._playingPayload(player, bare)), [["no-art.png"], []], "다시 그림 없는 곡: 올린다");
});

test("직접 링크 곡의 파일 태그 그림: 첨부해 걸고 같은 그림이면 다시 올리지 않는다. 음표 → 그림 → 같은 그림 → 주소 그림 → 음표", async (t) => {
  const url = "https://files.test/panel-art.mp3";
  if (!(await remember(url))) return t.skip("ffmpeg로 픽스처를 만들 수 없음");
  const mem = newManager();
  const player = fakePlayer({ guild: { id: "g-file-art" }, getCurrentTime: () => 0, queue: [], previousTracks: [], loop: false, paused: false, pause: { heldBy: null, userPaused: false } });
  const bare: QueuedTrack = { title: "파일", pageUrl: "https://files.test/none.mp3", requestKey: "https://files.test/none.mp3", audioUrl: "https://files.test/none.mp3", duration: 127, platform: "direct", thumbnail: null };
  const tagged: QueuedTrack = { ...bare, title: "태그", pageUrl: url, requestKey: url, audioUrl: url };
  const video: QueuedTrack = { ...bare, title: "영상", thumbnail: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" };
  const shape = (payload: { files?: Array<{ name: string }>; attachments?: [] }) => [payload.files?.map((one) => one.name) ?? null, payload.attachments ?? null];

  assert.deepEqual(shape(await mem._playingPayload(player, bare, true)), [["no-art.png"], []], "그림을 모르는 곡: 음표");
  const withArt = await mem._playingPayload(player, tagged);
  assert.deepEqual(shape(withArt), [["art.jpg"], []], "파일 태그 그림으로 바꿔 올린다");
  assert.ok(JSON.stringify(withArt.components[0].toJSON()).includes("attachment://art.jpg"));
  assert.deepEqual(shape(await mem._playingPayload(player, tagged)), [null, null], "같은 그림: 다시 올리지 않는다");
  assert.deepEqual(shape(await mem._playingPayload(player, video)), [null, []], "주소로 거는 그림: 뗀다");
  assert.deepEqual(shape(await mem._playingPayload(player, bare)), [["no-art.png"], []], "다시 음표");
});

test("now-playing 컨테이너: 제목 링크는 음원 파일이 아니라 보여 줄 링크(pageUrl)다", async () => {
  const mem = newManager();
  const player = fakePlayer({ getCurrentTime: () => 0, queue: [], previousTracks: [], loop: false, paused: false, pause: { heldBy: null, userPaused: false } });
  const track: QueuedTrack = { title: "주제가", duration: 90, platform: "anisongdb", pageUrl: "https://anilist.co/anime/1", requestKey: "amq:1", audioUrl: "https://nawdist.animemusicquiz.com/a.mp3" };

  const json = JSON.stringify((await mem.createNowPlayingContainer(player, track)).toJSON());
  assert.ok(json.includes("[주제가](https://anilist.co/anime/1)"));
  assert.ok(!json.includes("nawdist"));
});

// ── 끝난 패널 ──
// 부르는 곳이 현재 곡을 먼저 비우므로, 버튼 끄기는 곡 정보 없이도 돌아야 한다.

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
    pause: { heldBy: null, userPaused: false },
    currentTrack: null,
    ...over,
  });
}
// 컨테이너 JSON 에서 보는 필드
type Json = { components: Array<{ type: number; components?: Array<{ disabled?: boolean; custom_id?: string }>; accessory?: { media: { url: string } } }> };
const shape = (json: Json) => json.components.map((c) => c.type);
const buttonsOf = (json: Json) => json.components.filter((c) => c.type === 1).flatMap((row) => row.components ?? []);
// 빌더를 JSON 으로
const jsonOf = (builder: { toJSON(): unknown }) => builder.toJSON() as Json;

// 대시보드 주소를 정해 두고 부른다. 주소에 따라 링크가 달라지는 테스트는 값을 정해 설정 기본값에 기대지 않는다
async function withDashboardUrl<T>(url: string, run: () => Promise<T>) {
  const saved = config.dashboard.url;
  config.dashboard.url = url;
  try {
    return await run();
  } finally {
    config.dashboard.url = saved;
  }
}

test("종료 모양: 재생 화면과 구성이 같고, 자동재생만 눌리고, 썸네일은 첨부한 투명 이미지다", async () => {
  const mem = newManager();
  const player = panelPlayer();
  const { playing, components, files } = await withDashboardUrl("https://music.example.com", async () => ({
    playing: jsonOf(await mem.createNowPlayingContainer(player, { title: "곡", pageUrl: "https://example.org/a", requestKey: "https://example.org/a", duration: 100, platform: "youtube", thumbnail: "https://example.org/t.jpg" })),
    ...(await mem.createIdleContainer({ reason: "stop" })),
  }));
  const idle = jsonOf(components[0]);

  assert.deepEqual(shape(idle), shape(playing));
  assert.equal(buttonsOf(idle).length, buttonsOf(playing).length);
  // 자동재생만 살린다. 끝난 패널에서 다시 틀 수 있는 유일한 길이다. 나머지는 대기열 버튼까지 꺼진다.
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

// 기본값 localhost, 사설 주소는 다른 사람이 열 수 없다
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
});

test("재생이 끝나면 현재 곡을 이미 비웠어도 패널을 종료 모양으로 바꾼다. 종료 메시지는 전용 채널 밖에서만", async () => {
  try {
    const cases: Array<[botChannel: string | null, expectNotice: boolean]> = [
      ["chan-1", false],
      [null, true],
    ];
    for (const [botChannel, expectNotice] of cases) {
      tempStore.setGuild("g1", { botChannel });
      const mem = newManager();
      // 패널을 고친 내용. 여기서 보는 필드만
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

test("끝 안내는 다 틀었거나 끊겼을 때만(끊김은 그 까닭으로). 사람이 멈추거나 내보낸 것은 보내지 않는다", async () => {
  const cases: Array<[reason: string, cause: string | undefined, notice: string | null]> = [
    ["queue-end", undefined, "재생이 끝났어요"],
    ["stop", "stop", null],
    ["leave", "leave", null],
    ["disconnected", "stop", null],
    ["disconnected", "alone-timeout", "쉬러 갔어요"],
    ["disconnected", "kicked", "내보냈어요"],
    ["disconnected", "operator-leave", "봇 운영자가"],
    ["disconnected", "voice-lost", "다시 연결하지 못했어요"],
    ["disconnected", "channel-gone", "채널이 사라졌어요"],
    ["stop", "fault", "반복되어"],
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

test("패널을 새로 올리는데 기억해 둔 웹훅이 지워졌으면(10015) 기억을 지우고 새 웹훅으로 한 번 더 보낸다", async () => {
  const mem = newManager();
  const sent: string[] = [];
  const stale = { send: async () => Promise.reject(Object.assign(new Error("Unknown Webhook"), { code: 10015 })), destroy: () => sent.push("stale-destroyed") };
  mem.webhookCache.set("c1", fake<WebhookClient>(stale));
  const fresh = { id: "w2", token: "t2", name: "Now Playing", owner: { id: "bot" }, isIncoming: () => true };
  const channel = fake<GuildTextBasedChannel>({
    id: "c1",
    fetchWebhooks: async () => new Collection(),
    createWebhook: async () => fresh,
    send: async () => assert.fail("웹훅이 있으면 채널로 보내지 않는다"),
  });
  const realSend = WebhookClient.prototype.send;
  WebhookClient.prototype.send = async function () {
    sent.push("fresh");
    return fake<Awaited<ReturnType<typeof realSend>>>({ id: "m-new" });
  };
  try {
    const { message } = await mem._sendPanel(channel, { components: [], flags: MessageFlags.IsComponentsV2 });
    assert.equal(message.id, "m-new");
  } finally {
    WebhookClient.prototype.send = realSend;
    mem.deleteWebhookCache("c1");
  }
  assert.deepEqual(sent, ["stale-destroyed", "fresh"]);
});

test("24/7 자리에서 기다리는 끝난 패널은 나갈 시각 대신 자리에서 기다린다고 적는다", async () => {
  const mem = newManager();
  const json = JSON.stringify((await mem.createIdleContainer({ reason: "queue-end", leavesAt: null, staying: true })).components[0].toJSON());
  assert.match(json, /상주 모드라 나가지 않고 다음 곡을 기다려요/);
  assert.doesNotMatch(json, /쉬러 갈게요/);
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
    [["error", "진행 막대 갱신 중 예외가 발생해 현재 곡의 진행 막대 갱신 중단(서버): Error: boom"]],
  );
});

// 디스코드가 5초 넘게 걸려도 두 갱신이 겹치지 않는다
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

test("진행 막대: 멈춰 있으면 고치지 않고 쉬다가 소리가 다시 나면 다시 건다. 오류로 멈춘 갱신은 되살리지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mem = newManager();
  const edits: unknown[] = [];
  const sound = { paused: true };
  const player = fakePlayer({
    guild: { id: "g1", name: "서버" },
    currentTrack: { title: "곡" },
    nowPlayingMessage: { id: "m1", edit: async (p: unknown) => void edits.push(p) },
    get paused() {
      return sound.paused;
    },
  });
  mem._playingPayload = async () => ({ components: [], flags: 0 }) as unknown as Awaited<ReturnType<typeof mem._playingPayload>>;
  let ticks = 0;
  mem._tickProgress = async () => void ticks++;
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  mem.startProgressUpdate(player);
  t.mock.timers.tick(5_000);
  await flush();
  assert.equal(ticks, 0, "멈춘 동안은 고치지 않는다");
  assert.equal(mem.progressTimers.has("g1"), false);
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(ticks, 0, "다시 걸지도 않는다");

  await mem.updatePlaying(player);
  assert.equal(mem.progressTimers.has("g1"), false, "아직 멈춰 있으면 다시 걸지 않는다");

  sound.paused = false;
  await mem.updatePlaying(player);
  assert.equal(edits.length, 2);
  t.mock.timers.tick(5_000);
  await flush();
  assert.equal(ticks, 1, "소리가 다시 나면 5초 갱신을 다시 건다");

  mem.stopProgressUpdate("g1");
  await mem.updatePlaying(player);
  assert.equal(mem.progressTimers.has("g1"), false, "멈춤 때문에 쉰 것이 아니면 되살리지 않는다");
});

test("멈춤: 상태 줄은 억제 사유를 먼저, 그 사이 사람이 일시정지했으면 일시정지를 덧붙이고, 버튼은 사람의 멈춤을 따른다", async () => {
  const mem = newManager();
  const track = { title: "곡", pageUrl: "https://example.org/a", requestKey: "https://example.org/a", duration: 100, platform: "youtube" };
  const look = async (pause: { heldBy: string | null; userPaused: boolean }) => {
    const json = jsonOf(await mem.createNowPlayingContainer(panelPlayer({ paused: Boolean(pause.heldBy) || pause.userPaused, pause }), track));
    const pauseButton = buttonsOf(json).find((b) => b.custom_id?.startsWith("panel:pause:")) as { emoji?: unknown } | undefined;
    return { text: JSON.stringify(json), emoji: JSON.stringify(pauseButton?.emoji) };
  };
  const heldOnly = await look({ heldBy: "mute", userPaused: false });
  assert.match(heldOnly.text, /음소거됨/);
  assert.doesNotMatch(heldOnly.text, /음소거됨 • 일시정지/);
  const heldAndUser = await look({ heldBy: "mute", userPaused: true });
  assert.match(heldAndUser.text, /음소거됨 • 일시정지/);
  const userOnly = await look({ heldBy: null, userPaused: true });
  assert.match(userOnly.text, /일시정지/);
  assert.notEqual(heldOnly.emoji, heldAndUser.emoji, "억제만이면 일시정지 버튼(누르면 일시정지한다), 사람이 멈췄으면 재생 버튼");
  assert.equal(heldAndUser.emoji, userOnly.emoji);
});

// 풀기 전에는 끝나지 않는 promise. 느린 썸네일 확인, REST 를 흉내 낸다
function held() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("재생 패널 그리기: 서버마다 한 번에 하나. 그리는 중에 온 고치기는 끝난 뒤 지금 상태로 한 번만 다시 그린다", async () => {
  const mem = newManager();
  const gates: Array<ReturnType<typeof held>> = [];
  let inFlight = 0;
  let most = 0;
  const edits: string[] = [];
  const track = { title: "곡" };
  const state = { loop: "off" };
  const player = panelPlayer({
    currentTrack: track,
    nowPlayingMessage: { id: "m1" },
    nowPlayingWebhook: {
      editMessage: async (_id: string, payload: { loop: string }) => {
        inFlight++;
        most = Math.max(most, inFlight);
        const gate = held();
        gates.push(gate);
        await gate.promise;
        inFlight--;
        edits.push(payload.loop);
      },
    },
  });
  mem._playingPayload = async () => ({ loop: state.loop }) as unknown as Awaited<ReturnType<typeof mem._playingPayload>>;

  const first = mem.updatePlaying(player);
  await settle();
  assert.equal(gates.length, 1, "첫 그리기가 REST 에 걸려 있다");
  state.loop = "queue";
  const more = [mem.updatePlaying(player), mem.updatePlaying(player), mem.updatePlaying(player)];
  await settle();
  assert.equal(gates.length, 1, "그리는 중에는 둘째를 보내지 않는다");
  gates[0].release();
  await settle();
  assert.equal(gates.length, 2, "끝난 뒤 한 번 다시 그린다");
  gates[1].release();
  await Promise.all([first, ...more]);
  assert.deepEqual(edits, ["off", "queue"], "마지막은 지금 상태");
  assert.equal(most, 1);
});

test("재생 패널 그리기: 페이로드를 만든 사이 정리됐거나, 곡이 없거나 바뀌었거나, 패널이 바뀌었거나, 다시 올리는 중이면 보내지 않고 붙인 썸네일 기록을 지운다", async () => {
  const cases: Array<[string, (p: Record<string, unknown>, mem: NowPlayingPanel) => void]> = [
    ["정리", (p) => (p.lifecycle = { disposed: true })],
    ["곡 없음", (p) => (p.currentTrack = null)],
    ["곡 바뀜", (p) => (p.currentTrack = { title: "다른 곡" })],
    ["패널 바뀜", (p) => (p.nowPlayingMessage = { id: "m2" })],
    ["다시 올리는 중", (_p, mem) => mem.reposting.add("g1")],
  ];
  for (const [name, change] of cases) {
    const mem = newManager();
    const gate = held();
    const edits: unknown[] = [];
    const player = panelPlayer({
      lifecycle: { disposed: false },
      currentTrack: { title: "곡" },
      nowPlayingMessage: { id: "m1" },
      nowPlayingWebhook: { editMessage: async (...args: unknown[]) => void edits.push(args) },
    });
    mem._playingPayload = async () => {
      await gate.promise;
      mem.attachedArt.set("g1", "no-art");
      return { components: [] } as unknown as Awaited<ReturnType<typeof mem._playingPayload>>;
    };
    const drawing = mem.updatePlaying(player);
    await settle();
    change(player as unknown as Record<string, unknown>, mem);
    gate.release();
    await drawing;
    assert.deepEqual(edits, [], name);
    assert.equal(mem.attachedArt.has("g1"), false, `${name}: 보내지 않은 첨부를 붙였다고 기억하지 않는다`);
  }
});

test("끝난 패널: 그리는 사이 새 곡과 패널이 생기면(정지 직후의 /play, 상주 모드) 지금 곡과 패널 참조를 비우지 않는다", async () => {
  const mem = newManager();
  const gate = held();
  const player = panelPlayer({
    currentTrack: null,
    nowPlayingMessage: { id: "old" },
    nowPlayingWebhook: { editMessage: async () => gate.promise },
    textChannel: { id: "chan-1", send: async () => {} },
  });
  const drawing = mem.drawEndedPanel(player, { reason: "stop" });
  await settle();
  const next = { title: "새 곡" };
  const fresh = { id: "new" };
  const freshWebhook = { editMessage: async () => {} };
  Object.assign(player, { currentTrack: next, nowPlayingMessage: fresh, nowPlayingWebhook: freshWebhook });
  gate.release();
  await drawing;
  assert.equal(player.currentTrack, next);
  assert.equal(player.nowPlayingMessage, fresh);
  assert.equal(player.nowPlayingWebhook, freshWebhook);

  const plain = panelPlayer({ currentTrack: null, nowPlayingMessage: { id: "old" }, nowPlayingWebhook: { editMessage: async () => {} }, textChannel: { id: "chan-1", send: async () => {} } });
  await newManager().drawEndedPanel(plain, { reason: "stop" });
  assert.equal(plain.nowPlayingMessage, null, "바뀐 것이 없으면 지금처럼 놓는다");
  assert.equal(plain.nowPlayingWebhook, null);
});

test("재생 패널 그리기: 그리는 사이 같은 서버의 새 플레이어가 고치기를 보내면 끝난 뒤 새 플레이어를 그린다", async () => {
  const mem = newManager();
  const gate = held();
  const drawn: string[] = [];
  const of = (name: string, wait: boolean) =>
    panelPlayer({
      currentTrack: { title: name },
      nowPlayingMessage: { id: name },
      nowPlayingWebhook: {
        editMessage: async () => {
          if (wait) await gate.promise;
          drawn.push(name);
        },
      },
    });
  mem._playingPayload = async () => ({ components: [] }) as unknown as Awaited<ReturnType<typeof mem._playingPayload>>;
  const old = mem.updatePlaying(of("옛", true));
  await settle();
  const fresh = mem.updatePlaying(of("새", false));
  gate.release();
  await Promise.all([old, fresh]);
  assert.deepEqual(drawn, ["옛", "새"]);
});
