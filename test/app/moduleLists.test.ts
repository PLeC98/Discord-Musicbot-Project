// commands/index · events/index — 명령 · 이벤트 처리기는 폴더를 읽지 않고 목록으로 모은다.
// 새 파일을 만들고 목록에 넣지 않으면 등록되지 않는다. 폴더의 파일 전부가 목록에 있는지 본다

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { useExampleConfig } from "../helpers/exampleConfig.ts";

useExampleConfig();
const ROOT = path.join(import.meta.dirname, "..", "..");
const { COMMANDS } = await import("../../commands/index.ts");
const { EVENTS } = await import("../../events/index.ts");

// 폴더의 모듈 파일(목록 파일은 뺀다)과 그 기본 내보내기
async function modulesIn(dir: string) {
  const files = fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && f !== "index.ts");
  return Promise.all(files.map(async (file) => ({ file, module: (await import(pathToFileURL(path.join(ROOT, dir, file)).href)).default as unknown })));
}

for (const [dir, list] of [
  ["commands", COMMANDS],
  ["events", EVENTS],
] as Array<[string, readonly unknown[]]>) {
  test(`${dir}/ 의 파일은 모두 목록에 있고, 목록에는 그 파일들만 있다`, async () => {
    const found = await modulesIn(dir);
    const missing = found.filter(({ module }) => !list.includes(module)).map(({ file }) => file);
    assert.deepEqual(missing, [], "목록에 없는 파일");
    assert.equal(list.length, found.length, "목록에 폴더 밖의 것이 있거나 같은 것이 두 번 있다");
    assert.equal(new Set(list).size, list.length);
  });
}
