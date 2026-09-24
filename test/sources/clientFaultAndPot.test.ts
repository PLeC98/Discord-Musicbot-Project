// 쿠키가 붙으면 쓸 수 있는 클라이언트 집합이 바뀐다. 그 경계에서 생기던 두 가지를 고정한다.
//
//  1. yt-dlp 가 건너뛴 클라이언트를 실패로 세면 안 된다. 돌아 본 적이 없기 때문이다.
//     연령 제한 영상 몇 편이면 주력 경로가 세션 내내 제외되고, 그때부터 평상시 재생까지 죽었다.
//  2. POToken 을 요구한 클라이언트 이름은 경고 본문에 적혀 온다. 우리가 지정한 값이 아니다.
//     연령 제한 영상에서는 우리가 고르지 않은 web_creator 가 yt-dlp 판단으로 끼어든다.

import { createRequire } from "node:module";

// 함수 안에서 부르는 것과 글자가 아닌 경로는 그대로 require 로
const require = createRequire(import.meta.url);

process.env.COOKIES_SOURCE = "";

import { test } from "node:test";
import assert from "node:assert/strict";
import type { LogRecord } from "../../src/infra/log/sink.ts";

const YouTube = await import("../../src/sources/youtube/index.ts");
const { NEEDS_POT } = await import("../../src/sources/youtube/clients.ts");
const sink = (await import("../../src/infra/log/sink.ts")).default;

// debug 로 흘리는 것까지 봐야 한다. 루트 레벨은 기동 코드가 올려 주므로 테스트에서 직접 올린다.
require("../../src/infra/log/logger.ts").level = "trace";

// 쿠키를 붙인 채 visionos 를 지정했을 때 실제로 오는 stderr
const SKIPPED = ['WARNING: [youtube] Skipping client "visionos" since it does not support cookies', "ERROR: [youtube] hc0ZDaAZQT0: Requested format is not available. Use --list-formats for a list of available formats"].join("\n");

// 연령 제한 영상을 POToken 없이 열 때 실제로 오는 경고
const POT_LINE = "WARNING: [youtube] hc0ZDaAZQT0: web_creator client https formats require a GVS PO Token which was not provided. They will be skipped as they may yield HTTP Error 403.";

const err = (stderr: string) => Object.assign(new Error(stderr), { stderr });

/** _inspectWarnings 가 남긴 레코드를 받아 온다(로그의 듣는 자리에 잠깐 붙는다) */
function capture(line: string, client: string | null) {
  const records: LogRecord[] = [];
  const listen = (r: LogRecord) => records.push(r);
  sink.destinations.push(listen);
  try {
    YouTube._inspectWarnings(line, client);
  } finally {
    sink.destinations.splice(sink.destinations.indexOf(listen), 1);
  }
  return records;
}

// ── 건너뛴 클라이언트 ─────────────────────────────────────────────────────

test("건너뛴 클라이언트는 실패로 세지 않는다", () => {
  const error = err(SKIPPED);
  assert.equal(YouTube.isSkippedClientError(error), true);
  assert.equal(YouTube.isClientFault(error), false, "돌아 본 적 없는 클라이언트를 제외 대상으로 세면 안 된다");
});

test("진짜 포맷 실패는 그대로 클라이언트 탓으로 본다", () => {
  // 건너뛴 흔적이 없으면 같은 메시지라도 판정이 달라야 한다
  assert.equal(YouTube.isClientFault(err("ERROR: [youtube] X: Requested format is not available")), true);
  assert.equal(YouTube.isClientFault(err("ERROR: [youtube] X: Only images are available for download")), true);
});

test("건너뛴 판정이 다른 분류를 건드리지 않는다", () => {
  const error = err(SKIPPED);
  assert.equal(YouTube.isVideoUnavailableError(error), false, "영상이 내려간 것으로 보면 자동재생이 곡을 영구히 버린다");
  assert.equal(YouTube.isStaleMediaError(error), false);
});

test("건너뛴 흔적이 없는 오류는 false", () => {
  assert.equal(YouTube.isSkippedClientError(err("ERROR: [youtube] X: Video unavailable")), false);
  assert.equal(YouTube.isSkippedClientError(null), false);
});

// ── POToken 경고 ─────────────────────────────────────────────────────────

test("POToken 을 요구한 클라이언트 이름은 경고 본문에서 읽는다", () => {
  // 우리가 무엇을 지정했든 경고를 낸 것은 web_creator 다
  for (const asked of [null, "web_embedded", "visionos"]) {
    const records = capture(POT_LINE, asked);
    const warned = records.filter((r) => r.level >= 40);
    assert.equal(warned.length, 0, `지정=${asked}: 알려진 특성인데 경고가 떴다`);
    assert.ok(
      records.some((r) => String(r.msg).includes("web_creator")),
      `지정=${asked}: 지정값이 아니라 web_creator 가 찍혀야 한다`,
    );
  }
});

test("web_creator 는 POToken 이 필요한 것으로 알려져 있다", () => {
  // 연령 제한 경로에서 yt-dlp 가 알아서 끼워 넣는 클라이언트다. 요구하는 것이 정상이다.
  assert.ok(NEEDS_POT.includes("web_creator"));
});

test("모르는 클라이언트가 요구하면 여전히 경고한다", () => {
  const records = capture("WARNING: [youtube] X: some_new_client client https formats require a GVS PO Token which was not provided.", null);
  const warned = records.filter((r) => r.level >= 40);
  assert.equal(warned.length, 1, "유튜브가 바뀐 신호는 계속 드러나야 한다");
  assert.ok(String(warned[0].msg).includes("some_new_client"));
});

test("클라이언트 이름이 없는 경고는 지정값으로 되돌아간다", () => {
  const records = capture("WARNING: [youtube] X: This format requires a PO Token which was not provided.", "tv_simply");
  assert.equal(records.filter((r) => r.level >= 40).length, 0, "tv_simply 는 알려진 특성이라 조용해야 한다");
});
