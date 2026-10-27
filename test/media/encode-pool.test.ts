// src/media/encode-pool.ts — 출력마다 세션을 열어 프레임을 워커에서 인코딩하고, 워커가 죽거나 멈추면 다른 워커로 옮겨 붙이는 풀
//
// 지키는 것: 기동하면 첫 워커가 libopus 를 불러 둔다. 세션의 패킷은 보낸 순서대로 하나씩 오고, drain() 은 이벤트 루프 없이 받는다.
// 해제한 세션에는 늦은 답이 오지 않는다. 워커가 죽거나 멈추면 그 세션들이 다른 워커에서 이어지고, 고장 난 워커에 보낸 박자는 무음으로 채워 빠짐 · 겹침이 없다.
// 워커를 늘려 옮길 때는 옛 워커의 답을 다 받은 뒤 옮겨 무음이 없다.
// 한 세션이 워커를 잇달아 죽이면 그 세션만 실패하고, 잇달아 죽으면 새 워커를 늦추며 그동안 새 세션은 encoder-unavailable 로 실패한다.
// 깊이 · 워커 늘리기 판단(decideDepth)과 워커 수 상한.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BroadcastChannel } from "worker_threads";
import { EncodePool, decideDepth, workerLimit, START_DEPTH, MAX_DEPTH, type EncodeSession } from "../../src/media/encode-pool.ts";
import { FRAME_BYTES } from "../../src/media/audio-splicer.ts";
import { codeOf } from "../../src/rules/error-kind.ts";

const FAULTY = new URL("../helpers/faulty-encode-worker.ts", import.meta.url);
const STUB = new URL("../helpers/stub-encode-worker.ts", import.meta.url);

function frame(amplitude = 12000) {
  const buf = Buffer.alloc(FRAME_BYTES);
  for (let i = 0, t = 0; i < buf.length; i += 4, t++) {
    const v = Math.round(amplitude * Math.sin((2 * Math.PI * 440 * t) / 48000));
    buf.writeInt16LE(v, i);
    buf.writeInt16LE(v, i + 2);
  }
  return buf;
}

function opened(pool: EncodePool) {
  const packets: Buffer[] = [];
  const errors: Error[] = [];
  const session: EncodeSession = pool.open({ onPacket: (p) => packets.push(p), onError: (e) => errors.push(e) });
  return { session, packets, errors };
}

