// Player.play() 의 지금 동작을 고정한다(구조 리팩터링 0단계).
//
// 옳고 그름을 따지는 테스트가 아니다. 리팩터링이 play() 를 다섯 함수로 나눌 때 **무엇이 바뀌었는지**
// 드러나게 하려는 것이다. 여기 적힌 동작이 이상해 보여도 고치지 말고, 고칠 때는 이 테스트를 같이 고친다.
//
// 분기마다 셋을 본다. 어떤 ffmpeg 를 무엇으로 실행했나, 오디오 캐시에 무엇을 적었나, 끝난 뒤 플레이어 상태.

import * as h from "../helpers/player-harness.ts";
import sink from "../../src/infra/log/sink.ts";
import logger from "../../src/infra/log/logger.ts";
import * as audioCache from "../../src/store/audio-cache.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AudioSplicer } from "../../src/media/audio-splicer.ts";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { md5 } from "../../src/rules/audio-key-of.ts";
import { recordPanel } from "../helpers/panel-events.ts";
import type { FakeChild } from "../helpers/player-harness.ts";
import type { Player } from "../../src/player/player.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import type { Segments, SkipSegment } from "../../src/sources/sponsor-block.ts";

const { calls, behavior } = h;

beforeEach(() => h.reset());

const tracks = await import("../helpers/tracks.ts");

const yt = tracks.youtube;
const argsOf = (child: FakeChild) => child.args.join(" ");

// SponsorBlock 답. 구간만 테스트가 정한다
const segments = (skipSegments: SkipSegment[]): Segments => ({ skipSegments, highlightAt: null, source: "live" });

// 캐시 전환을 물으면 곡을 적고 전환을 예약했다고 답하는 플레이어
class SwitchAsked extends h.Player {
  asked: QueuedTrack[] = [];
  _planCacheSwitch(_splicer: unknown, track: QueuedTrack) {
    this.asked.push(track);
    return true;
  }
}

// 한 테스트가 끝나면 타이머를 남기지 않는다
async function playOnce(player: Player, seekMs = 0) {
  try {
    return await player.play(seekMs);
  } finally {
    h.dispose(player);
  }
}

// ── 캐시에서 튼다 ──────────────────────────────────────────────────────

test("캐시 파일이 있으면 스트림을 받지 않고 파일로 튼다", async () => {
  const track = yt("aaaaaaaaaaa");
  const file = h.seedCache("yt:aaaaaaaaaaa", track, { durationSec: 201 });
  const p = h.makePlayer();
  p.currentTrack = track;
  behavior.stream = () => assert.fail("캐시가 있으면 스트림을 묻지 않는다");

  const r = await playOnce(p);

  assert.equal(r.ok, true);
  assert.equal(calls.spawns.length, 1);
  assert.equal(calls.spawns[0].label, "playback");
  assert.match(argsOf(calls.spawns[0]), new RegExp(`-i ${file.replace(/[\\.]/g, "\\$&")}`));
  assert.equal(calls.downloads.length, 0, "이미 있으니 다운로드하지 않는다");
  assert.equal(calls.fetches.length, 0);
  assert.equal(h.fakeAudioOf(p).played.length, 1);
  assert.equal(calls.resources[0].input, calls.spawns[0].stdout, "파일 분기는 스플라이서를 끼우지 않는다");
  // 캐시에 적힌 길이는 캐시된 음원을 잰 값이다. 보이던 값(180)과 2초 넘게 다르니 표시도 바꾼다
  assert.equal(p.currentTrack.duration, 201);
  assert.equal(p.playback?.lengthMs, 201_000, "곡 끝 판정은 이 음원의 길이를 본다");
  assert.equal(p.lifecycle.phase, "playing");
});

test("재생 단계: 틀지 못하면 idle 로 돌아오고, 정지하면 disposed", async () => {
  const p = h.makePlayer();
  const r = await playOnce(p); // 대기열이 비었다
  assert.equal(r.ok, false);
  assert.equal(p.lifecycle.phase, "idle");
  assert.equal(p.isPlayStarting, false);

  await p.dispose({ reason: "정지", session: "remove" });
  assert.equal(p.lifecycle.phase, "disposed");
});

test("캐시에서 틀어도 오디오 캐시에 재생을 적는다", async () => {
  const track = yt("bbbbbbbbbbb");
  h.seedCache("yt:bbbbbbbbbbb", track);
  const p = h.makePlayer();
  p.currentTrack = track;

  await playOnce(p);

  assert.equal(h.audioRow("yt:bbbbbbbbbbb")?.play_count, 1);
  const row = h.lookupRow(track.requestKey);
  assert.equal(row?.audio_url, "https://www.youtube.com/watch?v=bbbbbbbbbbb");
  assert.equal(row?.title_verified, 0, "캐시 분기는 영상 제목을 못 받아 확인 안 됨으로 적는다");
});

test("같은 곡을 이어 틀면(위치 이동 · 구간 건너뛰기 · 복구) 재생 횟수를 세지 않는다. 새로 틀면 센다", async () => {
  const track = yt("ccccccccccc");
  h.seedCache("yt:ccccccccccc", track);
  const p = h.makePlayer();
  p.currentTrack = track;
  try {
    await p.play(0);
    await p.seek(30_000, "highlight");
    await p.seek(30_000, "dashboard");
    await p.play(60_000, { continued: true });
    assert.equal(h.audioRow("yt:ccccccccccc")?.play_count, 1, "처음 한 번만");
    await p.play(0); // 한곡 반복 · 다음 곡처럼 새로 튼다
    assert.equal(h.audioRow("yt:ccccccccccc")?.play_count, 2);
  } finally {
    h.dispose(p);
  }
});

