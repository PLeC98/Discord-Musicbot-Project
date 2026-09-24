// 자동재생 미리 뽑기(B-50) — src/player/Player.ts · src/player/trackState.ts
//
// 곡이 끝난 뒤에야 검색을 시작하면 그만큼 소리가 빈다. 곡이 시작될 때 다음 곡을 미리 대기열에 둬야
// QueueWarmer가 평소처럼 받아 두고 전환이 즉시가 된다.
//
// play()가 이것을 await 하지 않고 부르므로(재생 시작을 늦추면 안 된다), 고르는 동안 대기열이
// 변할 수 있다. 그 사이 사용자가 곡을 넣었으면 미리 뽑기는 취소해야 하고, 겹쳐 불려도 한 곡만 들어가야 한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MusicPlayer } from "../../src/player/Player.ts";
import * as trackState from "../../src/player/trackState.ts";
import panelEvents from "../helpers/panelEvents.ts";
import { fakePlayer } from "../helpers/fake.ts";
import * as playerEvents from "../../src/player/events.ts";
import playerNotices from "../../src/ui/playerNotices.js";
import * as pool from "../../src/autoplay/pool.ts";
import * as sources from "../../src/autoplay/sources/index.ts";
import * as route from "../../src/autoplay/route.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import type { Loop } from "../../src/player/trackState.ts";
import type { GenreSource } from "../../src/config/genres.ts";

const { recordPanel } = panelEvents;

// 플레이어가 알린 일은 진짜 문장 보내기(ui/playerNotices)로 채널에 간다. 조립(main.js)이 거는 것과 같다
playerEvents.on("notice", playerNotices.sendNotice);

const ensureAutoplayNext = MusicPlayer.prototype.ensureAutoplayNext;
const setAutoplay = MusicPlayer.prototype.setAutoplay;

const track = (title: string, extra: Partial<QueuedTrack> = {}): QueuedTrack => ({ title, duration: 0, platform: "youtube", pageUrl: `https://y/${title}`, requestKey: `https://y/${title}`, ...extra });
const user = (title: string) => track(title);
const auto = (title: string) => track(title, { autoplay: true });
const titles = (arr: QueuedTrack[]) => arr.map((t) => t.title);

// 가짜 플레이어에 플레이어의 메서드를 빌려 부른다
const asPlayer = fakePlayer;

type Options = { autoplay?: string | false; current?: QueuedTrack | null; queue?: QueuedTrack[]; loop?: Loop; pick?: (this: { queue: QueuedTrack[] }) => Promise<QueuedTrack | null>; prefetch?: number };

function makePlayer({ autoplay = "팝", current = user("현재곡"), queue = [], loop = false, pick, prefetch = 1 }: Options = {}) {
  const calls = { picks: 0 };
  return asPlayer({
    calls,
    autoplay,
    loop,
    queue,
    currentTrack: current,
    previousTracks: [],
    guild: { id: "g1" },
    scheduleStatePersist() {},
    // 프로토타입을 잇지 않는 목이므로, 코드가 부르는 헬퍼는 여기 옮겨 붙인다
    _canPrefetchAutoplay: MusicPlayer.prototype._canPrefetchAutoplay,
    // 실제 config/genres.yaml 을 읽으면 운영자가 값을 바꿀 때마다 테스트가 깨진다
    _autoplayConfig: () => ({ prefetchCount: prefetch }),
    _prefetchGapMs: 0, // 뽑기 사이 쉬는 시간 — 테스트에서는 기다릴 이유가 없다
    async pickAutoplayTrack() {
      calls.picks++;
      return pick ? await pick.call(this) : auto(`자동${calls.picks}`);
    },
  });
}

// ── trackState: 자동재생 곡의 자리 ────────────────────────────────────────

test("사용자 곡은 미리 뽑아 둔 자동재생 곡 앞에 선다", () => {
  const p = { queue: [user("내곡1"), auto("자동")] };
  trackState.enqueueAheadOfAutoplay(p, [user("내곡2")]);
  assert.deepEqual(titles(p.queue), ["내곡1", "내곡2", "자동"]);
});

test("자동재생 곡이 없으면 평소대로 뒤에 붙인다", () => {
  const p = { queue: [user("내곡1")] };
  trackState.enqueueAheadOfAutoplay(p, [user("내곡2")]);
  assert.deepEqual(titles(p.queue), ["내곡1", "내곡2"]);
});

test("정리는 자동재생 곡만 — 사용자 곡은 남는다", () => {
  const p = { queue: [auto("자동1"), user("내곡"), auto("자동2")] };
  assert.equal(trackState.dropAutoplay(p), 2);
  assert.deepEqual(titles(p.queue), ["내곡"]);
});

// ── 미리 뽑기 조건 ────────────────────────────────────────────────────────

test("곡이 돌고 대기열이 비어 있으면 한 곡을 미리 넣는다", async () => {
  const p = makePlayer();
  assert.equal(await ensureAutoplayNext.call(p), true);
  assert.deepEqual(titles(p.queue), ["자동1"]);
  assert.equal(p.queue[0].autoplay, true, "표시가 붙어야 대기열 표시·정리에서 가른다");
});

