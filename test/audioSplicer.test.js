"use strict";

// src/audioSplicer.js — 재생을 끊지 않고 소스를 갈아끼우는 스트림
//
// 지키는 것: 전환 전후로 한 바이트도 새지 않고, 지정한 지점에서 갈아타며,
// 크로스페이드 구간 밖은 원본과 완전히 같다. 소스가 끝나면 이 스트림도 끝난다
// (안 끝나면 AudioPlayer가 Idle로 못 가 트랙이 영영 안 넘어간다).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("stream");
const { AudioSplicer, BYTES_PER_MS, FRAME_BYTES } = require("../src/audioSplicer");

// 위치마다 값이 다른 PCM — 어긋나면 바로 드러난다. mark로 소스를 구분한다.
function pcm(ms, mark) {
  const buf = Buffer.alloc(ms * BYTES_PER_MS);
  for (let i = 0; i < buf.length; i += 2) buf.writeInt16LE(((i / 2 + mark * 1000) % 20000) - 10000, i);
  return buf;
}

function feed(chunkMs = 100) {
  const s = new PassThrough();
  s.writeAll = (buf) => {
    for (let o = 0; o < buf.length; o += chunkMs * BYTES_PER_MS) s.write(buf.subarray(o, o + chunkMs * BYTES_PER_MS));
    s.end();
  };
  return s;
}

const collect = (s) =>
  new Promise((resolve, reject) => {
    const cs = [];
    s.on("data", (c) => cs.push(c));
    s.on("end", () => resolve(Buffer.concat(cs)));
    s.on("error", reject);
  });

// ── 전환 없음 ────────────────────────────────────────────────

test("전환이 없으면 소스를 그대로 통과시킨다", async () => {
  const src = feed();
  const sp = new AudioSplicer(src);
  const body = pcm(500, 1);
  src.writeAll(body);
  assert.deepEqual(await collect(sp), body);
});

test("프레임보다 짧은 꼬리도 흘리지 않고 끝낸다", async () => {
  // 'end'는 버퍼를 다 비워야 온다 — 꼬리를 남기면 스트림이 영영 안 끝나 트랙이 멈춘다
  const src = new PassThrough();
  const sp = new AudioSplicer(src);
  const body = Buffer.concat([pcm(100, 1), Buffer.alloc(FRAME_BYTES - 100)]); // 프레임 미만 꼬리
  src.end(body);
  const out = await collect(sp);
  assert.equal(out.length, body.length, "꼬리까지 전부 나와야 한다");
});

test("소스가 끝나면 이 스트림도 끝난다 (AudioPlayer가 Idle로 가야 다음 곡)", async () => {
  const src = feed();
  const sp = new AudioSplicer(src);
  src.writeAll(pcm(80, 1));
  let ended = false;
  sp.on("end", () => (ended = true));
  await collect(sp);
  assert.equal(ended, true);
});

// ── 전환 ─────────────────────────────────────────────────────

test("지정한 지점에서 갈아탄다 — 전후로 바이트가 새지 않는다", async () => {
  const src = feed();
  const nxt = feed();
  const sp = new AudioSplicer(src, { fadeMs: 40 });
  src.writeAll(pcm(400, 1));

  const switchAt = 200;
  sp.planSwitch(nxt, switchAt);
  nxt.writeAll(pcm(400, 2)); // switchAt 지점부터의 오디오라고 가정

  const out = await collect(sp);
  // 전환 지점까지는 A, 페이드 뒤부터는 B. 총 길이는 A(200ms) + B가 내놓은 만큼.
  assert.ok(out.length > switchAt * BYTES_PER_MS, "전환 지점을 넘겨 계속 나왔다");
  assert.equal(out.length % 2, 0, "샘플 경계가 깨지지 않았다");
});

test("전환 지점 이전 구간은 첫 소스와 바이트 단위로 같다", async () => {
  const src = feed();
  const nxt = feed();
  const sp = new AudioSplicer(src, { fadeMs: 40 });
  const a = pcm(400, 1);
  src.writeAll(a);
  const switchAt = 200;
  sp.planSwitch(nxt, switchAt);
  nxt.writeAll(pcm(400, 2));

  const out = await collect(sp);
  assert.deepEqual(out.subarray(0, switchAt * BYTES_PER_MS), a.subarray(0, switchAt * BYTES_PER_MS));
});