test("캐시 파일은 키 경로에서만 찾는다. 다른 경로의 파일은 쓰지 않고 스트림으로 튼다", async () => {
  const track = yt("ccccccccccc");
  const other = h.writeCacheFile("yt:다른-자리");
  const p = h.makePlayer();
  p.currentTrack = track;
  behavior.stream = () => ({ url: "https://media.test/cc", duration: 100 });

  await playOnce(p);

  assert.equal(calls.spawns[0].label, "stream");
  assert.ok(!calls.spawns[0].args.includes(other));
});

test("캐시로 튼 곡은 퇴거에서 보호한다", async () => {
  const track = yt("ddddddddddd");
  h.seedCache("yt:ddddddddddd", track);
  const p = h.makePlayer();
  p.currentTrack = track;

  await playOnce(p);

  assert.equal(p._protectedAudioKey, "yt:ddddddddddd");
  assert.ok(audioCache._liveKeys().has("yt:ddddddddddd"));
  p.releaseAudioProtection();
});

// ── 스트림으로 튼다 ────────────────────────────────────────────────────

test("캐시가 없으면 스트림을 파이프로 먹이고 뒤에서 캐시를 다운로드한다", async () => {
  const track = yt("eeeeeeeeeee");
  const p = h.makePlayer();
  p.currentTrack = track;
  behavior.stream = () => ({ url: "https://media.test/a", duration: 190, platform: "youtube", httpHeaders: { "User-Agent": "yt-dlp" } });

  const r = await playOnce(p);

  assert.equal(r.ok, true);
  assert.equal(calls.fetches.length, 1, "길이를 모르는 주소는 단일 GET");
  assert.equal(calls.fetches[0].url, "https://media.test/a");
  assert.deepEqual(calls.fetches[0].init.headers, { "User-Agent": "yt-dlp" }, "yt-dlp 가 준 헤더를 그대로");
  assert.equal(calls.spawns.length, 1);
  assert.equal(calls.spawns[0].label, "stream");
  assert.ok(calls.spawns[0].args.includes("pipe:0"));
  assert.equal(calls.downloads.length, 1, "재생과 나란히 캐시를 다운로드한다");
  assert.ok(calls.resources[0].input instanceof AudioSplicer, "스트림 분기는 무지연 전환을 위해 스플라이서를 끼운다");
  assert.equal(p.currentTrack.duration, 180, "보이던 길이를 지킨다(스트림이 준 길이도 출처가 준 값이다)");
  assert.equal(p.playback?.lengthMs, 190_000, "곡 끝 판정은 트는 음원의 길이(스트림이 준 값)를 본다");
});

test("캐시 상한보다 긴 곡은 스트림으로만 틀고 캐시를 다운로드하지 않는다. 길이는 스트림이 알려 준 것을 본다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("lllllllllll");
  behavior.stream = () => ({ url: "https://media.test/long", duration: 2 * 3600 });

  const r = await playOnce(p);

  assert.equal(r.ok, true);
  assert.equal(calls.fetches.length, 1);
  assert.equal(calls.downloads.length, 0, "기본 상한 60분");
  assert.ok(calls.resources[0].input instanceof AudioSplicer, "다운로드 없이도 스트림 분기로 연다");
});

test("헤더를 안 준 스트림은 브라우저 User-Agent 로 받는다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("fffffffffff");
  behavior.stream = () => ({ url: "https://media.test/b", duration: 100 });

  await playOnce(p);

  assert.match(calls.fetches[0].init.headers["User-Agent"] ?? "", /Mozilla/);
});

test("전체 길이(clen)를 아는 주소는 청크로 나눠 받는다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("ggggggggggg");
  behavior.stream = () => ({ url: "https://rr1.googlevideo.com/videoplayback?clen=4096&x=1", duration: 100 });

  await playOnce(p);

  assert.equal(calls.fetches.length, 0);
  assert.equal(calls.chunked.length, 1);
  assert.equal(calls.chunked[0].totalBytes, 4096);
});

// 방송이 끝나고 다시보기를 다 만들기 전(post_live)의 유튜브 소리는 조각 목록뿐이다. 주소 하나로 열면 첫 조각(2초)만 틀고 끝난다
test("조각 목록으로만 주는 소리는 위치가 든 조각부터 받아 파이프로 흘리고, 조각 안의 나머지만 -ss 로 건너뛴다", async () => {
  const fragments = { base: "https://rr1.googlevideo.com/videoplayback?live=1&x=1", count: 10 };
  const p = h.makePlayer();
  p.currentTrack = yt("pppppppppp1", { duration: 20 });
  behavior.stream = () => ({ url: fragments.base, duration: 20, protocol: "http_dash_segments", liveStatus: null, fragments });

  await playOnce(p, 5_000);

  assert.equal(calls.fragments.length, 1);
  assert.deepEqual({ ...calls.fragments[0], headers: undefined }, { fragments, durationMs: 20_000, startMs: 5_000, headers: undefined });
  const args = argsOf(calls.spawns[0]);
  assert.ok(args.includes("-i pipe:0"), args);
  assert.ok(args.includes("-ss 1.000"), `조각 하나가 2초라 5초는 셋째 조각(4초)부터 받고 1초를 건너뛴다: ${args}`);
  assert.equal(p.playback?.input?.kind, "조각");
  assert.equal(p.playback?.live, false);
});