test("미리 뽑지 않는 경우: 대기열이 차 있음 · 현재곡 없음 · 한곡 반복 · 자동재생 꺼짐", async () => {
  const cases = [makePlayer({ queue: [user("대기중")] }), makePlayer({ current: null }), makePlayer({ loop: "track" }), makePlayer({ autoplay: false })];

  for (const p of cases) {
    assert.equal(await ensureAutoplayNext.call(p), false);
    assert.equal(p.calls.picks, 0, "조건을 먼저 보고 검색을 아끼다");
  }
});

// 미리 뽑을 곡 수는 config/genres.yaml의 prefetchCount가 정한다(장르가 덮어쓴다).
// 기본 1곡만 덮으면 값을 키워도 한 곡만 들어가는 회귀를 놓친다.
// 회귀 대상: 한 번 불릴 때 한 곡만 넣었다. 부르는 쪽은 곡이 시작할 때 한 번 부를 뿐이라,
// prefetchCount 를 키워도 늘 한 곡 앞만 보였다.
// 뽑기 한 번에 유튜브 검색이 여러 번 나간다. 다섯 곡을 붙여 뽑으면 수십 번이 몇 초 안에 몰려
// 뒤이은 내려받기가 403을 맞는다. 급한 것은 첫 곡뿐이므로 나머지는 사이를 둔다.
test("둘째 곡부터는 쉬었다 뽑는다 — 유튜브를 몰아치지 않는다", async () => {
  const slept: number[] = [];
  const p = makePlayer({ prefetch: 3 });
  p._prefetchGapMs = 5;

  const realTimeout = global.setTimeout;
  global.setTimeout = ((fn: () => void, ms: number) => {
    slept.push(ms);
    return realTimeout(fn, 0);
  }) as unknown as typeof setTimeout;
  try {
    await ensureAutoplayNext.call(p);
  } finally {
    global.setTimeout = realTimeout;
  }

  assert.equal(p.queue.length, 3);
  assert.deepEqual(slept, [5, 5], "첫 곡은 바로, 나머지 둘은 쉬었다가");
});

test("prefetchCount만큼 채운다 — 한 번 불려도 끝까지", async () => {
  const p = makePlayer({ prefetch: 3 });

  assert.equal(await ensureAutoplayNext.call(p), true);
  assert.deepEqual(titles(p.queue), ["자동1", "자동2", "자동3"], "한 번에 세 곡까지 채우고 멈춘다");

  assert.equal(await ensureAutoplayNext.call(p), false, "다 찼으면 더 넣지 않는다");
  assert.equal(p.queue.length, 3);
});

// ── 고르는 동안 대기열이 변하는 경우 ──────────────────────────────────────

test("고르는 사이 사용자가 곡을 넣으면 미리 뽑기를 취소한다", async () => {
  const p = makePlayer({
    async pick() {
      this.queue.push(user("방금 넣은 곡")); // 검색이 도는 동안 벌어지는 일
      return auto("늦게 도착");
    },
  });

  assert.equal(await ensureAutoplayNext.call(p), false);
  assert.deepEqual(titles(p.queue), ["방금 넣은 곡"], "사용자 곡을 밀어내지 않는다");
});

test("겹쳐 불려도 한 곡만 들어간다", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const p = makePlayer({
    async pick() {
      await gate;
      return auto("자동");
    },
  });

  const first = ensureAutoplayNext.call(p);
  const second = ensureAutoplayNext.call(p); // play()가 연달아 부르는 상황
  release();

  assert.deepEqual(await Promise.all([first, second]), [true, false]);
  assert.equal(p.calls.picks, 1);
  assert.deepEqual(titles(p.queue), ["자동"]);
});

// ── 지금 바로 틀기 ────────────────────────────────────────────────────────

const handleAutoplay = MusicPlayer.prototype.handleAutoplay;

function makeNowPlayer({ nowPlayingMessage = null }: { nowPlayingMessage?: { id: string } | null } = {}) {
  const calls = { sent: [] as string[] };
  const player = asPlayer({
    calls,
    autoplay: "팝",
    queue: [],
    currentTrack: null,
    previousTracks: [],
    nowPlayingMessage,
    guild: {
      id: "g1",
      members: { me: { user: { id: "bot", username: "봇" } } },
      client: {},
    },
    async pickAutoplayTrack() {
      return auto("첫곡");
    },
    async play() {},
    // 곡을 못 고르면 알리고 끈다 — 목이 프로토타입을 잇지 않으므로 옮겨 붙인다
    _giveUpAutoplay: MusicPlayer.prototype._giveUpAutoplay,
    setAutoplay: MusicPlayer.prototype.setAutoplay,
    scheduleStatePersist() {},
    textChannel: {
      async send(text: string) {
        calls.sent.push(text);
      },
    },
    panel: [] as string[],
  });
  player.panel = recordPanel({ player }); // 화면에 알린 것
  return player;
}