async function until(done: () => boolean, what: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`기다리다 시간 초과: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function broadcast(what: "exit" | "hang") {
  const channel = new BroadcastChannel("faulty-encode-worker");
  channel.postMessage(what);
  channel.close();
}

test("기동하면 첫 워커가 libopus 를 불러 두고, 세션의 패킷이 보낸 만큼 온다", async () => {
  const pool = new EncodePool({ calibrateFrames: 10 });
  try {
    const started = await pool.start();
    assert.match(started.libopusVersion, /libopus/);
    assert.equal(started.workers, 1);
    const { session, packets, errors } = opened(pool);
    assert.equal(session.depth, START_DEPTH);
    for (let i = 0; i < 20; i++) session.send(frame(), 0.5);
    await until(() => packets.length === 20, "패킷 20개");
    assert.deepEqual(errors, []);
    assert.ok(packets.every((p) => Buffer.isBuffer(p) && p.length > 0));
    session.free();
  } finally {
    await pool.close();
  }
});

test("drain() 은 이벤트 루프를 거치지 않고 답을 받는다", async () => {
  const pool = new EncodePool({ calibrateFrames: 0 });
  try {
    await pool.start();
    const { session, packets } = opened(pool);
    session.send(frame(), 1);
    await until(() => packets.length === 1, "첫 패킷");
    session.send(frame(), 1);
    // 이 루프가 도는 동안 이벤트 루프는 돌지 않는다
    const deadline = Date.now() + 2000;
    while (packets.length < 2 && Date.now() < deadline) session.drain();
    assert.equal(packets.length, 2);
    session.free();
  } finally {
    await pool.close();
  }
});

test("해제한 세션에는 늦은 답이 오지 않고, 생성 중 해제해도 다음 세션이 된다", async () => {
  const pool = new EncodePool({ calibrateFrames: 0 });
  try {
    await pool.start();
    const first = opened(pool);
    for (let i = 0; i < 5; i++) first.session.send(frame(), 1);
    first.session.free();
    first.session.send(frame(), 1);
    await sleep(200);
    assert.equal(first.packets.length, 0);
    assert.deepEqual(first.errors, []);

    const second = opened(pool);
    second.session.send(frame(), 1);
    await until(() => second.packets.length === 1, "다음 세션의 패킷");
    second.session.free();
    assert.equal(pool.stats().sessions, 0);
  } finally {
    await pool.close();
  }
});

test("워커가 죽으면 세션이 새 워커로 옮겨 붙어 빠짐 · 겹침 없이 이어진다", async () => {
  const pool = new EncodePool({ workerUrl: FAULTY, maxWorkers: 2, calibrateFrames: 0 });
  try {
    await pool.start();
    const { session, packets, errors } = opened(pool);
    for (let i = 0; i < 5; i++) session.send(frame(), 1);
    await until(() => packets.length === 5, "죽기 전 패킷 5개");
    for (let i = 0; i < 5; i++) session.send(frame(), 1);
    broadcast("exit");
    await until(() => pool.stats().deaths === 1, "워커 죽음");
    for (let i = 0; i < 5; i++) session.send(frame(), 1);
    await until(() => packets.length >= 15, "옮긴 뒤 패킷");
    await sleep(100);
    assert.equal(packets.length, 15);
    assert.deepEqual(errors, []);
    session.free();
  } finally {
    await pool.close();
  }
});

test("답이 없는 워커는 멈춘 것으로 보고 내린 뒤 세션을 옮긴다", async () => {
  const pool = new EncodePool({ workerUrl: FAULTY, maxWorkers: 2, stallMs: 300, calibrateFrames: 0 });
  try {
    await pool.start();
    const { session, packets, errors } = opened(pool);
    session.send(frame(), 1);
    await until(() => packets.length === 1, "첫 패킷");
    broadcast("hang");
    await sleep(50);
    session.send(frame(), 1);
    await until(() => packets.length === 2, "멈춘 뒤 옮겨 받은 패킷", 3000);
    assert.equal(pool.stats().deaths, 1);
    assert.deepEqual(errors, []);
    session.free();
  } finally {
    await pool.close();
  }
});

test("한 세션이 워커를 잇달아 죽이면 그 세션만 실패하고, 잇달아 죽으면 새 워커를 늦추며 새 세션을 거절한다", async () => {
  const pool = new EncodePool({ workerUrl: FAULTY, maxWorkers: 2, calibrateFrames: 0 });
  try {
    await pool.start();
    // 워커를 죽이는 입력: 첫 프레임에 워커가 죽고(그 박자는 무음), 옮긴 워커도 다음 프레임에 죽는다
    const poison = opened(pool);
    poison.session.send(frame(), -1);
    await until(() => pool.stats().deaths === 1 && poison.packets.length === 1, "첫 죽음과 무음 하나");
    await until(() => pool.stats().workers.length === 1, "새 워커");
    poison.session.send(frame(), -1);
    await until(() => poison.errors.length === 1, "독이 든 세션의 실패");
    assert.match(poison.errors[0]?.message ?? "", /잇달아/);
    assert.equal(pool.stats().deaths, 2);

    const healthy = opened(pool);
    healthy.session.send(frame(), 1);
    await until(() => healthy.packets.length === 1, "다른 세션은 된다");
    healthy.session.free();

    // 60초 안의 세 번째 죽음: 새 워커를 늦춘다. 남은 워커가 없어 새 세션은 실패한다
    const third = opened(pool);
    third.session.send(frame(), -1);
    await until(() => third.errors.length === 1, "세 번째 죽음 뒤 실패");
    assert.equal(codeOf(third.errors[0]), "encoder-unavailable");
    assert.equal(pool.available(), false);
    const refused = opened(pool);
    await until(() => refused.errors.length === 1, "늦추는 동안 새 세션 거절");
    assert.equal(codeOf(refused.errors[0]), "encoder-unavailable");
  } finally {
    await pool.close();
  }
});

test("WASM 오류는 그 프레임의 세션만 실패시키고 다른 세션은 옮기며, 되풀이해도 새 워커를 늦추지 않는다", async () => {
  const pool = new EncodePool({ workerUrl: STUB, maxWorkers: 2, calibrateFrames: 0 });
  try {
    await pool.start();
    const other = opened(pool);
    other.session.send(frame(), 1);
    await until(() => other.packets.length === 1, "다른 세션의 첫 패킷");
    for (let round = 1; round <= 4; round++) {
      // 앞 판에서 내린 워커 대신 새 워커가 뜰 때까지(아래 동기 루프는 이벤트 루프를 돌리지 않는다)
      await until(() => pool.stats().workers.length > 0, "새 워커");
      const broken = opened(pool);
      broken.session.send(frame(), -2);
      // read() 안의 drain 에서 워커가 내려지는 길
      const deadline = Date.now() + 2000;
      while (!broken.errors.length && Date.now() < deadline) broken.session.drain();
      assert.match(broken.errors[0]?.message ?? "", /WASM/);
      assert.equal(pool.stats().deaths, round);
    }
    assert.equal(pool.available(), true);
    other.session.send(frame(), 1);
    await until(() => other.packets.length === 2, "옮겨 간 다른 세션의 패킷");
    assert.deepEqual(other.errors, []);
    other.session.free();
  } finally {
    await pool.close();
  }
});

test("워커가 늦고 늘릴 수 없으면 깊이를 올리고, 자리를 잡으면 머문다", async () => {
  const pool = new EncodePool({ workerUrl: STUB, maxWorkers: 1, calibrateFrames: 0 });
  try {
    await pool.start();
    const { session, packets, errors } = opened(pool);
    // voice 처럼 20ms 마다 하나를 꺼내고, 꺼내지 않은 것 + 보낸 것이 깊이가 되게 채운다. 워커는 프레임마다 18ms 걸린다(깊이 2 의 문턱 16ms 를 넘는다)
    let sent = 0;
    let used = 0;
    const timer = setInterval(() => {
      session.drain();
      if (packets.length > used) used++;
      while (sent - used < session.depth) {
        session.send(frame(), 18);
        sent++;
      }
    }, 20);
    const depths: number[] = [];
    for (let s = 0; s < 8; s++) {
      await sleep(1000);
      depths.push(session.depth);
    }
    clearInterval(timer);
    assert.deepEqual(errors, []);
    // 올린 순간 한꺼번에 보낸 프레임이 줄을 서 한 단계 더 오를 수 있다. 그 뒤로는 머문다
    const last = depths.slice(-3);
    assert.ok(last.every((d) => d === last[0]) && last[0] !== undefined && last[0] >= 3 && last[0] <= 4, `깊이 ${depths.join(",")}`);
    session.free();
  } finally {
    await pool.close();
  }
});

test("워커가 늦어 하나를 늘리면 새 워커가 활성 세션의 몫을 받는다", async () => {
  const pool = new EncodePool({ workerUrl: STUB, maxWorkers: 2, calibrateFrames: 0 });
  try {
    await pool.start();
    const streams = Array.from({ length: 4 }, () => ({ ...opened(pool), sent: 0, used: 0 }));
    // 세션마다 프레임에 18ms 라 워커 하나로는 따라가지 못한다
    const timer = setInterval(() => {
      for (const s of streams) {
        s.session.drain();
        if (s.packets.length > s.used) s.used++;
        while (s.sent - s.used < s.session.depth) {
          s.session.send(frame(), 18);
          s.sent++;
        }
      }
    }, 20);
    await until(() => pool.stats().workers.length === 2, "워커 늘리기", 5000);
    // 답을 기다리던 세션은 그 답을 다 받은 뒤 옮긴다
    await until(
      () =>
        pool
          .stats()
          .workers.map((w) => w.streams)
          .join() === "2,2",
      "몫 나누기",
      5000,
    );
    clearInterval(timer);
    for (const s of streams) {
      assert.deepEqual(s.errors, []);
      // 옮기면서 잃은 프레임이 없다(무음 패킷은 3바이트)
      assert.ok(s.packets.every((p) => p.length === 8));
      s.session.free();
    }
  } finally {
    await pool.close();
  }
});

test("응답이 깊이의 문턱에 가까우면 워커를 늘리고, 늘릴 수 없으면 깊이를 올리고, 상한이면 늦다고 본다", () => {
  const base = { depth: START_DEPTH, canGrow: true, contended: false, calm: 0 };
  assert.equal(decideDepth({ ...base, rttP99: 2 }), null);
  assert.equal(decideDepth({ ...base, rttP99: 17 }), "grow");
  assert.equal(decideDepth({ ...base, rttP99: 17, canGrow: false }), "deepen");
  // CPU 를 뺏기는 중에는 늘려도 경쟁만 커진다
  assert.equal(decideDepth({ ...base, rttP99: 17, contended: true }), "deepen");
  assert.equal(decideDepth({ ...base, rttP99: 200, depth: MAX_DEPTH, canGrow: false }), "slow");
  // 여유가 오래 이어져야 내린다
  assert.equal(decideDepth({ ...base, rttP99: 2, depth: 4, calm: 10 }), null);
  assert.equal(decideDepth({ ...base, rttP99: 2, depth: 4, calm: 180 }), "shallow");
  assert.equal(decideDepth({ ...base, rttP99: 2, calm: 1000 }), null);
});

test("워커 수 상한은 1 이상 8 이하다", () => {
  const { max } = workerLimit();
  assert.ok(max >= 1 && max <= 8, `상한 ${max}`);
});