// 유튜브는 앞 광고가 붙은 응답이면 광고가 끝날 때까지 본편 요청을 403 으로 막는다. yt-dlp 는 그 시각을 available_at 으로 준다
test("앞 광고로 막힌 스트림(403)은 광고가 끝나는 시각까지 기다렸다 한 번 더 연다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("ddddddddddd");
  behavior.stream = () => ({ url: "https://rr1.googlevideo.com/videoplayback?clen=4096&x=2", duration: 100, availableAt: Date.now() / 1000 + 0.2 });
  let opens = 0;
  behavior.chunked = () => {
    opens++;
    if (opens === 1) throw Object.assign(new Error("Range 요청 실패: HTTP 403"), { status: 403 });
  };
  behavior.download = () => Promise.reject(new Error("받기 실패")); // 캐시로 넘어가 가려지지 않게
  const started = Date.now();

  const r = await playOnce(p);

  assert.equal(r.ok, true);
  assert.equal(calls.chunked.length, 2, "곧바로 한 번, 기다린 뒤 한 번");
  assert.ok(Date.now() - started >= 150, "광고가 끝나는 시각까지 기다렸다");
  assert.equal(calls.downloads.length, 1);
});

test("앞 광고로 막힌 것이 아니면(시각 없음 · 지남 · 403 아님 · 60초 넘게 남음) 기다리지 않고 그대로 실패로 넘긴다", async () => {
  const soon = () => Date.now() / 1000 + 0.1;
  const cases = [
    { availableAt: null, status: 403 },
    { availableAt: Date.now() / 1000 - 5, status: 403 },
    { availableAt: soon(), status: 404 },
    { availableAt: Date.now() / 1000 + 120, status: 403 },
  ];
  for (const { availableAt, status } of cases) {
    h.reset();
    const p = h.makePlayer();
    p.currentTrack = yt("eeeeeeeeeee");
    behavior.stream = () => ({ url: "https://rr1.googlevideo.com/videoplayback?clen=4096&x=3", duration: 100, availableAt });
    behavior.chunked = () => {
      throw Object.assign(new Error(`Range 요청 실패: HTTP ${status}`), { status });
    };
    behavior.download = () => Promise.reject(new Error("받기도 실패"));

    const r = await playOnce(p);

    assert.equal(r.ok, false, JSON.stringify({ availableAt, status }));
    assert.equal(calls.chunked.length, 1, "다시 열지 않는다");
  }
});

test("앞 광고로 막힌 스트림은 길이를 모르는 주소(단일 GET)에서도 기다렸다 다시 연다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("fffffffffff");
  behavior.stream = () => ({ url: "https://media.test/ad", duration: 100, availableAt: Date.now() / 1000 + 0.1 });
  let gets = 0;
  behavior.fetch = () => (++gets === 1 ? { ok: false, status: 403, body: null } : { ok: true, status: 200, body: new PassThrough() });
  behavior.download = () => Promise.reject(new Error("받기 실패")); // 캐시로 넘어가 가려지지 않게

  const r = await playOnce(p);

  assert.equal(r.ok, true);
  assert.equal(calls.fetches.length, 2);
});

test("직접 링크는 SafeUrl 을 거치는 DirectLink 로 연다", async () => {
  const p = h.makePlayer();
  p.currentTrack = tracks.direct("https://files.test/a.mp3");
  behavior.stream = () => ({ url: "https://files.test/a.mp3", platform: "direct" });

  await playOnce(p);

  assert.deepEqual(calls.directStreams, ["https://files.test/a.mp3"]);
  assert.equal(calls.fetches.length, 0);
});

test("직접 링크는 응답이 크기를 알릴 때만 나란히 다운로드한다. 크기를 모르는 응답은 스트림으로만 튼다", async () => {
  for (const [headers, downloads] of [
    [{ "content-length": "4096" }, 1],
    [{}, 0],
  ] as const) {
    h.reset();
    const p = h.makePlayer();
    p.currentTrack = tracks.direct("https://files.test/a.mp3");
    behavior.stream = () => ({ url: "https://files.test/a.mp3", platform: "direct" });
    behavior.directStream = () => Object.assign(new PassThrough(), { headers });

    const r = await playOnce(p);

    assert.equal(r.ok, true);
    assert.equal(calls.downloads.length, downloads, JSON.stringify(headers));
    assert.equal(p.playback?.live, false, "크기를 몰라도 라이브는 아니다(끝나면 끝, 위치 이동은 된다)");
  }
});

test("직접 링크가 열리지 않으면 그때 다운로드를 시작해 기다린다", async () => {
  const p = h.makePlayer();
  const track = tracks.direct("https://files.test/c.mp3");
  p.currentTrack = track;
  behavior.stream = () => ({ url: "https://files.test/c.mp3", platform: "direct" });
  behavior.directStream = () => {
    throw new Error("열리지 않음");
  };
  behavior.download = () => Promise.reject(new Error("받기도 실패"));

  const r = await playOnce(p);

  assert.equal(r.ok, false);
  assert.equal(calls.downloads.length, 1, "다운로드해서 틀 길을 연다");
});

test("인터넷 라디오는 라이브로 튼다. 다운로드해 두지 않고, 끝나면 방송이 끝난 것으로 본다", async () => {
  const p = h.makePlayer();
  p.currentTrack = tracks.direct("https://radio.test/live.mp3", { isLive: true, liveStatus: "is_live" });
  behavior.stream = () => ({ url: "https://radio.test/live.mp3", platform: "direct", liveStatus: "is_live" });

  await playOnce(p);

  assert.equal(p.playback?.live, true);
  assert.equal(p.isLive, true, "위치 이동 · 반복을 막는다");
  assert.equal(calls.downloads.length, 0);
  assert.deepEqual(calls.directStreams, ["https://radio.test/live.mp3"]);
});

test("출처 이름을 platform 에 쓰는 음원 곡도 서술자가 direct 면 DirectLink 로 연다", async () => {
  const p = h.makePlayer();
  p.currentTrack = { id: "amq:1", title: "애니", pageUrl: "https://anilist.co/anime/1", requestKey: "amq:1", audioUrl: "https://nawdist.test/a.mp3", platform: "anisongdb", duration: 0 };
  behavior.stream = () => ({ url: "https://nawdist.test/a.mp3", platform: "direct" });

  await playOnce(p);

  assert.deepEqual(calls.directStreams, ["https://nawdist.test/a.mp3"]);
});

