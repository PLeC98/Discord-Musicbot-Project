// dashboard 빌드(파일은 쓰지 않는다). 봇과 같이 쓰는 안내가 브라우저 번들에 들어가고, 조사 도우미는 발음 사전 전체가 아니라 작은 표(data/english-finals.json)를
// 싣는지 본다. 공유 모듈을 고치면 봇 시험이 다 지나도 화면 번들이 깨질 수 있어 여기서 잡는다

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const CLIENT = path.join(import.meta.dirname, "..", "..", "dashboard");
// vite 는 화면 쪽 의존이다. 화면의 package.json 에서 찾는다
const VITE = pathToFileURL(createRequire(path.join(CLIENT, "package.json")).resolve("vite")).href;

type Chunk = { type: "chunk" | "asset"; fileName: string; code?: string; isDynamicEntry?: boolean };
// vite 가 크기 경고를 내는 한도(build.chunkSizeWarningLimit 기본, kB)
const WARN_KB = 500;

test("화면 빌드: 공유 안내와 영어 끝소리 표가 들어가고, Node 모듈 · 발음 사전 전체는 없으며, 크기 경고를 낼 조각이 없다", async () => {
  const { build } = (await import(VITE)) as { build: (config: object) => Promise<{ output: Chunk[] } | Array<{ output: Chunk[] }>> };
  const result = await build({ root: CLIENT, configFile: path.join(CLIENT, "vite.config.js"), logLevel: "silent", build: { write: false } });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap((one) => one.output).filter((one) => one.type === "chunk");

  assert.deepEqual(
    chunks.filter((one) => /createRequire|node:module/.test(one.code ?? "")).map((one) => one.fileName),
    [],
    "Node 모듈을 부르는 코드가 번들에 없다",
  );
  assert.ok(
    chunks.some((one) => (one.code ?? "").includes("must-be-in-voice")),
    "문제 코드 목록 · 안내가 번들에 있다",
  );
  // aamodt 는 표에 있는 낱말, zyuganov 는 사전에만 있고 표에는 없는 낱말(철자 어림과 답이 같다)
  assert.ok(
    chunks.some((one) => (one.code ?? "").includes("aamodt")),
    "영어 끝소리 표가 번들에 있다",
  );
  assert.deepEqual(
    chunks.filter((one) => (one.code ?? "").includes("zyuganov")).map((one) => one.fileName),
    [],
    "발음 사전 전체는 번들에 없다",
  );
  assert.deepEqual(
    chunks.filter((one) => Buffer.byteLength(one.code ?? "") / 1000 > WARN_KB).map((one) => one.fileName),
    [],
  );
});
