// dashboard/src/composables/bot-info.ts: 봇이 준비 전(이름이 비어 옴)이면 이름이 올 때까지 다시 읽어 그때마다 넘긴다. 첫 읽기의 실패만 호출부에 알린다

import { test } from "node:test";
import assert from "node:assert/strict";
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from "../../../dashboard/node_modules/axios/index.js";
import { followBotInfo } from "../../../dashboard/src/composables/bot-info.ts";
import type { BotInfo } from "../../../src/dashboard/contract/identity.ts";

const info = (name: string | null): BotInfo => ({ name, avatarUrl: name ? "https://cdn.example/a.webp" : null, sourceRepo: "r", projectRepo: "p", brandColor: "#000000", faviconVersion: 1 });
/** 부를 때마다 replies의 다음 것을 준다. Error면 실패 */
function serve(replies: Array<BotInfo | Error>) {
  let i = 0;
  const http = axios.create({
    adapter: async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      const next = replies[Math.min(i++, replies.length - 1)];
      if (next instanceof Error) throw next;
      return { data: next, status: 200, statusText: "OK", headers: {}, config };
    },
  });
  return { http, calls: () => i };
}

test("준비된 봇이면 한 번 읽고 끝낸다", async () => {
  const { http, calls } = serve([info("봇")]);
  const got: BotInfo[] = [];
  await followBotInfo((one) => got.push(one), { http });
  await new Promise((r) => setTimeout(r, 2500));
  assert.deepEqual(
    got.map((one) => one.name),
    ["봇"],
  );
  assert.equal(calls(), 1);
});

test("준비 전이면 이름이 올 때까지 다시 읽고, 그때마다 넘긴다", async () => {
  const { http } = serve([info(null), info("봇")]);
  const got: Array<string | null> = [];
  await followBotInfo((one) => got.push(one.name), { http });
  assert.deepEqual(got, [null]);
  await new Promise((r) => setTimeout(r, 2500));
  assert.deepEqual(got, [null, "봇"]);
});

test("첫 읽기가 실패하면 거부된다", async () => {
  const { http } = serve([new Error("offline")]);
  await assert.rejects(
    followBotInfo(() => undefined, { http }),
    /offline/,
  );
});
