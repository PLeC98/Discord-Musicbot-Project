"use strict";

// MusicPlayer.play() 의 지금 동작을 고정한다(구조 리팩터링 0단계).
//
// 옳고 그름을 따지는 테스트가 아니다. 리팩터링이 play() 를 다섯 함수로 나눌 때 **무엇이 바뀌었는지**
// 드러나게 하려는 것이다. 여기 적힌 동작이 이상해 보여도 고치지 말고, 고칠 때는 이 테스트를 같이 고친다.
//
// 갈래마다 셋을 본다. 어떤 ffmpeg 를 무엇으로 띄웠나, 캐시 장부에 무엇을 적었나, 끝난 뒤 플레이어 상태.

const h = require("../helpers/playerHarness");
const audioCache = require("../../src/store/audioCache");
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { AudioSplicer } = require("../../src/media/audioSplicer");
const { PassThrough } = require("node:stream");

const { calls, behavior } = h;

beforeEach(() => h.reset());

const tracks = require("../helpers/tracks");

const yt = tracks.youtube;
const argsOf = (child) => child.args.join(" ");

// 한 시험이 끝나면 타이머를 남기지 않는다
async function playOnce(player, seekMs = 0) {
  try {
    return await player.play(null, seekMs);
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

  assert.equal(r.success, true);
  assert.equal(calls.spawns.length, 1);
  assert.equal(calls.spawns[0].label, "playback");
  assert.match(argsOf(calls.spawns[0]), new RegExp(`-i ${file.replace(/[\\.]/g, "\\$&")}`));
  assert.equal(calls.downloads.length, 0, "이미 있으니 받지 않는다");
  assert.equal(calls.fetches.length, 0);
  assert.equal(p.audioPlayer.played.length, 1);
  assert.equal(calls.resources[0].input, calls.spawns[0].stdout, "파일 갈래는 스플라이서를 끼우지 않는다");
  assert.equal(p.currentDownloadedFile, file);
  // 길이는 캐시에 적힌 실제 길이로 바꾼다
  assert.equal(p.currentTrack.duration, 201);
});

test("캐시에서 틀어도 장부에 재생을 적는다", async () => {
  const track = yt("bbbbbbbbbbb");
  h.seedCache("yt:bbbbbbbbbbb", track);
  const p = h.makePlayer();
  p.currentTrack = track;

  await playOnce(p);

  assert.equal(h.audioRow("yt:bbbbbbbbbbb").play_count, 1);
  const row = h.lookupRow(track.requestKey);
  assert.equal(row.audio_url, "https://www.youtube.com/watch?v=bbbbbbbbbbb");
  assert.equal(row.title_verified, 0, "캐시 갈래는 영상 제목을 못 받아 확인 안 됨으로 적는다");
});

