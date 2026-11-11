// src/infra/guild-context.ts: 서버 문맥이 타이머, 약속, await 를 따라가고, 묶은 리스너는 쏜 쪽과 상관없이 그 서버로 돈다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { inGuild, currentGuild, bindToGuild } from "../../src/infra/guild-context.ts";

const tick = () => new Promise((done) => setTimeout(done, 1));

test("문맥 밖이면 null. 문맥 안의 타이머, await 뒤에도 그 서버다", async () => {
  assert.equal(currentGuild(), null);
  const seen: Array<string | null> = [];
  await inGuild("g1", async () => {
    seen.push(currentGuild());
    await tick();
    seen.push(currentGuild());
    await new Promise<void>((done) =>
      setTimeout(() => {
        seen.push(currentGuild());
        done();
      }, 1),
    );
  });
  assert.deepEqual(seen, ["g1", "g1", "g1"]);
  assert.equal(currentGuild(), null);
});

test("리스너는 쏜 쪽의 문맥에서 불린다. 걸 때 묶으면 쏜 쪽과 상관없이 그 서버다", () => {
  const bus = new EventEmitter();
  const seen: Array<string | null> = [];
  inGuild("g1", () => bus.on("plain", () => seen.push(`plain:${currentGuild()}`)));
  bus.on(
    "bound",
    bindToGuild("g1", () => seen.push(`bound:${currentGuild()}`)),
  );
  inGuild("g2", () => {
    bus.emit("plain");
    bus.emit("bound");
  });
  assert.deepEqual(seen, ["plain:g2", "bound:g1"]);
});

// 새어 나온 오류를 받는 곳(app/resilience)처럼 그 순간의 서버 문맥을 적는다. 테스트 실행기가 오류로 세지 않게 잡아 둔다
async function captureUncaught(run: () => void | Promise<void>) {
  const seen: Array<{ message: string; guild: string | null }> = [];
  process.setUncaughtExceptionCaptureCallback((error) => seen.push({ message: (error as Error).message, guild: currentGuild() }));
  try {
    await run();
    await new Promise((done) => setImmediate(done));
  } finally {
    process.setUncaughtExceptionCaptureCallback(null);
  }
  return seen;
}

test("묶은 리스너가 동기로 던지면 쏜 쪽으로 넘기지 않고(뒤의 리스너도 돈다) 그 서버 문맥에서 따로 던진다", async () => {
  const bus = new EventEmitter();
  let after = false;
  bus.on(
    "tick",
    bindToGuild("A", () => {
      throw new Error("A의 리스너 오류");
    }),
  );
  bus.on("tick", () => (after = true));
  const seen = await captureUncaught(() => inGuild("B", () => assert.doesNotThrow(() => bus.emit("tick"))));
  assert.equal(after, true);
  assert.deepEqual(seen, [{ message: "A의 리스너 오류", guild: "A" }]);
});

test("음성 라이브러리의 공용 오디오 루프: 한 플레이어의 상태 리스너가 던져도 다른 서버의 재생이 멈추지 않는다", async () => {
  const { createAudioPlayer, createAudioResource, NoSubscriberBehavior, StreamType, AudioPlayerStatus } = await import("@discordjs/voice");
  const { Readable } = await import("node:stream");
  const frames = (n: number) => {
    let i = 0;
    return new Readable({
      objectMode: true,
      read() {
        this.push(i++ < n ? Buffer.alloc(3, 1) : null);
      },
    });
  };
  const player = () => createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  const b = player();
  const a = player();
  const seen = await captureUncaught(async () => {
    inGuild("B", () => b.play(createAudioResource(frames(100_000), { inputType: StreamType.Opus })));
    inGuild("A", () => {
      a.once(
        AudioPlayerStatus.Idle,
        bindToGuild("A", () => {
          throw new Error("A의 Idle 리스너 오류");
        }),
      );
      a.play(createAudioResource(frames(25), { inputType: StreamType.Opus }));
    });
    await new Promise((done) => setTimeout(done, 1500));
  });
  const played = b.state.status === AudioPlayerStatus.Playing ? b.state.resource.playbackDuration : 0;
  a.stop(true);
  b.stop(true);
  assert.ok(played > 1000, `B 가 ${played}ms 만 재생했다(루프가 멈췄다)`);
  assert.deepEqual(seen, [{ message: "A의 Idle 리스너 오류", guild: "A" }]);
});
