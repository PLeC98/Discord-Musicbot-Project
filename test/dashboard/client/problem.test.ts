// dashboard/src/utils/problem.ts — 화면이 문제 응답을 글로 바꾸는 도우미. 문장은 봇과 같은 안내에서 코드로 고른다

import { test } from "node:test";
import assert from "node:assert/strict";
import { problemDetails, problemNotice, problemText, setReportUrl } from "../../../dashboard/src/utils/problem.ts";
import { problemBody } from "../../../src/dashboard/contract/problem.ts";
import { text } from "../../../dashboard/src/text/index.ts";

const failed = (data: unknown) => ({ response: { data } });

test("봇 쪽 거절은 디스코드와 같은 문장만(머리 줄 · 본문). 문장에 드는 값은 응답의 확장 칸에서 읽는다", () => {
  assert.equal(problemText(failed(problemBody("no-song")), "실패"), "재생 중인 곡이 없어요!\n이 조작을 하려면 재생 중인 곡이 있어야 해요.");
  assert.equal(problemText(failed(problemBody("queue-full", { max: 100 })), "실패"), "곡을 추가하지 못했어요!\n대기열이 가득 찼어요... (최대 100곡)");
});

test("웹 쪽 오류(대시보드에서만 나는 코드)는 끝 줄에 코드와 HTTP 상태", () => {
  const login = { response: { status: 401, data: problemBody("login-required") } };
  assert.equal(problemText(login, "실패"), "로그인이 필요해요!\n로그인하지 않았거나 로그인이 만료됐어요. 다시 로그인한 뒤에 시도해 주세요.\n오류 코드: login-required (HTTP 401)");
  // 응답의 상태가 없으면 본문의 상태
  assert.match(problemText(failed(problemBody("bad-loop-mode")), "실패"), /\n오류 코드: bad-loop-mode \(HTTP 400\)$/);
  // 디스코드 /join 도 내는 거절은 봇 쪽이다
  assert.equal(problemNotice(failed(problemBody("bot-in-other-voice")), "실패").codeLine, "");
});

test("봇 개발자에게 보고하라는 문장이면 보고할 곳(소스 저장소)을 붙인다. 받기 전이면 붙이지 않는다", () => {
  const loop = { response: { status: 400, data: problemBody("bad-loop-mode") } };
  setReportUrl("");
  assert.equal(problemNotice(loop, "실패").reportUrl, "");
  setReportUrl("https://example.invalid/repo");
  try {
    assert.equal(problemNotice(loop, "실패").reportUrl, "https://example.invalid/repo");
    assert.equal(problemText(loop, "실패"), "알 수 없는 반복 모드를 요청했어요!\n일반적으로는 발생할 수 없는 오류이니, 봇 개발자에게 보고해 주세요.\n보고할 곳: https://example.invalid/repo\n오류 코드: bad-loop-mode (HTTP 400)");
    assert.equal(problemNotice(failed(problemBody("no-song")), "실패").reportUrl, "", "보고하라고 하지 않는 문장");
  } finally {
    setReportUrl("");
  }
});

test("꾸밈(굵게 · 코드)은 떼고, 운영자용 원문(detail)은 본문 다음 줄에", () => {
  assert.equal(problemText(failed(problemBody("bad-time")), "실패"), "알 수 없는 시간 형식이에요!\n제가 읽어 들일 수 없는 형식이에요. 1:30, 3m20s, 90 처럼 적어 주세요!");
  assert.equal(problemText(failed(problemBody("config-save-failed", {}, { detail: "키 이름이 틀렸습니다" })), "실패"), "설정을 저장하지 못했어요!\n설정 DB 에 쓰다 실패했어요. 함께 적힌 원문을 확인해 주세요.\n키 이름이 틀렸습니다\n오류 코드: config-save-failed (HTTP 409)");
});

test("심각한 정도는 안내의 것", () => {
  assert.equal(problemNotice(failed(problemBody("no-song")), "실패").severity, "warning");
  assert.equal(problemNotice(failed(problemBody("stream-failed")), "실패").severity, "error");
});

test("응답 없이 실패한 요청은 화면만의 문장과 코드", () => {
  assert.deepEqual(problemNotice({ code: "ETIMEDOUT" }, "실패"), { severity: "warning", ...text.errors.timeout, detail: "", codeLine: text.errors.codeLine("request-timeout"), reportUrl: "" });
  assert.equal(problemNotice({ code: "ERR_NETWORK" }, "실패").codeLine, text.errors.codeLine("no-connection"));
  assert.ok(problemText({ code: "ETIMEDOUT" }, "실패").endsWith(`\n${text.errors.codeLine("request-timeout")}`));
});

test("문제 응답이 아니거나 모르는 코드면 화면이 준 글(코드 줄 없음)", () => {
  for (const error of [undefined, null, { response: {} }, failed("<html>"), failed({ error: "옛 꼴" }), failed({ code: "no-such-code" }), failed({ code: "toString" }), { code: "ECONNABORTED" }]) assert.equal(problemText(error, "실패"), "실패");
});

test("칸별 원문 목록", () => {
  assert.deepEqual(
    problemDetails(
      failed(
        problemBody(
          "config-invalid",
          {},
          {
            errors: [
              { code: "config-invalid", detail: "가" },
              { code: "config-invalid", detail: "나" },
            ],
          },
        ),
      ),
    ),
    ["가", "나"],
  );
  assert.deepEqual(problemDetails(failed(problemBody("bad-request"))), []);
});