// 아무것도 틀지 않던 서버에서 /autoplay로 켜는 길 — 이 경로에는 고칠 패널이 없다.
test("첫 곡을 틀 때 패널이 없으면 새로 올린다", async () => {
  const p = makeNowPlayer();

  assert.equal(await handleAutoplay.call(p), true);
  assert.equal(p.currentTrack?.title, "첫곡");
  assert.deepEqual(p.panel, ["create:첫곡"], "빠뜨리면 소리만 나고 화면이 없다");
});

test("패널이 이미 있으면 고쳐 쓴다 — 새로 올리지 않는다", async () => {
  const p = makeNowPlayer({ nowPlayingMessage: { id: "m1" } });

  assert.equal(await handleAutoplay.call(p), true);
  assert.deepEqual(p.panel, ["update"]);
});

// 조용히 멈추면 무엇이 잘못됐는지 알 길이 없다. 아무거나 트는 것보다는 끄는 편이 낫다.
test("고를 곡이 없으면 끄고 알린다 — 아무거나 틀지 않는다", async () => {
  const p = makeNowPlayer();
  p.pickAutoplayTrack = async () => null;

  assert.equal(await handleAutoplay.call(p), false);
  assert.deepEqual(p.panel, []);

  assert.equal(p.autoplay, false, "자동재생이 꺼져야 한다");
  assert.equal(p.calls.sent.length, 1);
  assert.match(p.calls.sent[0], /팝/, "어느 장르에서 못 찾았는지 알려야 한다");
});

// ── 끄기·장르 변경 ────────────────────────────────────────────────────────

test("자동재생을 끄면 미리 뽑아 둔 곡만 빠진다", () => {
  const p = makePlayer({ queue: [user("내곡"), auto("자동")] });
  p.ensureAutoplayNext = async () => true;

  setAutoplay.call(p, false);

  assert.equal(p.autoplay, false);
  assert.deepEqual(titles(p.queue), ["내곡"]);
});

test("장르를 바꾸면 이전 장르로 뽑아 둔 곡을 버리고 다시 뽑는다", () => {
  const p = makePlayer({ autoplay: "팝", queue: [auto("팝곡")] });
  let refetched = 0;
  p.ensureAutoplayNext = async () => {
    refetched++;
    return true;
  };

  setAutoplay.call(p, "재즈");

  assert.equal(p.autoplay, "재즈");
  assert.deepEqual(titles(p.queue), []);
  assert.equal(refetched, 1);
});

// ── 뽑을 때의 거르기 ──────────────────────────────────────────────────────

// 회귀 대상: 제목은 소문자로 낮춰 견주면서 차단어는 그대로 뒀다. 그래서 config에 적혀 있던
// "Playlist" 같은 대문자 섞인 차단어가 아무것도 못 거르면서 걸러지는 척했다.
//
// 규칙 자체는 autoplayFilter가 갖고 있다(test/autoplay/autoplayFilter.test.ts). 여기서 보는 것은
// 설정에서 뽑기까지 그 규칙이 실제로 이어지는가다 — 소스에서 후보가 와서 필터를 지나는 길.
test("설정의 차단어가 뽑기까지 이어진다 — 대소문자를 가리지 않는다", async () => {
  // 키워드 소스가 부르는 유튜브 검색만 가짜로. 후보가 필터를 지나는 길은 진짜다
  const search = async () => [
    { id: "1", title: "Best Playlist Ever", audioUrl: "https://y/1", duration: 200 },
    { id: "2", title: "그냥 좋은 노래", audioUrl: "https://y/2", duration: 200 },
  ];

  try {
    const p = asPlayer({
      autoplay: "팝",
      previousTracks: [],
      queue: [],
      currentTrack: null,
      guild: { members: { me: { user: { id: "bot" } } } },
      _autoplayConfig: () => ({
        sources: [{ type: "keyword", keywords: ["아무거나"] }],
        minDurationSec: 0,
        maxDurationSec: null,
        blockedKeywords: ["Playlist"],
      }),
      pickAutoplayTrack: MusicPlayer.prototype.pickAutoplayTrack,
      // AI 보조는 운영 설정(config/ai.yaml)을 읽어 진짜로 부른다. 여기서는 규칙만 본다
      autoplayDeps: { ...route.REAL, fetch: (source: GenreSource) => sources.fetchFrom(source, { search }), assist: { filter: async <T>(c: T[]) => c, accepts: async () => true } },
    });

    // 후보가 둘인데 하나가 걸리므로 남는 것은 하나뿐이다.
    // 풀은 같은 곡을 두 번 내주지 않으므로 회마다 비우고 새로 받는다.
    for (let i = 0; i < 8; i++) {
      pool._reset();
      const picked = await p.pickAutoplayTrack();
      assert.equal(picked?.audioUrl, "https://y/2", "대문자로 적은 차단어도 걸러야 한다");
    }
  } finally {
    pool._reset();
  }
});
