// dashboard/src/composables/volume-control.ts: 볼륨 슬라이더가 언제 보내는지. 서버가 받아들인 값 · 보내는 중인 값으로 구분한다

import { test } from "node:test";
import assert from "node:assert/strict";
import { useVolumeControl } from "../../../dashboard/src/composables/volume-control.ts";

// 서버(받아들이면 값이 바뀐다)와 보낸 기록. hold를 켜면 release를 부를 때까지 답하지 않는다. fail이면 거절한다.
// 보낼지는 서버 값을 그때그때 읽어 정하므로 서버 값은 반응형이 아니어도 된다
function setup(start = 50) {
  const server = { value: start as number | undefined };
  const sent: number[] = [];
  const notified: unknown[] = [];
  const net = { fail: false, hold: false, release: () => {} };
  const send = async (level: number) => {
    sent.push(level);
    if (net.hold) await new Promise<void>((done) => (net.release = done));
    if (net.fail) throw new Error("HTTP 503");
    server.value = level;
  };
  const control = useVolumeControl(server as unknown as Parameters<typeof useVolumeControl>[0], send, (error) => notified.push(error));
  return { server, sent, notified, net, control };
}

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((done) => setImmediate(done));
}

test("실패한 값을 다시 놓으면 다시 보낸다. 저절로 다시 보내지는 않는다", async () => {
  const { sent, notified, net, control } = setup();
  net.fail = true;
  control.change(60);
  await settle();
  assert.deepEqual(sent, [60]);
  assert.equal(notified.length, 1);
  assert.equal(control.shown.value, 50, "놓은 뒤에는 서버 값을 보인다");

  net.fail = false;
  control.change(60);
  await settle();
  assert.deepEqual(sent, [60, 60]);
  assert.equal(control.shown.value, 60);
});

// 드래그 끝에 같은 값으로 놓는 것(input 뒤 change)은 보내는 중인 요청이 맡는다. 그 요청이 실패해도 놓은 값을 따로 다시 보내지 않는다
test("보내는 중인 값과 같은 값을 놓으면 그 요청이 맡는다: 실패해도 다시 보내지 않는다", async () => {
  const { sent, notified, net, control } = setup();
  net.hold = true;
  net.fail = true;
  control.input(60);
  await settle();
  control.change(60);
  net.release();
  await settle();
  assert.deepEqual(sent, [60]);
  assert.equal(notified.length, 1);
  assert.equal(control.shown.value, 50);
});

test("서버가 이미 받아들인 값이면 보내지 않는다(바깥에서 바뀐 값 포함)", async () => {
  const { server, sent, control } = setup();
  control.change(50);
  await settle();
  assert.deepEqual(sent, []);

  server.value = 70; // 다른 화면 · 디스코드에서 바꿨다
  control.change(70);
  await settle();
  assert.deepEqual(sent, []);
  control.change(50);
  await settle();
  assert.deepEqual(sent, [50]);
});

test("보내는 중에 그 값으로 돌아오면(60 → 70 → 60) 더 보내지 않는다", async () => {
  const { sent, net, control } = setup();
  net.hold = true;
  control.input(60);
  await settle();
  control.input(70);
  control.change(60);
  assert.equal(control.shown.value, 60, "드래그 중인 값을 보인다");
  net.release();
  await settle();
  assert.deepEqual(sent, [60]);
  assert.equal(control.shown.value, 60);
});

test("보내는 중에 원래 서버 값으로 되돌리면 그 값을 보낸다. 앞 요청을 보낸 뒤 간격이 지나야 보낸다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { sent, net, control } = setup();
  net.hold = true;
  control.input(60);
  await settle();
  control.change(50); // 서버는 아직 50이지만 60이 받아들여지면 달라진다
  net.hold = false;
  net.release();
  await settle();
  assert.deepEqual(sent, [60]);
  t.mock.timers.tick(199);
  await settle();
  assert.deepEqual(sent, [60]);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(sent, [60, 50]);
  assert.equal(control.shown.value, 50);
});
