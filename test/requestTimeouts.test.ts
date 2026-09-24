// 외부 호출에 마감이 붙어 있는지 호출부 단위로 확인한다.
// 값 자체(10초 등)가 아니라 "마감 없는 호출이 새로 들어오는 것"을 막는 게 목적이다.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const read = (rel: string) => fs.readFileSync(path.join(import.meta.dirname, "..", rel), "utf8");

// src에서 `name(...)` 호출을 괄호 균형으로 잘라낸다 (인자가 여러 줄이어도 통째로 잡기 위해).
function callSites(src: string, name: string) {
  const out: string[] = [];
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

test("Spotify의 모든 요청에 중단 신호가 붙어 있다", () => {
  const src = read("src/sources/spotify.ts");
  // 요청은 모두 바깥 경계(send)로 나간다. fetch 를 바로 부르면 시험이 넘긴 가짜도 마감 검사도 비껴간다
  assert.deepEqual(callSites(src, "fetch"), [], "fetch 를 바로 부르는 곳");
  const calls = callSites(src, "send");
  assert.ok(calls.length >= 8, `호출부를 찾지 못했다 (${calls.length}개)`);
  for (const call of calls) {
    assert.match(call, /signal: AbortSignal\.timeout\(/, `마감 없는 요청: ${call.slice(0, 70)}`);
  }
});

test("OAuth 콜백은 타임아웃이 걸린 axios 인스턴스로만 나간다", () => {
  const src = read("dashboard/server/routes/auth.ts");
  assert.match(src, /axios\.create\(\{ timeout: \d+ \}\)/);
  const bare = callSites(src, "axios.post").concat(callSites(src, "axios.get"));
  assert.deepEqual(bare, [], "모듈 기본 axios는 타임아웃이 없다 — http 인스턴스를 쓸 것");
});
