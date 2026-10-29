// discord.js: async 이벤트 리스너에서 새어 나온 rejection은 unhandledRejection이 아니라 client "error"로 온다.
// src/app/resilience.ts 가 client "error" 리스너를 거는 전제다. 디스코드 라이브러리 업그레이드 등으로 이 전제가 깨지면
// 리스너 하나의 rejection이 그 리스너를 거치지 않고 프로세스 수준 오류로 샌다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, Events } from "discord.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

test('async 리스너의 rejection은 unhandledRejection이 아니라 client "error"로 온다', async () => {
  const client = new Client({ intents: [] });
  try {
    const seen: Error[] = [];
    client.on(Events.Error, (error) => seen.push(error));
    client.on("probe", async () => {
      throw new Error("listener boom");
    });

    client.emit("probe");
    await tick();

    assert.equal(seen.length, 1);
    assert.equal(seen[0].message, "listener boom");
  } finally {
    await client.destroy();
  }
});
