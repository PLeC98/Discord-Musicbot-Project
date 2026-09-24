// src/media/audioSplicer.ts — 재생을 끊지 않고 소스를 갈아끼우는 스트림
//
// 지키는 것: 전환 전후로 한 바이트도 새지 않고, 지정한 지점에서 갈아타며,
// 크로스페이드 구간 밖은 원본과 완전히 같다. 소스가 끝나면 이 스트림도 끝난다
// (안 끝나면 AudioPlayer가 Idle로 못 가 트랙이 영영 안 넘어간다).

import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough, type Readable } from "stream";
import { AudioSplicer, BYTES_PER_MS, FRAME_BYTES } from "../../src/media/audioSplicer.ts";

// 위치마다 값이 다른 PCM — 어긋나면 바로 드러난다. mark로 소스를 구분한다.
function pcm(ms: number, mark: number) {
  const buf = Buffer.alloc(ms * BYTES_PER_MS);
  for (let i = 0; i < buf.length; i += 2) buf.writeInt16LE(((i / 2 + mark * 1000) % 20000) - 10000, i);
  return buf;
}

function feed(chunkMs = 100) {
  const s = new PassThrough();
  const writeAll = (buf: Buffer) => {
    for (let o = 0; o < buf.length; o += chunkMs * BYTES_PER_MS) s.write(buf.subarray(o, o + chunkMs * BYTES_PER_MS));
    s.end();
  };
  return Object.assign(s, { writeAll });
}

const collect = (s: Readable) =>
  new Promise<Buffer>((resolve, reject) => {
    const cs: Buffer[] = [];
    s.on("data", (c: Buffer) => cs.push(c));
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
  const b = pcm(400, 2);
  nxt.writeAll(b); // 미리 채워둔다 — 늦지 않으므로 전환 지점을 밀 일이 없다
  sp.planSwitch(nxt, switchAt);

  const out = await collect(sp);
  assert.equal(sp.slips, 0, "새 소스가 준비돼 있으면 밀지 않는다");
  const after = (switchAt + fadeMs) * BYTES_PER_MS;
  const tail = out.subarray(after, after + 50 * BYTES_PER_MS);
  assert.deepEqual(tail, b.subarray(fadeMs * BYTES_PER_MS, (fadeMs + 50) * BYTES_PER_MS));
});

test("새 소스가 늦으면 전환 지점을 뒤로 밀되 되풀이를 만들지 않는다", async () => {
  // 새 소스는 고정 위치로 seek돼 있고 우리 시계만 흐른다. 민 만큼 새 소스 앞을 버리지 않으면
  // 민 길이가 그대로 되풀이해 들린다.
  const src = new PassThrough();
  const nxt = new PassThrough();
  const sp = new AudioSplicer(src, { fadeMs: 40 });
  const cueAt = 200; // nxt는 200ms 지점부터의 오디오
  const b = pcm(600, 2);
  src.end(pcm(600, 1));

  let switchedAt: number | null = null;
  sp.on("switched", (ms: number) => (switchedAt = ms));
  sp.planSwitch(nxt, cueAt); // 이 시점에 nxt는 비어 있다 → 민다

  const out: Buffer[] = [];
  sp.on("data", (c: Buffer) => out.push(c));
  await new Promise((r) => setTimeout(r, 30));
  nxt.end(b); // 뒤늦게 도착
  await new Promise((r) => sp.on("end", r));

  assert.ok(sp.slips > 0, "실제로 밀렸다");
  assert.equal(sp.bDebt, 0, "민 만큼 전부 갚았다");

  // 불변식: 전환 뒤 출력 위치 P의 내용 == 새 소스의 (P - cueAt) 위치
  const merged = Buffer.concat(out);
  assert.ok(switchedAt !== null, "전환하지 않았다");
  for (const p of [switchedAt + 60, switchedAt + 120]) {
    const got = merged.subarray(p * BYTES_PER_MS, (p + 40) * BYTES_PER_MS);
    const exp = b.subarray((p - cueAt) * BYTES_PER_MS, (p - cueAt + 40) * BYTES_PER_MS);
    assert.deepEqual(got, exp, `${p}ms 지점이 어긋났다 — 민 만큼 되풀이됐다는 뜻`);
  }
});

