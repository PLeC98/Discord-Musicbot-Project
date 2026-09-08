"use strict";

// discord.js 이벤트 리스너에서 새어나온 rejection이 어디로 가는지 — index.js의 client "error"
// 리스너가 존재해야 하는 이유를 고정한다. 이 전제가 깨지면(디스코드 라이브러리 업그레이드 등)
// 리스너 하나의 사소한 rejection이 uncaughtException을 거쳐 봇 전체 종료로 이어진다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Client, Events } = require("discord.js");

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

test('async 리스너의 rejection은 unhandledRejection이 아니라 client "error"로 온다', async () => {
  const client = new Client({ intents: [] });
  try {
    const seen = [];
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
