// 봇 쪽 모듈을 전부 불러 본다.
//
// 옮기기만 하는 파일은 다른 테스트가 덜 덮어서, 경로가 깨져도 아무도 모를 수 있다. 폴더로 옮길 때 · ESM 으로 바꿀 때 ·
// .ts 로 바꿀 때 불러오기 실패를 여기서 먼저 잡는다. index.js 는 불러오는 순간 봇을 켜므로 뺀다(node --check 가 본다).

import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { createRequire } from "node:module";

// 함수 안에서 부르는 것과 글자가 아닌 경로는 그대로 require 로
const require = createRequire(import.meta.url);

const ROOT = path.join(import.meta.dirname, "..");
const DIRS = ["src", "commands", "events", path.join("dashboard", "server")];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(c?js|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");

test("불러올 파일이 있다(폴더를 잘못 가리키면 아무것도 안 불러 보고 통과한다)", () => {
  assert.ok(files.length >= 100, `${files.length}개`);
});

for (const file of files) {
  test(`불러오기: ${rel(file)}`, () => {
    const mod = require(file);
    assert.ok(mod !== undefined && mod !== null, "무언가를 내보낸다");
  });
}

test("명령은 data 와 execute 를, 이벤트는 name 과 execute 를 가진다", () => {
  for (const file of walk(path.join(ROOT, "commands"))) {
    const cmd = require(file);
    assert.ok(cmd.data?.name, `${rel(file)}: data.name`);
    assert.equal(typeof cmd.execute, "function", `${rel(file)}: execute`);
  }
  for (const file of walk(path.join(ROOT, "events"))) {
    const ev = require(file);
    assert.ok(ev.name, `${rel(file)}: name`);
    assert.equal(typeof ev.execute, "function", `${rel(file)}: execute`);
  }
});
