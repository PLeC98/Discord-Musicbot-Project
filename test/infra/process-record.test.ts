// src/infra/process-registry.ts 의 기록 파일. 기동이 켜면 등록 · 해제 · 모두 내리기마다 지금 살아 있는 자식을 적는다(다음 기동이 남은 것을 정리한다).
// 켜기 전에는 쓰지 않는다. 이 파일은 프로세스마다 따로 돌아 레지스트리의 켜짐이 다른 테스트에 새지 않는다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as registry from "../../src/infra/process-registry.ts";
import type { ChildRecord } from "../../src/infra/process-registry.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "child-record-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const file = path.join(dir, "child-processes.json");
const read = () => JSON.parse(fs.readFileSync(file, "utf8")) as ChildRecord;

// 살아 있는 것처럼 보이는 자식(종료 코드 · 신호가 아직 없다). 실제 프로세스가 아니다
const fakeChild = (pid: number, spawnfile: string) => ({ pid, exitCode: null, signalCode: null, spawnfile });

test("켜기 전에는 등록해도 쓰지 않는다", () => {
  const release = registry.register(fakeChild(990_001, "C:/bin/ffmpeg.exe"), "ffmpeg:미리");
  assert.equal(fs.existsSync(file), false);
  release();
});

test("켜면 이 봇과 살아 있는 자식(실행 파일 이름 · 그룹 · 시작 시각)을 적고, 해제하면 뺀다", () => {
  registry.persistTo(file);
  assert.deepEqual(read().children, []);
  assert.equal(read().owner.pid, process.pid);

  const before = Date.now();
  const releaseA = registry.register(fakeChild(990_002, "C:\\Program Files\\node.exe"), "bgutil");
  const releaseB = registry.register(fakeChild(990_003, "/usr/bin/yt-dlp"), "yt-dlp", { group: true });
  const children = read().children;
  assert.deepEqual(
    children.map(({ pid, label, image, group }) => ({ pid, label, image, group })),
    [
      { pid: 990_002, label: "bgutil", image: "node", group: false },
      { pid: 990_003, label: "yt-dlp", image: "yt-dlp", group: true },
    ],
  );
  assert.ok(children.every((c) => c.startedAt >= before && c.startedAt <= Date.now()));

  releaseA();
  assert.deepEqual(
    read().children.map((c) => c.pid),
    [990_003],
  );
  releaseB();
  assert.deepEqual(read().children, []);
});