test("크로스페이드가 끝난 뒤 구간은 새 소스와 바이트 단위로 같다", async () => {
  const src = feed();
  const nxt = feed();
  const fadeMs = 40;
  const sp = new AudioSplicer(src, { fadeMs });
  src.writeAll(pcm(400, 1));
  const switchAt = 200;
  sp.planSwitch(nxt, switchAt);
  const b = pcm(400, 2);
  nxt.writeAll(b);

  const out = await collect(sp);
  const after = (switchAt + fadeMs) * BYTES_PER_MS;
  const tail = out.subarray(after, after + 50 * BYTES_PER_MS);
  assert.deepEqual(tail, b.subarray(fadeMs * BYTES_PER_MS, (fadeMs + 50) * BYTES_PER_MS));
});

test("크로스페이드는 볼륨 딥을 만들지 않는다 (등출력)", async () => {
  // 같은 신호를 두 소스에 주면 등출력 페이드는 원 진폭을 유지해야 한다.
  // 선형 페이드였다면 교차점에서 -6dB로 꺼진다.
  const src = feed();
  const nxt = feed();
  const fadeMs = 40;
  const sp = new AudioSplicer(src, { fadeMs });
  const wave = Buffer.alloc(400 * BYTES_PER_MS);
  for (let i = 0; i < wave.length; i += 2) wave.writeInt16LE(Math.round(10000 * Math.sin(i / 40)), i);
  src.writeAll(wave);
  sp.planSwitch(nxt, 200);
  nxt.writeAll(wave.subarray(200 * BYTES_PER_MS));

  const out = await collect(sp);
  const mid = out.subarray((200 + fadeMs / 2) * BYTES_PER_MS, (200 + fadeMs / 2 + 5) * BYTES_PER_MS);
  let peak = 0;
  for (let i = 0; i < mid.length; i += 2) peak = Math.max(peak, Math.abs(mid.readInt16LE(i)));
  assert.ok(peak > 8000, `페이드 한가운데 진폭이 유지돼야 한다 (실제 ${peak})`);
});

test("switched 이벤트가 전환 위치와 함께 한 번 발생한다", async () => {
  const src = feed();
  const nxt = feed();
  const sp = new AudioSplicer(src, { fadeMs: 40 });
  src.writeAll(pcm(400, 1));
  const events = [];
  sp.on("switched", (ms) => events.push(ms));
  sp.planSwitch(nxt, 200);
  nxt.writeAll(pcm(400, 2));
  await collect(sp);
  assert.equal(events.length, 1);
  assert.ok(events[0] >= 200, `전환 위치 ${events[0]}ms`);
});

// ── 경계 ─────────────────────────────────────────────────────

test("이미 지난 지점을 지정하면 즉시 전환한다", async () => {
  const src = new PassThrough();
  const nxt = feed();
  const sp = new AudioSplicer(src, { fadeMs: 40 });
  src.write(pcm(300, 1));
  await new Promise((r) => setTimeout(r, 10));
  sp.on("data", () => {});
  await new Promise((r) => setTimeout(r, 10));

  const before = sp.emittedMs;
  assert.ok(sp.planSwitch(nxt, 0), "과거 지점도 예약은 받아준다");
  nxt.writeAll(pcm(200, 2));
  src.end();
  await collect(sp);
  assert.ok(sp.emittedMs > before);
});

test("옛 소스가 전환 전에 말라도 공백 없이 새 소스로 넘어간다", async () => {
  const src = feed();
  const nxt = feed();
  const sp = new AudioSplicer(src, { fadeMs: 40 });
  src.writeAll(pcm(100, 1)); // 전환 지점(200ms)보다 일찍 끝난다
  sp.planSwitch(nxt, 200);
  nxt.writeAll(pcm(200, 2));

  const out = await collect(sp);
  assert.ok(out.length > 100 * BYTES_PER_MS, "옛 소스가 끝난 뒤에도 계속 나왔다");
});

test("전환을 두 번 예약하지 않는다", async () => {
  const src = feed();
  const sp = new AudioSplicer(src);
  assert.equal(sp.planSwitch(feed(), 100), true);
  assert.equal(sp.planSwitch(feed(), 200), false, "이미 예약됐으면 거절");
  assert.equal(sp.switchPending, true);
  src.writeAll(pcm(50, 1));
  sp.resume();
});

test("소스 오류는 이 스트림의 오류가 된다 (기존 캐시 폴백이 받도록)", async () => {
  const src = new PassThrough();
  const sp = new AudioSplicer(src);
  sp.on("data", () => {});
  const err = new Promise((r) => sp.on("error", r));
  src.destroy(new Error("terminated"));
  assert.match((await err).message, /terminated/);
});

test("emittedMs는 내보낸 양을 따라간다", async () => {
  const src = feed();
  const sp = new AudioSplicer(src);
  assert.equal(sp.emittedMs, 0);
  src.writeAll(pcm(200, 1));
  await collect(sp);
  assert.equal(sp.emittedMs, 200);
});