test("스트림이 실패해도 그사이 캐시 다운로드가 끝났으면 파일로 넘어간다", async () => {
  const track = yt("hhhhhhhhhhh");
  const p = h.makePlayer();
  p.currentTrack = track;
  behavior.stream = () => ({ url: "https://media.test/c", duration: 100 });
  behavior.fetch = () => {
    h.writeCacheFile("yt:hhhhhhhhhhh");
    throw new Error("끊김");
  };
  const from = sink.buffer.length;

  const r = await playOnce(p);

  assert.equal(r.ok, true);
  assert.equal(calls.spawns.length, 1, "스트림 ffmpeg 는 실행하지 않고 파일만");
  assert.equal(calls.spawns[0].label, "playback");
  assert.ok(
    sink.buffer.slice(from).some((e) => e.text.startsWith("스트림을 열지 못해 다운로드한 캐시로 틉니다")),
    "넘어간 것을 남긴다(조용히 넘어가면 스트림 쪽 결함이 가려진다)",
  );
});

test("스트림도 캐시도 안 되면 실패를 돌려주고 멈춘다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("iiiiiiiiiii");
  behavior.stream = () => ({ url: "https://media.test/d", duration: 100 });
  behavior.fetch = () => {
    throw new Error("끊김");
  };
  behavior.download = () => Promise.reject(new Error("받기도 실패"));

  const r = await playOnce(p);

  assert.equal(r.ok, false);
  assert.equal(r.code, "play-failed");
  assert.ok(r.error, "문장은 화면이 만든다. 오류를 그대로 넘긴다");
  assert.equal(p.currentTrack, null, "대기열이 비어 있으면 현재 곡을 비운다");
  assert.ok(h.fakeAudioOf(p).stops >= 1, "말하는 중 상태를 푼다");
});

test("캐시하지 않는 곡은 스트림이 안 열리면 기다릴 다운로드가 없어 그 오류로 실패한다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("mmmmmmmmmmm");
  behavior.stream = () => ({ url: "https://media.test/long2", duration: 2 * 3600 });
  behavior.fetch = () => {
    throw new Error("끊김");
  };

  const r = await playOnce(p);

  assert.equal(r.ok, false);
  assert.equal(r.code, "play-failed");
  assert.equal((r.error as Error).message, "끊김");
  assert.equal(calls.downloads.length, 0);
});

test("스트림 주소를 못 불러오면 실패", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("jjjjjjjjjjj");
  behavior.stream = () => {
    throw new Error("yt-dlp 실패");
  };

  const r = await playOnce(p);

  assert.equal(r.ok, false);
  assert.equal(calls.spawns.length, 0);
});

// ── HLS · 라이브 ───────────────────────────────────────────────────────

test("HLS(다시보기)는 주소를 ffmpeg 에 주고, 캐시는 뒤에서 다운로드한다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("kkkkkkkkkkk");
  behavior.stream = () => ({ url: "https://hls.test/v.m3u8", protocol: "m3u8_native", liveStatus: "was_live", duration: 300 });

  await playOnce(p, 5000);

  const args = calls.spawns[0].args;
  assert.equal(calls.spawns[0].label, "stream");
  assert.equal(args[args.indexOf("-i") + 1], "https://hls.test/v.m3u8");
  assert.ok(args.includes("-reconnect"));
  assert.ok(args.includes("-ss"), "다시보기는 위치를 옮길 수 있다");
  assert.equal(calls.fetches.length, 0, "Node 가 받지 않는다");
  assert.equal(calls.downloads.length, 1);
  assert.equal(p.playback?.live, false);
  assert.equal(p.isLive, false);
  assert.equal(calls.resources[0].input, calls.spawns[0].stdout, "HLS 분기는 스플라이서를 끼우지 않는다");
});

test("라이브는 위치 0 으로 열고, 캐시를 다운로드하지 않는다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("lllllllllll");
  behavior.stream = () => ({ url: "https://hls.test/live.m3u8", protocol: "m3u8", liveStatus: "is_live" });

  await p.play(7000);
  h.dispose(p);

  assert.ok(!calls.spawns[0].args.includes("-ss"), "라이브에는 옮길 자리가 없다");
  assert.equal(calls.downloads.length, 0, "끝이 없어 다운로드를 시작하면 파일이 무한히 분다");
  assert.equal(p.playback?.live, true);
  assert.equal(p.isLive, true, "재생 시점의 답을 따른다");
  assert.equal(p.currentTrack.isLive, undefined, "트랙은 담을 때의 답 그대로");
});

test("DASH 도 주소를 ffmpeg 에 주되 HLS 옵션은 붙이지 않는다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("dddddddddd1");
  behavior.stream = () => ({ url: "https://dash.test/v.mpd", protocol: "http_dash_segments", duration: 300 });

  await playOnce(p);

  const args = calls.spawns[0].args;
  assert.equal(args[args.indexOf("-i") + 1], "https://dash.test/v.mpd");
  assert.ok(!args.includes("-seg_max_retry"), "HLS 디먹서 옵션이라 붙이면 ffmpeg 가 멈춘다");
  assert.equal(calls.fetches.length, 0, "Node 가 받지 않는다");
  assert.equal(calls.downloads.length, 1);
  assert.equal(p.playback?.transport?.list, "dash");
});

test("ffmpeg 가 HLS 를 못 열면 실패", async () => {
  h.caps.ok = false;
  const p = h.makePlayer();
  p.currentTrack = yt("mmmmmmmmmmm");
  behavior.stream = () => ({ url: "https://hls.test/v.m3u8", protocol: "m3u8_native" });

  const r = await playOnce(p);

  assert.equal(r.ok, false);
});

