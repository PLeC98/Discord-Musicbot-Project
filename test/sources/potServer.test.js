"use strict";

// src/sources/youtube/potServer.js — bgutil POToken 서버를 띄우고 지키기.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { withConfig } = require("../helpers/config");
const potServer = require("../../src/sources/youtube/potServer");

test("토큰은 로그에 남기지 않는다", () => {
  assert.equal(potServer.scrubBgutilLine("Generated IntegrityToken: abc.def-123"), "Generated IntegrityToken: [REDACTED]");
  assert.equal(potServer.scrubBgutilLine('{"poToken":"AAAAAAAAAAAAAAAA"}'), '{"poToken":"[REDACTED]"}');
  assert.equal(potServer.scrubBgutilLine("integrityToken=Zz9_zz9-zz9"), "integrityToken=[REDACTED]");
  assert.equal(potServer.scrubBgutilLine("poToken: short"), "poToken: short", "여덟 글자보다 짧으면 토큰이 아니다");
  assert.equal(potServer.scrubBgutilLine("서버 시작"), "서버 시작");
});

test("꺼져 있으면 띄우지 않고, 띄운 것이 없으면 준비를 기다리지 않는다", async () => {
  await withConfig({ bgutil: { enabled: false } }, async () => {
    potServer.startBgutilServer();
    assert.equal(await potServer.waitForBgutilReady(10), true);
  });
  potServer.stopBgutilServer(); // 띄운 것이 없어도 된다
});