test("받아 둔 파일(currentDownloadedFile)이 있으면 그것부터 쓴다", async () => {
  const track = yt("ccccccccccc");
  const other = h.writeCacheFile("yt:다른-자리");
  const p = h.makePlayer();
  p.currentTrack = track;
  p.currentDownloadedFile = other;

  await playOnce(p);

  assert.equal(calls.spawns[0].label, "playback");
  assert.ok(calls.spawns[0].args.includes(other));
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

test("캐시가 없으면 스트림을 파이프로 먹이고 뒤에서 캐시를 받는다", async () => {
  const track = yt("eeeeeeeeeee");
  const p = h.makePlayer();
  p.currentTrack = track;
  behavior.stream = () => ({ url: "https://media.test/a", duration: 190, platform: "youtube", httpHeaders: { "User-Agent": "yt-dlp" } });

  const r = await playOnce(p);

  assert.equal(r.success, true);
  assert.equal(calls.fetches.length, 1, "길이를 모르는 주소는 단일 GET");
  assert.equal(calls.fetches[0].url, "https://media.test/a");
  assert.deepEqual(calls.fetches[0].init.headers, { "User-Agent": "yt-dlp" }, "yt-dlp 가 준 헤더를 그대로");
  assert.equal(calls.spawns.length, 1);
  assert.equal(calls.spawns[0].label, "stream");
  assert.ok(calls.spawns[0].args.includes("pipe:0"));
  assert.equal(calls.downloads.length, 1, "재생과 나란히 캐시를 받는다");
  assert.ok(calls.resources[0].input instanceof AudioSplicer, "스트림 갈래는 무지연 전환을 위해 스플라이서를 끼운다");
  assert.equal(p.currentTrack.duration, 190, "캐시가 없으면 스트림이 준 길이");
});

test("헤더를 안 준 스트림은 브라우저 User-Agent 로 받는다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("fffffffffff");
  behavior.stream = () => ({ url: "https://media.test/b", duration: 100 });

  await playOnce(p);

  assert.match(calls.fetches[0].init.headers["User-Agent"], /Mozilla/);
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

test("직접 링크는 SafeUrl 을 거치는 DirectLink 로 연다", async () => {
  const p = h.makePlayer();
  p.currentTrack = tracks.direct("https://files.test/a.mp3");
  behavior.stream = (t) => ({ url: t.audioUrl, platform: "direct" });

  await playOnce(p);

  assert.deepEqual(calls.directStreams, ["https://files.test/a.mp3"]);
  assert.equal(calls.fetches.length, 0);
});

test("출처 이름을 platform 에 쓰는 음원 곡도 서술자가 direct 면 DirectLink 로 연다", async () => {
  const p = h.makePlayer();
  p.currentTrack = { id: "amq:1", title: "애니", pageUrl: "https://anilist.co/anime/1", requestKey: "amq:1", audioUrl: "https://nawdist.test/a.mp3", platform: "anisongdb", duration: 0 };
  behavior.stream = (t) => ({ url: t.audioUrl, platform: "direct" });

  await playOnce(p);

  assert.deepEqual(calls.directStreams, ["https://nawdist.test/a.mp3"]);
});

test("스트림이 실패해도 그사이 캐시가 다 받아졌으면 파일로 넘어간다", async () => {
  const track = yt("hhhhhhhhhhh");
  const p = h.makePlayer();
  p.currentTrack = track;
  behavior.stream = () => ({ url: "https://media.test/c", duration: 100 });
  behavior.fetch = () => {
    h.writeCacheFile("yt:hhhhhhhhhhh");
    throw new Error("끊김");
  };

  const r = await playOnce(p);

  assert.equal(r.success, true);
  assert.equal(calls.spawns.length, 1, "스트림 ffmpeg 는 띄우지 않고 파일만");
  assert.equal(calls.spawns[0].label, "playback");
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

  assert.equal(r.success, false);
  assert.equal(typeof r.message, "string", "지금은 사람이 읽을 문장을 돌려준다");
  assert.equal(p.currentTrack, null, "대기열이 비어 있으면 현재 곡을 비운다");
  assert.ok(p.audioPlayer.stops >= 1, "말하는 중 상태를 푼다");
});

test("스트림 주소를 못 받으면 실패", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("jjjjjjjjjjj");
  behavior.stream = () => {
    throw new Error("yt-dlp 실패");
  };

  const r = await playOnce(p);

  assert.equal(r.success, false);
  assert.equal(calls.spawns.length, 0);
});

// ── HLS · 라이브 ───────────────────────────────────────────────────────

test("HLS(다시보기)는 주소를 ffmpeg 에 주고, 캐시는 뒤에서 받는다", async () => {
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
  assert.equal(p._playingLive, false);
  assert.equal(p.currentTrack.isLive, false);
  assert.equal(calls.resources[0].input, calls.spawns[0].stdout, "HLS 갈래는 스플라이서를 끼우지 않는다");
});

test("라이브는 위치 0 으로 열고, 캐시를 안 받고, 종료 감시를 걸지 않는다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("lllllllllll");
  behavior.stream = () => ({ url: "https://hls.test/live.m3u8", protocol: "m3u8", liveStatus: "is_live" });

  await p.play(null, 7000);
  const timer = p.watch.endTimer;
  h.dispose(p);

  assert.ok(!calls.spawns[0].args.includes("-ss"), "라이브에는 옮길 자리가 없다");
  assert.equal(calls.downloads.length, 0, "끝이 없어 받기 시작하면 파일이 무한히 분다");
  assert.equal(p._playingLive, true);
  assert.equal(p.currentTrack.isLive, true, "지금은 재생 시점의 답을 트랙에 덮어쓴다");
  assert.equal(timer, null);
});

test("ffmpeg 가 HLS 를 못 열면 실패", async () => {
  h.caps.ok = false;
  const p = h.makePlayer();
  p.currentTrack = yt("mmmmmmmmmmm");
  behavior.stream = () => ({ url: "https://hls.test/v.m3u8", protocol: "m3u8_native" });

  const r = await playOnce(p);

  assert.equal(r.success, false);
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
  assert.equal(row.audio_url, "https://www.youtube.com/watch?v=nnnnnnnnnnn", "스포티파이 곡 → 영상 을 장부에 적는다");
});

test("스포티파이: SponsorBlock 을 먼저 묻고, 영상 id 를 몰라 동등물을 찾은 뒤 다시 묻는다", async () => {
  const p = h.makePlayer();
  p.currentTrack = spotifyTrack();
  behavior.equivalent = () => "https://www.youtube.com/watch?v=s1sssssssss";
  behavior.sponsor = () => ({ skipSegments: [] });
  behavior.stream = () => ({ url: "https://media.test/s", duration: 200 });

  await playOnce(p);

  assert.deepEqual(calls.steps.slice(0, 3), ["sponsor", "equivalent", "sponsor"]);
  assert.equal(p.currentTrack._sponsorResolved, true);
});

test("스트림 서술자도 받아 둔 파일도 없으면 실패", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("s2sssssssss");
  behavior.stream = () => null;

  const r = await playOnce(p);

  assert.equal(r.success, false);
  assert.equal(calls.spawns.length, 0);
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

  assert.equal(r.success, false);
});