// ── 스포티파이 ─────────────────────────────────────────────────────────

const spotifyTrack = () => tracks.spotify("sp1");

test("스포티파이: 동등물을 찾아 그 영상의 캐시가 있으면 파일로 튼다", async () => {
  h.seedCache("yt:nnnnnnnnnnn", yt("nnnnnnnnnnn"));
  const p = h.makePlayer();
  p.currentTrack = spotifyTrack();
  behavior.equivalent = () => "https://www.youtube.com/watch?v=nnnnnnnnnnn";
  behavior.stream = () => assert.fail("캐시가 있으면 스트림을 묻지 않는다");

  await playOnce(p);

  assert.equal(calls.spawns[0].label, "playback");
  assert.equal(p.currentTrack.audioUrl, "https://www.youtube.com/watch?v=nnnnnnnnnnn");
  const row = h.lookupRow("https://open.spotify.com/track/sp1");
  assert.equal(row?.audio_url, "https://www.youtube.com/watch?v=nnnnnnnnnnn", "스포티파이 곡 → 영상 을 링크 데이터에 적는다");
});

test("스포티파이: 영상 id 를 몰라 동등물을 먼저 찾고 SponsorBlock 을 묻는다. 구간은 이번 재생에 둔다", async () => {
  const p = h.makePlayer();
  p.currentTrack = spotifyTrack();
  behavior.equivalent = () => "https://www.youtube.com/watch?v=s1sssssssss";
  behavior.sponsor = () => segments([]);
  behavior.stream = () => ({ url: "https://media.test/s", duration: 200 });

  await playOnce(p);

  assert.deepEqual(calls.steps.slice(0, 2), ["equivalent", "sponsor"]);
  assert.deepEqual(p.sponsor, segments([]));
  assert.equal(Object.hasOwn(p.currentTrack ?? {}, "sponsor"), false, "트랙에는 붙이지 않는다");
});

test("스포티파이: 동등물의 캐시가 없으면 스트림으로", async () => {
  const p = h.makePlayer();
  p.currentTrack = spotifyTrack();
  behavior.equivalent = () => "https://www.youtube.com/watch?v=ooooooooooo";
  behavior.stream = () => ({ url: "https://media.test/sp", duration: 200 });

  await playOnce(p);

  assert.equal(calls.spawns[0].label, "stream");
});

test("스포티파이: 동등물을 못 찾으면 실패", async () => {
  const p = h.makePlayer();
  p.currentTrack = spotifyTrack();

  const r = await playOnce(p);

  assert.equal(r.ok, false);
});

// ── 위치 · 인트로 · 제목 ───────────────────────────────────────────────

test("위치를 옮기면 직전 주소의 만료가 남은 곡을 받을 만큼 넉넉할 때만 그 주소를 다시 쓴다. 위치는 -ss 가 정한다", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [expire, reused] of [
    [nowSec + 3600, true], // 남은 270초 + 60초보다 넉넉하다
    [nowSec + 300, false], // 남은 곡을 다 받기 전에 만료된다
    [null, false], // 만료를 모른다
  ] as const) {
    h.reset();
    const p = h.makePlayer();
    p.currentTrack = yt("ppppppppppp");
    const url = `https://rr1.googlevideo.com/videoplayback?id=1${expire ? `&expire=${expire}` : ""}`;
    let asked = 0;
    behavior.stream = () => {
      asked += 1;
      return { url, duration: 300 };
    };

    await p.play(0);
    await playOnce(p, 30000);

    assert.equal(asked, reused ? 1 : 2, `만료 ${expire}`);
    assert.equal(calls.fetches[1].url, url, "위치를 주소에 싣지 않는다");
    const args = calls.spawns[1].args;
    assert.ok(args.indexOf("-ss") > args.indexOf("-i"), "파이프에서는 -ss 가 -i 뒤");
    assert.equal(p.playback?.startOffsetMs, 30000);
  }
});

test("캐시 파일로 이어 틀면 직전 주소를 따지지 않는다. 만료를 모르는 주소는 그렇게 남긴다", async (t) => {
  const track = yt("pc1cccccccc");
  const p = h.makePlayer();
  p.currentTrack = track;
  // 캐시하지 않는 긴 곡(나란히 다운로드 중인 파일은 캐시로 치지 않으므로)
  behavior.stream = () => ({ url: "https://files.test/no-expire.mp3", duration: 2 * 3600 });
  await p.play(0);
  const lines = () => sink.buffer.slice(from).map((e) => e.text);
  const level = logger.level;
  logger.level = "debug";
  t.after(() => {
    logger.level = level;
  });

  let from = sink.buffer.length;
  await p.play(30000);
  assert.ok(lines().some((l) => l.startsWith("직전 스트림 주소는 만료 시각을 몰라 주소를 새로 받습니다:")));

  h.seedCache("yt:pc1cccccccc", track);
  from = sink.buffer.length;
  await playOnce(p, 60000);
  assert.equal(calls.spawns.at(-1)?.label, "playback");
  assert.ok(!lines().some((l) => l.startsWith("직전 스트림 주소")), "파일로 트는데 주소 이야기를 남기지 않는다");
});

test("직전 주소는 같은 곡에서만 다시 쓴다. 다른 곡을 위치부터 틀면(세션 복원 등) 그 곡의 주소를 불러온다", async () => {
  const expire = Math.floor(Date.now() / 1000) + 3600;
  const p = h.makePlayer();
  behavior.stream = (t) => ({ url: `https://rr1.googlevideo.com/videoplayback?id=${t.id}&expire=${expire}`, duration: 300 });
  p.currentTrack = yt("pa1aaaaaaaa");
  await p.play(0);
  p.currentTrack = yt("pb1bbbbbbbb");

  await playOnce(p, 30000);

  assert.match(calls.fetches[1].url, /id=pb1bbbbbbbb/);
});

