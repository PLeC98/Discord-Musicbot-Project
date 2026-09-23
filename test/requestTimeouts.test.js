"use strict";

// 외부 호출에 마감이 붙어 있는지 호출부 단위로 확인한다.
// 값 자체(10초 등)가 아니라 "마감 없는 호출이 새로 들어오는 것"을 막는 게 목적이다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// src에서 `name(...)` 호출을 괄호 균형으로 잘라낸다 (인자가 여러 줄이어도 통째로 잡기 위해).
function callSites(src, name) {
  const out = [];
  const re = new RegExp(`\\b${name.replace(".", "\\.")}\\(`, "g");
  let m;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

test("Spotify의 모든 fetch에 중단 신호가 붙어 있다", () => {
  const calls = callSites(read("src/sources/spotify.js"), "fetch");
  assert.ok(calls.length >= 8, `호출부를 찾지 못했다 (${calls.length}개)`);
  for (const call of calls) {
    assert.match(call, /signal: AbortSignal\.timeout\(/, `마감 없는 요청: ${call.slice(0, 70)}`);
  }
});

test("OAuth 콜백은 타임아웃이 걸린 axios 인스턴스로만 나간다", () => {
  const src = read("dashboard/server/routes/auth.js");
  assert.match(src, /axios\.create\(\{ timeout: \d+ \}\)/);
  const bare = callSites(src, "axios.post").concat(callSites(src, "axios.get"));
  assert.deepEqual(bare, [], "모듈 기본 axios는 타임아웃이 없다 — http 인스턴스를 쓸 것");
});
