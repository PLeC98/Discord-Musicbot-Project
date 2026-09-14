"use strict";

// src/moduleLoader.js — 디렉터리가 없는 것과 파일이 깨진 것을 구분한다.
//
// 회귀(감사 M-06): 로더가 루프 전체를 하나의 try/catch로 감싸 어떤 오류든 "디렉터리가 없습니다"로
// 기록했다. 파일 하나의 문법 오류가 뒤쪽 로딩을 중단시키는데 봇은 그대로 로그인했다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadModules } = require("../src/moduleLoader");

function tmpModules(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "modload-"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

test("깨진 파일 하나가 나머지를 막지 않고, 이름과 함께 실패로 남는다", () => {
  const dir = tmpModules({
    "a.js": "module.exports = { name: 'a' };",
    "broken.js": "module.exports = { name: ",
    "b.js": "module.exports = { name: 'b' };",
    "readme.md": "무시 대상",
  });

  const { modules, failures, missing } = loadModules(dir);

  assert.equal(missing, false);
  assert.deepEqual(modules.map((m) => m.module.name).sort(), ["a", "b"], "깨진 파일 뒤의 것도 실린다");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].file, "broken.js");
  assert.ok(failures[0].error, "무엇이 잘못됐는지 함께 남긴다");
});

test("디렉터리가 없으면 실패가 아니라 missing", () => {
  const { modules, failures, missing } = loadModules(path.join(os.tmpdir(), "없는-디렉터리-" + process.pid));
  assert.equal(missing, true);
  assert.deepEqual(modules, []);
  assert.deepEqual(failures, []);
});

test("빈 디렉터리는 그냥 빈 결과", () => {
  const { modules, failures, missing } = loadModules(tmpModules({}));
  assert.equal(missing, false);
  assert.deepEqual(modules, []);
  assert.deepEqual(failures, []);
});