test("새로 트는 곡의 첫 SponsorBlock 구간이 인트로면 그 끝에서 시작한다", async () => {
  const track = yt("qqqqqqqqqqq");
  h.seedCache("yt:qqqqqqqqqqq", track);
  const p = h.makePlayer();
  p.currentTrack = track;
  behavior.sponsor = () => segments([{ start: 0.4, end: 12.5, categories: ["intro"] }]);

  await playOnce(p);

  assert.equal(p.playback?.startOffsetMs, 12500);
  const args = calls.spawns[0].args;
  assert.equal(args[args.indexOf("-ss") + 1], "12.500");
});

test("유튜브 곡은 스트림 응답의 제목으로 고치고 링크 데이터에 확인됨으로 적는다", async () => {
  const track = yt("rrrrrrrrrrr", { title: "재생목록이 준 옛 제목" });
  const p = h.makePlayer();
  p.currentTrack = track;
  behavior.stream = () => ({ url: "https://media.test/r", duration: 100, title: "영상 자체 제목" });

  await playOnce(p);

  assert.equal(p.currentTrack.title, "영상 자체 제목");
  const row = h.lookupRow(track.requestKey);
  assert.equal(row?.display_title, "영상 자체 제목");
  assert.equal(row?.title_verified, 1);
});

// ── 앞뒤 ───────────────────────────────────────────────────────────────

test("현재 곡이 없으면 대기열에서 꺼낸다", async () => {
  const track = yt("sssssssssss");
  h.seedCache("yt:sssssssssss", track);
  const p = h.makePlayer();
  p.queue.push(track);

  await playOnce(p);

  assert.equal(p.currentTrack, track);
  assert.equal(p.queue.length, 0);
});

test("현재 곡도 대기열도 없으면 실패 문장을 돌려준다", async () => {
  const p = h.makePlayer();

  const r = await playOnce(p);

  assert.deepEqual(r, { ok: false, code: "queue-empty" });
});

test("음성에 안 붙어 있으면 먼저 붙는다", async () => {
  const track = yt("ttttttttttt");
  h.seedCache("yt:ttttttttttt", track);
  const p = h.makePlayer({ connected: false });
  p.currentTrack = track;

  await playOnce(p);

  assert.ok(p.connection, "연결을 만들었다");
});

test("멈춤 사유가 있으면 불러만 두고 멈춘 상태로 둔다", async () => {
  const track = yt("uuuuuuuuuuu");
  h.seedCache("yt:uuuuuuuuuuu", track);
  const p = h.makePlayer();
  p.currentTrack = track;
  p.pauseReasons.add("alone");

  await playOnce(p);

  assert.equal(p.paused, true);
  assert.equal(h.fakeAudioOf(p).played.length, 1, "리소스는 건다. 멈추는 것은 Playing 리스너다");
});

test("틀고 나면 저장하고, 재개면 이유가 다르다", async () => {
  const track = yt("vvvvvvvvvvv");
  h.seedCache("yt:vvvvvvvvvvv", track);
  const p = h.makePlayer();
  p.currentTrack = track;

  await p.play(0);
  await playOnce(p, 1000);

  assert.deepEqual(
    calls.persists.filter((x) => !x.startsWith("schedule:")),
    ["play", "resume-playback"],
  );
});

test("리소스 볼륨과 전송 비트레이트를 맞춘다", async () => {
  const track = yt("wwwwwwwwwww");
  h.seedCache("yt:wwwwwwwwwww", track);
  const p = h.makePlayer();
  p.currentTrack = track;
  p.volume = 40;

  await playOnce(p);

  assert.equal(calls.resources[0].volume.value, 0.4);
  assert.equal(calls.resources[0].encoder.bitrate, 128000);
});

test("틀면 넘침 안전망을 5초 간격으로 건다", async () => {
  const track = yt("xxxxxxxxxxx");
  h.seedCache("yt:xxxxxxxxxxx", track, { durationSec: 100 });
  const p = h.makePlayer();
  p.currentTrack = track;

  await p.play(40000);
  const delay = h.timerDelay(p.watch.overflowTimer); // 치우기 전에 읽는다
  h.dispose(p);

  assert.equal(delay, 5000);
});

test("play() 는 느린 곡 찾기에 들어가기 전에 여는 중(starting)을 건다. 멎음 감시가 여는 중인 곡을 넘기지 않는다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("x2xxxxxxxxx");
  let release: (() => void) | null = null;
  behavior.stream = () =>
    new Promise((_, reject) => {
      release = () => reject(new Error("그만"));
    });

  const opening = p.play(0);
  assert.equal(p.isPlayStarting, true, "부르는 즉시");
  for (let i = 0; i < 100 && !release; i++) await new Promise((done) => setImmediate(done));
  assert.ok(release, "곡 찾기에 들어갔다");
  assert.equal(p.isPlayStarting, true, "곡을 찾는 동안에도");

  p.watch.checkIdle();
  assert.equal(p.currentTrack?.id, "x2xxxxxxxxx", "넘기지 않는다");
  assert.notEqual(p.watch.idleTimer, null, "여는 일이 끝난 뒤 다시 본다");

  (release as unknown as () => void)();
  await opening;
  h.dispose(p);
});

// ── 재생 뒤에 오는 신호 ────────────────────────────────────────────────