test("전환 예약을 밀지 않으면 slips는 0이다", async () => {
  const src = feed();
  const sp = new AudioSplicer(src);
  src.writeAll(pcm(100, 1));
  await collect(sp);
  assert.equal(sp.slips, 0);
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
  const events: number[] = [];
  sp.on("switched", (ms: number) => events.push(ms));
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

test("한 바이트도 못 내보낸 채 옛 소스가 끝나도 예약된 소스로 넘어간다 (재생 시작 전 끊김)", async () => {
  const src = new PassThrough();
  const nxt = feed();
  const sp = new AudioSplicer(src, { fadeMs: 40 });
  sp.planSwitch(nxt, 2000);
  nxt.writeAll(pcm(200, 2));
  src.end();
  assert.deepEqual(await collect(sp), pcm(200, 2));
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

test("굶었다 깨어나기를 반복해도 리스너가 쌓이지 않는다", async () => {
  // _await가 한쪽으로 깨어날 때 반대쪽을 안 떼면 매번 하나씩 남아 MaxListeners 경고가 난다.
  const src = new PassThrough();
  const sp = new AudioSplicer(src);
  sp.on("data", () => {});
  for (let i = 0; i < 30; i++) {
    src.write(pcm(20, 1));
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(src.listenerCount("end") <= 2, `end 리스너 ${src.listenerCount("end")}개`);
  assert.ok(src.listenerCount("readable") <= 2, `readable 리스너 ${src.listenerCount("readable")}개`);
  sp.destroy();
});

test("파괴하면 두 소스도 파괴된다 (ffmpeg 좀비 방지)", () => {
  // voice가 리소스를 버릴 때 pipeline이 파괴를 역전파하는데, 그 사슬이 여기서 끊기면
  // ffmpeg의 stdout이 닫히지 않아 spawnFfmpeg의 killOnStdoutClose가 안 걸린다.
  const src = new PassThrough();
  const nxt = new PassThrough();
  const sp = new AudioSplicer(src);
  sp.planSwitch(nxt, 1000);
  sp.destroy();
  assert.equal(src.destroyed, true, "첫 소스");
  assert.equal(nxt.destroyed, true, "갈아탈 소스");
});

test("전환을 마친 뒤 옛 소스가 오류를 내도 재생이 죽지 않는다", async () => {
  // _completeSwitch가 옛 소스를 파괴하는데, 오류 핸들러가 붙은 채면 그 파괴가
  // 방금 성공한 전환을 같이 죽인다.
  const src = new PassThrough();
  const nxt = new PassThrough();
  const sp = new AudioSplicer(src, { fadeMs: 40 });
  src.write(pcm(400, 1));
  nxt.write(pcm(400, 2));
  sp.on("data", () => {});
  sp.planSwitch(nxt, 100);
  await new Promise((r) => setTimeout(r, 20));

  // 핸들러를 떼기만 하면 듣는 사람이 없어져 uncaughtException이 된다 — 흡수기로 갈아끼워야 한다
  assert.ok(src.listenerCount("error") > 0, "흡수기가 남아 있다");
  src.emit("error", new Error("늦게 터진 옛 소스")); // 던지지 않아야 한다
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sp.destroyed, false, "전환된 재생은 살아 있어야 한다");
  sp.destroy();
});

test("이미 끝난 뒤의 전환 예약은 거절한다 (EOF 뒤 push 방지)", async () => {
  const src = new PassThrough();
  const sp = new AudioSplicer(src);
  src.end(pcm(40, 1));
  await collect(sp);

  const nxt = feed();
  nxt.writeAll(pcm(40, 2));
  assert.equal(sp.planSwitch(nxt, 0), false);
  assert.equal(sp.switchPending, false);
  await new Promise((r) => setTimeout(r, 20)); // 던지지 않는다
});

test("소스 오류는 이 스트림의 오류가 된다 (기존 캐시 폴백이 받도록)", async () => {
  const src = new PassThrough();
  const sp = new AudioSplicer(src);
  sp.on("data", () => {});
  const err = new Promise<Error>((r) => sp.on("error", r));
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
