// src/rules/vertex-url.ts — 버텍스 AI 주소. 리전 · 프로젝트 · 모델 필드가 요청을 다른 호스트로 보내지 못하는지

import { test } from "node:test";
import assert from "node:assert/strict";
import { vertexChatUrl, vertexHost } from "../../src/rules/vertex-url.ts";
import { aiProblems } from "../../src/config/schema/ai.ts";

test("리전에 따라 지역 호스트 · global 호스트로 조립한다", () => {
  assert.equal(new URL(vertexChatUrl({ location: "us-central1" }, "my-proj", "gemini-3.8-flash")).href, "https://us-central1-aiplatform.googleapis.com/v1/projects/my-proj/locations/us-central1/publishers/google/models/gemini-3.8-flash:generateContent");
  assert.equal(vertexHost({ location: "" }), "aiplatform.googleapis.com");
  assert.equal(vertexHost(null), "aiplatform.googleapis.com");
});

test("리전 · 프로젝트 · 모델에 주소를 바꾸는 글자가 있어도 다른 호스트로 가지 않는다(접근 토큰이 실린다)", () => {
  for (const location of ["evil.example#", "evil.example/x?", "evil.example:443/", "user@evil.example/"]) {
    let host: string | null = null;
    try {
      host = new URL(vertexChatUrl({ location }, "p", "m")).host;
    } catch {
      // 주소가 깨져 요청이 나가지 않는 것도 막은 것이다
    }
    assert.ok(host === null || host.endsWith(".googleapis.com"), `${location} → ${host}`);
  }
  const url = new URL(vertexChatUrl({ location: "global" }, "p/../../x?", "m#frag"));
  assert.equal(url.host, "aiplatform.googleapis.com");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
});

test("설정 검사는 리전 이름이 아닌 값을 받지 않는다", () => {
  const base = { enabled: true, provider: "vertex", model: "gemini-3.8-flash" };
  assert.deepEqual(
    aiProblems({ ...base, location: "us-central1" }).filter((one) => /location/.test(one)),
    [],
  );
  assert.deepEqual(
    aiProblems({ ...base, location: "" }).filter((one) => /location/.test(one)),
    [],
  );
  assert.equal(aiProblems({ ...base, location: "evil.example#" }).filter((one) => /location/.test(one)).length, 1);
});
