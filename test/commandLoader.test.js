"use strict";

// src/commandLoader.js — 커맨드 로드 + 배포 (REST.put은 프로토타입 패치로 목킹, 실 배포 없음).
// 배포 지문은 임시 파일 사용 — 운영 database/deployed-commands.json 미접촉.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { REST } = require("discord.js");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-cmdhash-"));
let hashSeq = 0;
const freshHashPath = () => path.join(tmpDir, `hash-${hashSeq++}.json`);
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

// commandLoader require 전에 패치 — deployCommands가 만드는 new REST() 인스턴스에 적용됨
const realPut = REST.prototype.put;
let putImpl = async (route, options) => options.body.map((c) => ({ name: c.name }));
let putCalls = [];
REST.prototype.put = function (route, options) {
  putCalls.push({ route, options });
  return putImpl(route, options);
};
after(() => {
  REST.prototype.put = realPut;
});

const { commands, deployCommands, deployErrorLines } = require("../src/commandLoader");
const config = require("../config");

test("loadCommandData: commands/*.js 전부가 유효한 정의(name/description)로 로드됨", () => {
  const fileCount = fs.readdirSync(path.join(__dirname, "..", "commands")).filter((f) => f.endsWith(".js")).length;
  assert.equal(commands.length, fileCount, "data/execute 누락으로 스킵되는 커맨드 파일이 없어야 함");
  for (const c of commands) {
    assert.equal(typeof c.name, "string");
    assert.ok(c.name.length > 0);
    assert.equal(typeof c.description, "string");
  }
});

test("loadCommandData: 커맨드 이름 중복 없음 (중복은 Discord 등록 시 덮어씀)", () => {
  const names = commands.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, `중복: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
});

test("deployCommands: 성공 경로 — 현재 로드된 세트 전체를 1회 PUT", async () => {
  putCalls = [];
  const result = await deployCommands({ hashPath: freshHashPath() });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.count, commands.length);
  assert.deepEqual(result.names.sort(), commands.map((c) => c.name).sort());
  assert.equal(result.scope, config.discord.guildId ? "guild" : "global", "GUILD_ID 유무로 스코프 자동 선택");
  assert.equal(putCalls.length, 1);
  assert.equal(putCalls[0].options.body, commands, "로드된 배열을 그대로 등록");
});

test("deployCommands: 정의 무변경 재기동은 PUT 생략, force는 항상 PUT (§2.3)", async () => {
  const hashPath = freshHashPath();
  putCalls = [];

  await deployCommands({ hashPath }); // 첫 배포 — 지문 기록
  const second = await deployCommands({ hashPath }); // 무변경 재기동 시뮬레이션
  assert.equal(second.ok, true);
  assert.equal(second.skipped, true);
  assert.equal(second.count, commands.length, "생략이어도 카운트/이름은 보고");
  assert.equal(putCalls.length, 1, "두 번째는 PUT 없음");

  const forced = await deployCommands({ hashPath, force: true }); // 대시보드 버튼/수동 스크립트
  assert.equal(forced.skipped, false);
  assert.equal(putCalls.length, 2, "force는 지문이 같아도 PUT");
});

test("deployCommands: 실패 시 던지지 않고 {ok:false, error} 반환 + 지문 미기록(다음 기동 재시도)", async () => {
  const hashPath = freshHashPath();
  putImpl = async () => {
    throw Object.assign(new Error("Missing Access"), { code: 50001 });
  };
  const result = await deployCommands({ hashPath });
  putImpl = async (route, options) => options.body.map((c) => ({ name: c.name }));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 50001);
  assert.ok(["guild", "global"].includes(result.scope));

  putCalls = [];
  const retry = await deployCommands({ hashPath });
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