// ── 위치 · 인트로 · 제목 ───────────────────────────────────────────────

test("위치를 옮기면 지난 googlevideo 주소에 begin= 을 붙여 다시 연다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("ppppppppppp");
  let asked = 0;
  behavior.stream = () => {
    asked += 1;
    return { url: "https://rr1.googlevideo.com/videoplayback?id=1", duration: 300, canSeek: true };
  };

  await p.play(null, 0);
  await playOnce(p, 30000);

  assert.equal(asked, 1, "두 번째는 주소를 다시 묻지 않는다");
  assert.match(calls.fetches[1].url, /begin=30000/);
  const args = calls.spawns[1].args;
  assert.ok(args.indexOf("-ss") > args.indexOf("-i"), "파이프에서는 -ss 가 -i 뒤");
  assert.equal(p.currentTrackStartOffsetMs, 30000);
});

test("새로 트는 곡의 첫 SponsorBlock 구간이 인트로면 그 끝에서 시작한다", async () => {
  const track = yt("qqqqqqqqqqq");
  h.seedCache("yt:qqqqqqqqqqq", track);
  const p = h.makePlayer();
  p.currentTrack = track;
  behavior.sponsor = () => ({ skipSegments: [{ start: 0.4, end: 12.5, categories: ["intro"] }] });

  await playOnce(p);

  assert.equal(p.currentTrackStartOffsetMs, 12500);
  const args = calls.spawns[0].args;
  assert.equal(args[args.indexOf("-ss") + 1], "12.500");
});

test("유튜브 곡은 스트림 응답의 제목으로 고치고 장부에 확인됨으로 적는다", async () => {
  const track = yt("rrrrrrrrrrr", { title: "재생목록이 준 옛 제목" });
  const p = h.makePlayer();
  p.currentTrack = track;
  behavior.stream = () => ({ url: "https://media.test/r", duration: 100, title: "영상 자체 제목" });

  await playOnce(p);

  assert.equal(p.currentTrack.title, "영상 자체 제목");
  const row = h.lookupRow(track.requestKey);
  assert.equal(row.display_title, "영상 자체 제목");
  assert.equal(row.title_verified, 1);
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

  assert.deepEqual(r, { success: false, message: "대기열에 트랙이 없습니다!" });
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
  assert.equal(p.audioPlayer.played.length, 1, "리소스는 건다. 멈추는 것은 Playing 리스너다");
});

