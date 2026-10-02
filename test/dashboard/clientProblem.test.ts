// dashboard/client/src/utils/problem.js — 화면이 문제 응답을 글로 바꾸는 도우미. 문장은 봇과 같은 안내에서 코드로 고른다

import { test } from "node:test";
import assert from "node:assert/strict";
import { problemCode, problemDetails, problemText } from "../../dashboard/client/src/utils/problem.js";
import { problemBody } from "../../dashboard/server/problem.ts";

const failed = (data: unknown) => ({ response: { data } });

test("코드의 안내를 머리 줄 · 본문으로 잇고, 문장에 드는 값은 응답의 확장 칸에서 읽는다", () => {
  assert.equal(problemText(failed(problemBody("no-song")), "실패"), "재생 중인 곡이 없어요!\n이 조작을 하려면 재생 중인 곡이 있어야 해요.");
  assert.equal(problemText(failed(problemBody("queue-full", { max: 100 })), "실패"), "곡을 추가하지 못했어요!\n대기열이 가득 찼어요... (최대 100곡)");
});

test("꾸밈(굵게 · 코드)은 떼고, 운영자용 원문(detail)은 다음 줄에", () => {
  assert.equal(problemText(failed(problemBody("bad-time")), "실패"), "알 수 없는 시간 형식이에요!\n제가 읽어 들일 수 없는 형식이에요. 1:30, 3m20s, 90 처럼 적어 주세요!");
  assert.equal(problemText(failed(problemBody("config-save-failed", {}, { detail: "키 이름이 틀렸습니다" })), "실패"), "설정을 저장하지 못했습니다.\n키 이름이 틀렸습니다");
});

test("문제 응답이 아니거나 모르는 코드면 화면이 준 글", () => {
  for (const error of [undefined, null, { response: {} }, failed("<html>"), failed({ error: "옛 꼴" }), failed({ code: "no-such-code" }), failed({ code: "toString" })]) assert.equal(problemText(error, "실패"), "실패");
});

test("칸별 원문 목록과 코드", () => {
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
  assert.equal(problemCode(failed(problemBody("bad-csrf-token"))), "bad-csrf-token");
  assert.equal(problemCode(undefined), null);
});
