// src/dashboard/routes/guilds.ts — 서버 하나의 경로는 그 서버의 문맥에서 돈다(띄운 프로세스 · 새어 나온 오류가 그 서버로 간다)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";
import { fake } from "../helpers/fake.ts";
import { currentGuild } from "../../src/infra/guild-context.ts";
import type { PlayerStream } from "../../src/dashboard/player-stream.ts";

const { createGuildsRouter } = await import("../../src/dashboard/routes/guilds.ts");

const app = express();
app.use("/api/guilds", createGuildsRouter({ stream: fake<PlayerStream>({}) }));
// 서버 라우터들을 지나 맨 뒤에서 문맥을 본다(await 뒤에도)
app.use("/api/guilds", async (_req, res) => {
  await new Promise((resolve) => setTimeout(resolve, 1));
  res.json({ guild: currentGuild() });
});
const server = await listenForFetch(app);
after(() => server.close());

test("서버 경로는 그 서버 문맥, 응답이 끝나기 전 await 뒤에도", async () => {
  const at = async (path: string) => ((await (await fetch(`${baseUrl(server)}/api/guilds${path}`)).json()) as { guild: string | null }).guild;
  assert.equal(await at("/123/anything"), "123");
  assert.equal(currentGuild(), null, "요청 밖으로 새지 않는다");
});