test("틀고 나면 저장하고, 재개면 이유가 다르다", async () => {
  const track = yt("vvvvvvvvvvv");
  h.seedCache("yt:vvvvvvvvvvv", track);
  const p = h.makePlayer();
  p.currentTrack = track;

  await p.play(null, 0);
  await playOnce(p, 1000);

  assert.deepEqual(
    calls.persists.filter((x) => !x.startsWith("schedule:")),
    ["play", "resume-playback"],
  );
});

test("리소스 음량과 전송 비트레이트를 맞춘다", async () => {
  const track = yt("wwwwwwwwwww");
  h.seedCache("yt:wwwwwwwwwww", track);
  const p = h.makePlayer();
  p.currentTrack = track;
  p.volume = 40;

  await playOnce(p);

  assert.equal(calls.resources[0].volume.value, 0.4);
  assert.equal(calls.resources[0].encoder.bitrate, 128000);
});

test("종료 감시는 남은 길이 + 4초 뒤로 건다", async () => {
  const track = yt("xxxxxxxxxxx");
  h.seedCache("yt:xxxxxxxxxxx", track, { durationSec: 100 });
  const p = h.makePlayer();
  p.currentTrack = track;

  await p.play(null, 40000);
  const delay = p.watch.endTimer?._idleTimeout; // 치우기 전에 읽는다. 치우면 -1 이 된다
  h.dispose(p);

  assert.equal(delay, (100 - 40) * 1000 + 4000, "길이를 아는 곡은 감시를 건다");
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
  assert.equal(p._liveExitCode, null, "여는 순간에는 비운다");
  calls.spawns[0].emit("exit", 1, null);
  assert.equal(p._liveExitCode, 1);

  h.reset();
  const q = h.makePlayer();
  q.currentTrack = yt("z2zzzzzzzzz");
  behavior.stream = () => ({ url: "https://hls.test/live.m3u8", protocol: "m3u8", liveStatus: "is_live" });
  await playOnce(q);
  calls.spawns[0].emit("exit", null, "SIGKILL");
  assert.equal(q._liveExitCode, -1);
});

test("청크 스트림이 끊기면 캐시 전환을 먼저 묻고, 그 답을 청크 스트림에 돌려준다", async () => {
  const p = h.makePlayer();
  const track = yt("z3zzzzzzzzz");
  p.currentTrack = track;
  const asked = [];
  p._planCacheSwitch = (_splicer, t) => {
    asked.push(t);
    return true;
  };
  behavior.stream = () => ({ url: "https://rr1.googlevideo.com/videoplayback?clen=4096", duration: 100 });

  await playOnce(p);
  const { onInterrupt, onResumed } = calls.chunked[0];

  assert.equal(onInterrupt(new Error("끊김")), true, "전환이 예약되면 청크 스트림은 이어받지 않는다");
  assert.deepEqual(asked, [track], "그 재생의 곡으로 묻는다(현재 곡이 바뀌었어도)");
  assert.doesNotThrow(() => onResumed({ attempts: 1, downtimeMs: 500, starvedMs: 0 }));
});

test("스트림이 복구 불가로 끊기면 캐시 전환을 걸고 ffmpeg 입력을 닫는다", async () => {
  const p = h.makePlayer();
  const track = yt("z4zzzzzzzzz");
  p.currentTrack = track;
  const asked = [];
  p._planCacheSwitch = (_splicer, t) => asked.push(t);
  behavior.stream = () => ({ url: "https://media.test/e", duration: 100 });
  const body = new PassThrough();
  behavior.fetch = () => ({ ok: true, status: 200, body });

  await playOnce(p);
  const ffmpeg = calls.spawns[0];
  body.emit("error", new Error("끊김"));

  assert.deepEqual(asked, [track]);
  assert.equal(ffmpeg.stdin.writableEnded, true, "입력을 닫아야 출력이 끝나 전환이나 Idle 로 넘어간다");
});