test("다른 곡을 틀면 앞 곡의 퇴거 보호를 풀고 새 곡을 보호한다", async () => {
  const track = yt("y1yyyyyyyyy");
  h.seedCache("yt:y1yyyyyyyyy", track);
  audioCache.protect("yt:y0yyyyyyyyy");
  const p = h.makePlayer();
  p._protectedAudioKey = "yt:y0yyyyyyyyy";
  p.currentTrack = track;

  await playOnce(p);

  const live = audioCache._liveKeys();
  assert.equal(live.has("yt:y0yyyyyyyyy"), false);
  assert.equal(live.has("yt:y1yyyyyyyyy"), true);
  p.releaseAudioProtection();
});

test("라이브 ffmpeg 의 종료 코드를 적는다. 신호로 죽으면 -1", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("z1zzzzzzzzz");
  behavior.stream = () => ({ url: "https://hls.test/live.m3u8", protocol: "m3u8", liveStatus: "is_live" });

  await playOnce(p);
  assert.equal(p.playback?.input?.exitCode, null, "여는 순간에는 비운다");
  calls.spawns[0].emit("exit", 1, null);
  assert.equal(p.playback?.input?.exitCode, 1);

  h.reset();
  const q = h.makePlayer();
  q.currentTrack = yt("z2zzzzzzzzz");
  behavior.stream = () => ({ url: "https://hls.test/live.m3u8", protocol: "m3u8", liveStatus: "is_live" });
  await playOnce(q);
  calls.spawns[0].emit("exit", null, "SIGKILL");
  assert.equal(q.playback?.input?.exitCode, -1);
});

test("청크 스트림이 끊기면 캐시 전환을 먼저 묻고, 그 답을 청크 스트림에 돌려준다", async () => {
  const p = h.makePlayer({ as: SwitchAsked });
  const track = yt("z3zzzzzzzzz");
  p.currentTrack = track;
  behavior.stream = () => ({ url: "https://rr1.googlevideo.com/videoplayback?clen=4096", duration: 100 });

  await playOnce(p);
  const { onInterrupt, onResumed } = calls.chunked[0];
  assert.ok(onInterrupt && onResumed, "청크 스트림에 끊김 · 복구 알림을 건다");

  assert.equal(onInterrupt(new Error("끊김")), true, "전환이 예약되면 청크 스트림은 이어받지 않는다");
  assert.deepEqual(p.asked, [track], "그 재생의 곡으로 묻는다(현재 곡이 바뀌었어도)");
  assert.doesNotThrow(() => onResumed({ attempts: 1, downtimeMs: 500, starvedMs: 0 }));
});

test("스트림이 복구 불가로 끊기면 캐시 전환을 걸고 ffmpeg 입력을 닫는다", async () => {
  const p = h.makePlayer({ as: SwitchAsked });
  const track = yt("z4zzzzzzzzz");
  p.currentTrack = track;
  behavior.stream = () => ({ url: "https://media.test/e", duration: 100 });
  const body = new PassThrough();
  behavior.fetch = () => ({ ok: true, status: 200, body });

  await playOnce(p);
  const ffmpeg = calls.spawns[0];
  body.emit("error", new Error("끊김"));

  assert.deepEqual(p.asked, [track]);
  assert.equal(ffmpeg.stdin.writableEnded, true, "입력을 닫아야 출력이 끝나 전환이나 Idle 로 넘어간다");
});

// ── 입력이 온전히 끝났는가(곡 끝 판정이 본다) ─────────────────────────────

const tick = () => new Promise((done) => setImmediate(done));

test("파이프 분기: 입력 스트림이 깨지면 입력을 닫은 ffmpeg 가 0 으로 끝나도 깨진 것으로 적는다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("z5zzzzzzzzz");
  behavior.stream = () => ({ url: "https://media.test/e", duration: 100 });
  const body = new PassThrough();
  behavior.fetch = () => ({ ok: true, status: 200, body });

  await playOnce(p);
  assert.equal(p.playback?.input?.broken, null, "여는 순간에는 온전하다");
  body.emit("error", new Error("끊김"));
  calls.spawns[0].emit("exit", 0, null);

  assert.equal(p.playback?.input?.exitCode, 0);
  assert.match(p.playback?.input?.broken ?? "", /입력 스트림 오류/);
});

test("파이프 분기: 청크 스트림이 전체 크기를 다 받지 못하고 끝나면 깨진 것, 다 받고 끝나면 온전하다", async () => {
  for (const [received, broken] of [
    [1000, true],
    [4096, false],
  ] as const) {
    h.reset();
    const p = h.makePlayer();
    p.currentTrack = yt("z6zzzzzzzzz");
    behavior.stream = () => ({ url: "https://rr1.googlevideo.com/videoplayback?clen=4096", duration: 100 });

    await playOnce(p);
    const stream = calls.chunkedStreams[0];
    stream.received = received;
    stream.end();
    await tick();

    assert.equal(p.playback?.input?.broken != null, broken, `${received}/4096B`);
    if (broken) assert.match(p.playback?.input?.broken ?? "", /1000\/4096B/);
  }
});

test("파일 · 주소 분기도 ffmpeg 가 0 이 아닌 코드로 끝나면 깨진 것으로 적는다", async () => {
  const cachedTrack = yt("z7zzzzzzzzz");
  h.seedCache("yt:z7zzzzzzzzz", cachedTrack);
  const p = h.makePlayer();
  p.currentTrack = cachedTrack;
  await playOnce(p);
  assert.equal(calls.spawns[0].label, "playback");
  assert.equal(p.playback?.input?.broken, null, "여는 순간에는 온전하다");
  calls.spawns[0].emit("exit", 2, null);
  assert.match(p.playback?.input?.broken ?? "", /종료 코드 2/);

  h.reset();
  const q = h.makePlayer();
  q.currentTrack = yt("z8zzzzzzzzz");
  behavior.stream = () => ({ url: "https://hls.test/vod.m3u8", protocol: "m3u8", duration: 100 });
  await playOnce(q);
  calls.spawns[0].emit("exit", 1, null);
  assert.match(q.playback?.input?.broken ?? "", /종료 코드 1/);
});

