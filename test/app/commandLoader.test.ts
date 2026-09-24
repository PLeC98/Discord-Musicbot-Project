// src/app/commandLoader.js — 커맨드 로드 + 배포 (등록 요청은 가짜를 넘긴다, 실 배포 없음).
// 배포 지문은 임시 파일 사용 — 운영 database/deployed-commands.json 미접촉.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import type { RESTPostAPIApplicationCommandsJSONBody, RESTPutAPIApplicationCommandsResult } from "discord.js";
import type { PutCommands } from "../../src/app/commandLoader.ts";
import { codeOf } from "../../src/rules/errorKind.ts";
import { fake } from "../helpers/fake.ts";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-cmdhash-"));
let hashSeq = 0;
const freshHashPath = () => path.join(tmpDir, `hash-${hashSeq++}.json`);
after(() => fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 }));

// 등록 요청 가짜. 보낸 정의의 이름을 등록한 것으로 돌려준다
const echo: PutCommands = async (_route, body) => fake<RESTPutAPIApplicationCommandsResult>(body.map((c) => ({ name: c.name })));
let putImpl: PutCommands = echo;
let putCalls: Array<{ route: string; body: RESTPostAPIApplicationCommandsJSONBody[] }> = [];
const put: PutCommands = (route, body) => {
  putCalls.push({ route, body });
  return putImpl(route, body);
};

const { loadedCommands, definitions, deployCommands, deployErrorLines } = await import("../../src/app/commandLoader.ts");

// 명령 파일은 처음 필요할 때 읽는다(불러오기가 비동기)
let commands: RESTPostAPIApplicationCommandsJSONBody[] = [];
let loaded: Awaited<ReturnType<typeof loadedCommands>>;
before(async () => {
  loaded = await loadedCommands();
  commands = await definitions();
});
const config = (await import("../../config.ts")).default;

test("commands/ 의 명령 파일 전부가 유효한 정의(name/description)로 로드됨", () => {
  const fileCount = fs.readdirSync(path.join(import.meta.dirname, "..", "..", "commands")).filter((f) => f.endsWith(".js") || (f.endsWith(".ts") && !f.endsWith(".d.ts"))).length;
  assert.equal(commands.length, fileCount, "data/execute 누락으로 스킵되는 커맨드 파일이 없어야 함");
  for (const c of commands) {
    assert.equal(typeof c.name, "string");
    assert.ok(c.name.length > 0);
    assert.equal(typeof ("description" in c ? c.description : undefined), "string");
  }
});

test("등록용 목록과 배포용 정의가 같은 집합이다", () => {
  assert.equal(loaded.failures.length, 0, `로딩 실패: ${loaded.failures.map((f) => f.file).join(", ")}`);
  assert.equal(loaded.commands.length, commands.length);
});

test("커맨드 이름 중복 없음 (중복은 Discord 등록 시 덮어씀)", () => {
  const names = commands.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, `중복: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
});

test("deployCommands: 성공 경로 — 현재 로드된 세트 전체를 1회 PUT", async () => {
  putCalls = [];
  const result = await deployCommands({ hashPath: freshHashPath(), put });

  assert.ok(result.ok);
  assert.equal(result.skipped, false);
  assert.equal(result.count, commands.length);
  assert.deepEqual(result.names.sort(), commands.map((c) => c.name).sort());
  assert.equal(result.scope, config.discord.guildId ? "guild" : "global", "GUILD_ID 유무로 스코프 자동 선택");
  assert.equal(putCalls.length, 1);
  assert.deepEqual(putCalls[0].body, commands, "로드된 정의를 그대로 등록");
});

test("deployCommands: 정의 무변경 재기동은 PUT 생략, force는 항상 PUT (§2.3)", async () => {
  const hashPath = freshHashPath();
  putCalls = [];

  await deployCommands({ hashPath, put }); // 첫 배포 — 지문 기록
  const second = await deployCommands({ hashPath, put }); // 무변경 재기동 시뮬레이션
  assert.ok(second.ok);
  assert.equal(second.skipped, true);
  assert.equal(second.count, commands.length, "생략이어도 카운트/이름은 보고");
  assert.equal(putCalls.length, 1, "두 번째는 PUT 없음");

  const forced = await deployCommands({ hashPath, force: true, put }); // 대시보드 버튼/수동 스크립트
  assert.ok(forced.ok);
  assert.equal(forced.skipped, false);
  assert.equal(putCalls.length, 2, "force는 지문이 같아도 PUT");
});

test("deployCommands: 실패 시 던지지 않고 {ok:false, error} 반환 + 지문 미기록(다음 기동 재시도)", async () => {
  const hashPath = freshHashPath();
  putImpl = async () => {
    throw Object.assign(new Error("Missing Access"), { code: 50001 });
  };
  const result = await deployCommands({ hashPath, put });
  putImpl = echo;

  assert.ok(!result.ok);
  assert.equal(codeOf(result.error), 50001);
  assert.ok(["guild", "global"].includes(result.scope));

  putCalls = [];
  const retry = await deployCommands({ hashPath, put });
  assert.ok(retry.ok);
  assert.equal(retry.skipped, false, "실패는 배포된 것으로 기록되지 않음");
  assert.equal(putCalls.length, 1);
});

test("deployErrorLines: 50001은 초대 스코프 힌트 포함, 일반 오류는 1줄", () => {
  const hinted = deployErrorLines({ scope: "guild", error: Object.assign(new Error("Missing Access"), { code: 50001 }) });
  assert.equal(hinted.length, 3);
  assert.ok(hinted[1].includes("applications.commands"));

  const plain = deployErrorLines({ scope: "global", error: new Error("boom") });
  assert.equal(plain.length, 1);
  assert.ok(plain[0].includes("boom"));
});
