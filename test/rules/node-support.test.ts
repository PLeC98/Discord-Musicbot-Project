// src/rules/node-support.ts: 지금 Node 가 지원 범위(package.json 의 engines.node) 안인가, 밖이면 기동 경고 문장.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeSupportWarning, satisfiesNode } from "../../src/rules/node-support.ts";
import pkg from "../../package.json" with { type: "json" };

const RANGE = "^24.22.3 || >=26.13.1";

test("^ 는 같은 메이저에서 그 판 이상, >= 는 그 판 이상(뒤 메이저 포함)", () => {
  const cases: Array<[string, boolean]> = [
    ["24.22.3", true],
    ["24.23.0", true],
    ["24.22.2", false],
    ["24.3.0", false],
    ["22.23.5", false],
    ["25.9.0", false],
    ["26.13.0", false],
    ["26.13.1", true],
    ["27.0.0-alpha.0.0.0", true],
    ["v24.22.3", true],
  ];
  for (const [version, ok] of cases) assert.equal(satisfiesNode(version, RANGE), ok, version);
});

test("읽지 못하는 범위나 판이면 판단하지 않는다(경고하지 않는다)", () => {
  assert.equal(satisfiesNode("24.22.3", "~24.22.3"), null);
  assert.equal(satisfiesNode("24.22.3", ""), null);
  assert.equal(satisfiesNode("어떤 판", RANGE), null);
  assert.equal(nodeSupportWarning("24.0.0", "~24.22.3"), null);
});

test("범위 밖이면 지금 판과 지원 범위를 담은 경고, 안이면 없음", () => {
  assert.equal(nodeSupportWarning("24.22.3", RANGE), null);
  assert.equal(nodeSupportWarning("24.22.2", RANGE), "지원 범위 밖의 Node(지금 24.22.2, 지원 ^24.22.3 || >=26.13.1). 알려진 보안 취약점이 고쳐진 판으로 올리세요");
});

test("package.json 의 engines.node 는 이 모듈이 읽는 꼴이다(못 읽으면 기동 경고가 조용히 꺼진다)", () => {
  assert.notEqual(satisfiesNode("24.22.3", pkg.engines.node), null, pkg.engines.node);
});