test("연 입력의 종류를 적는다. 청크 스트림은 끊겼을 때 남길 상태(이어받는 중인가)를 준다", async () => {
  const kinds: Array<[string, () => void]> = [
    ["청크", () => (behavior.stream = () => ({ url: "https://rr1.googlevideo.com/videoplayback?clen=4096", duration: 100 }))],
    ["단일 GET", () => (behavior.stream = () => ({ url: "https://media.test/e", duration: 100 }))],
    ["직접 링크", () => (behavior.stream = () => ({ url: "https://files.test/a.mp3", platform: "direct", duration: 100 }))],
    ["HLS", () => (behavior.stream = () => ({ url: "https://hls.test/vod.m3u8", protocol: "m3u8", duration: 100 }))],
  ];
  for (const [kind, arrange] of kinds) {
    h.reset();
    const p = h.makePlayer();
    p.currentTrack = yt("k1kkkkkkkkk");
    arrange();
    await playOnce(p);
    assert.equal(p.playback?.input?.kind, kind);
    if (kind === "청크") {
      assert.doesNotMatch(p.playback?.input?.detail() ?? "", /이어받는 중/);
      calls.chunkedStreams[0].resuming = true;
      assert.match(p.playback?.input?.detail() ?? "", /^청크 #1 · .* · 이어받는 중$/);
    } else assert.equal(p.playback?.input?.detail(), null, kind);
  }

  h.reset();
  const cachedTrack = yt("k2kkkkkkkkk");
  h.seedCache("yt:k2kkkkkkkkk", cachedTrack);
  const f = h.makePlayer();
  f.currentTrack = cachedTrack;
  await playOnce(f);
  assert.equal(f.playback?.input?.kind, "파일");
});

test("오디오 플레이어는 공급이 끊겨도 10초(프레임 500개)를 버틴다", () => {
  let options: unknown = null;
  const p = new h.Player(h.fakeGuild("g9"), null, null, {
    createAudioPlayer: ((opts: unknown) => {
      options = opts;
      return new EventEmitter();
    }) as never,
  });
  h.dispose(p);
  assert.deepEqual(options, { behaviors: { maxMissedFrames: 500 } });
});

test("캐시에 적힌 길이가 보이던 값과 2초 안이면 표시는 그대로, 곡 끝 판정은 음원의 길이", async () => {
  const track = yt("n1nnnnnnnnn");
  h.seedCache("yt:n1nnnnnnnnn", track, { durationSec: 180.4 });
  const p = h.makePlayer();
  p.currentTrack = track;

  await playOnce(p);

  assert.equal(p.currentTrack.duration, 180);
  assert.equal(p.playback?.lengthMs, 180_400);
});

test("다운로드 전에 길이를 몰랐던 곡(직접 링크)은 나란히 다운로드가 끝나면 음원 길이를 알고 패널을 고친다", async () => {
  const p = h.makePlayer();
  const seen = recordPanel({ player: p });
  const track = tracks.direct("https://files.test/len.mp3", { durationSource: "unknown" });
  p.currentTrack = track;
  behavior.stream = () => ({ url: "https://files.test/len.mp3", platform: "direct" });
  behavior.directStream = () => Object.assign(new PassThrough(), { headers: { "content-length": "4096" } });
  let finish: () => void = () => {};
  behavior.download = (t) =>
    new Promise((done) => {
      finish = () => {
        // 진짜 다운로드처럼 캐시에 잰 길이를 적고 표시를 채운다
        const key = `dl:${md5("https://files.test/len.mp3")}`;
        const file = h.writeCacheFile(key);
        audioCache.recordDownloadComplete(key, file, 4, t, { durationSec: 123.4 });
        Object.assign(t, { duration: 123.4, durationSource: "measured" });
        done(file);
      };
    });

  await playOnce(p);
  assert.equal(p.playback?.lengthMs, null, "다운로드 전에는 모른다");
  finish();
  for (let i = 0; i < 10; i++) await new Promise((done) => setImmediate(done));
  seen.stop();

  assert.equal(p.playback?.lengthMs, 123_400);
  assert.ok(seen.includes("update"), "표시 길이가 바뀌어 패널을 고친다");
});

test("HLS 다시보기가 세그먼트를 건너뛰면 입력을 끊고 깨진 것으로 적는다. 라이브는 이어 튼다", async () => {
  const line = "[in#0/hls @ 000001] Segment 3 of playlist 0 failed too many times, skipping\n";
  for (const [liveStatus, cut] of [
    [null, true],
    ["is_live", false],
  ] as const) {
    h.reset();
    const p = h.makePlayer();
    p.currentTrack = yt("s5sssssssss");
    behavior.stream = () => ({ url: "https://hls.test/vod.m3u8", protocol: "m3u8", duration: 100, liveStatus });
    await playOnce(p);
    const ffmpeg = calls.spawns[0];
    assert.equal(ffmpeg.args[ffmpeg.args.indexOf("-loglevel") + 1], "warning", "건너뛴 줄은 warning 이다");

    ffmpeg.stderr.write("[in#0/hls @ 000001] Failed to open segment 3 of playlist 0\n[in#0/hls @ 0000");
    ffmpeg.stderr.write(line.slice(15));
    await new Promise((done) => setImmediate(done));

    assert.equal(ffmpeg.killed, cut, String(liveStatus));
    if (cut) assert.equal(p.playback?.input?.broken, "HLS 세그먼트를 건너뜀: Segment 3 of playlist 0 failed too many times, skipping");
    else assert.equal(p.playback?.input?.broken, null);
  }
});
