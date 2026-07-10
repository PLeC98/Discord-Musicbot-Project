"use strict";

// src/commandLoader.js — 커맨드 로드 + 배포 (REST.put은 프로토타입 패치로 목킹, 실 배포 없음)

const fs = require("node:fs");
const path = require("node:path");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { REST } = require("discord.js");

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

const { commands, deployCommands, loadCommandData, deployErrorLines } = require("../src/commandLoader");
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
  const result = await deployCommands();

  assert.equal(result.ok, true);
  assert.equal(result.count, commands.length);
  assert.deepEqual(result.names.sort(), commands.map((c) => c.name).sort());
  assert.equal(result.scope, config.discord.guildId ? "guild" : "global", "GUILD_ID 유무로 스코프 자동 선택");
  assert.equal(putCalls.length, 1);
  assert.equal(putCalls[0].options.body, commands, "로드된 배열을 그대로 등록");
});

test("deployCommands: 실패 시 던지지 않고 {ok:false, error} 반환", async () => {
  putImpl = async () => {
    throw Object.assign(new Error("Missing Access"), { code: 50001 });
  };
  const result = await deployCommands();
  putImpl = async (route, options) => options.body.map((c) => ({ name: c.name }));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 50001);
  assert.ok(["guild", "global"].includes(result.scope));
});

test("deployErrorLines: 50001은 초대 스코프 힌트 포함, 일반 오류는 1줄", () => {
  const hinted = deployErrorLines({ scope: "guild", error: Object.assign(new Error("Missing Access"), { code: 50001 }) });
  assert.equal(hinted.length, 3);
  assert.ok(hinted[1].includes("applications.commands"));

  const plain = deployErrorLines({ scope: "global", error: new Error("boom") });
  assert.equal(plain.length, 1);
  assert.ok(plain[0].includes("boom"));
});
