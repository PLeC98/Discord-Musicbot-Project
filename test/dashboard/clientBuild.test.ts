// dashboard/client 빌드(파일은 쓰지 않는다). 봇과 같이 쓰는 안내가 브라우저 번들에 들어가고, Node 에 기대는 자리(rules/pronunciations.ts)는
// 브라우저 판으로 바뀌며, 발음 사전은 따로 받는 조각인지 본다. 공유 모듈을 고치면 봇 시험이 다 지나도 화면 번들이 깨질 수 있어 여기서 잡는다

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const CLIENT = path.join(import.meta.dirname, "..", "..", "dashboard", "client");
// vite 는 화면 쪽 의존이다. 화면의 package.json 에서 찾는다
const VITE = pathToFileURL(createRequire(path.join(CLIENT, "package.json")).resolve("vite")).href;

type Chunk = { type: "chunk" | "asset"; fileName: string; code?: string; isDynamicEntry?: boolean };

test("화면 빌드: 공유 안내가 들어가고 Node 판은 없으며, 발음 사전은 따로 받는 조각", async () => {
  const { build } = (await import(VITE)) as { build: (config: object) => Promise<{ output: Chunk[] } | Array<{ output: Chunk[] }>> };
  const result = await build({ root: CLIENT, configFile: path.join(CLIENT, "vite.config.js"), logLevel: "silent", build: { write: false } });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap((one) => one.output).filter((one) => one.type === "chunk");

  assert.deepEqual(
    chunks.filter((one) => /createRequire|node:module/.test(one.code ?? "")).map((one) => one.fileName),
    [],
    "Node 판 발음 사전이 번들에 없다",
  );
  assert.ok(
    chunks.some((one) => (one.code ?? "").includes("must-be-in-voice")),
    "문제 코드 목록 · 안내가 번들에 있다",
  );
  const dictionary = chunks.filter((one) => (one.code ?? "").includes("zyuganov"));
  assert.equal(dictionary.length, 1, "발음 사전은 한 조각에만");
  assert.equal(dictionary[0].isDynamicEntry, true, "발음 사전은 따로 받는 조각");
});
