// dashboard 빌드(파일은 쓰지 않는다). 봇과 같이 쓰는 안내가 브라우저 번들에 들어가고, 조사 헬퍼는 발음 사전 전체가 아니라 작은 표(data/english-finals.json)를
// 싣는지 본다. 공유 모듈을 고치면 봇 테스트가 다 지나도 화면 번들이 깨질 수 있어 여기서 잡는다

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { BUILD_INPUTS, type BuildInputs } from "../../src/dashboard/client-freshness.ts";

const CLIENT = path.join(import.meta.dirname, "..", "..", "dashboard");
// vite 는 화면 쪽 의존이다. 화면의 package.json 에서 찾는다
const VITE = pathToFileURL(createRequire(path.join(CLIENT, "package.json")).resolve("vite")).href;

type Chunk = { type: "chunk" | "asset"; fileName: string; code?: string; source?: string | Uint8Array; isDynamicEntry?: boolean };
// vite 가 크기 경고를 내는 한도(build.chunkSizeWarningLimit 기본, kB)
const WARN_KB = 500;

test("화면 빌드: 공유 안내와 영어 끝소리 표가 들어가고, Node 모듈 · 발음 사전 전체는 없으며, 크기 경고를 낼 청크가 없다", async () => {
  const { build } = (await import(VITE)) as { build: (config: object) => Promise<{ output: Chunk[] } | Array<{ output: Chunk[] }>> };
  // 배포 번들을 본다. vite 는 NODE_ENV 가 이미 있으면 따르므로(CI 는 test) 빌드하는 동안만 production 으로 둔다
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const result = await build({ root: CLIENT, configFile: path.join(CLIENT, "vite.config.ts"), logLevel: "silent", build: { write: false } }).finally(() => {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap((one) => one.output);
  const chunks = output.filter((one) => one.type === "chunk");

  // 봇이 옛 빌드를 알아보는 목록: 화면 소스와 화면이 부르는 봇 모듈이 들고, 바깥 패키지는 없다
  const inputs = output.find((one) => one.fileName === BUILD_INPUTS);
  assert.ok(inputs, "빌드가 소스 목록을 남긴다");
  const { builtAt, files } = JSON.parse(String(inputs.source)) as BuildInputs;
  assert.ok(builtAt > 0);
  assert.ok(files.includes("dashboard/src/main.ts") && files.includes("src/rules/controls.ts"), "화면 소스와 화면이 부르는 봇 모듈");
  assert.deepEqual(
    files.filter((file) => file.includes("node_modules") || file.startsWith("..") || file.includes(String.fromCharCode(92))),
    [],
  );

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
