// src/rules/discord-rejection.ts: 디스코드가 요청을 거절한 오류(숫자 코드)를 부류로 나누고, 로그 줄에 요청을 싣되 경로 안의 상호작용 토큰은 가린다

import { test } from "node:test";
import assert from "node:assert/strict";
import { discordRejection, rejectionLine as lineOf } from "../../src/rules/discord-rejection.ts";
import { asText } from "../../src/infra/log/log-text.ts";
import { testText } from "../helpers/log-text.ts";

// 로그 줄은 로그 문구다. 글로 비교하려고 그린다
const rejectionLine = (...args: Parameters<typeof lineOf>) => asText(lineOf(...args));

// DiscordAPIError의 형태: 숫자 code와 숫자 status
const rejected = (code: number, extra: object = {}) => Object.assign(new Error(`거절 ${code}`), { code, status: 400, ...extra });

test("부류와 수준: 상호작용 수명, 사라진 대상은 warn, 권한과 모르는 코드(우리 요청이 틀림)는 error", () => {
  const familyOf = (code: number) => {
    const r = discordRejection(rejected(code));
    return r && `${r.family}:${r.level}`;
  };
  for (const code of [10062, 40060, 50027, 10015]) assert.equal(familyOf(code), "interaction:warn", String(code));
  for (const code of [10003, 10004, 10008]) assert.equal(familyOf(code), "gone:warn", String(code));
  for (const code of [50001, 50013]) assert.equal(familyOf(code), "permission:error", String(code));
  for (const code of [50035, 40005, 0]) assert.equal(familyOf(code), "other:error", String(code));
});

test("디스코드 거절이 아니면 null: 우리 오류, 문자열 코드(Node, SQLite, 우리 오류 이름), status 없는 숫자 코드(DOMException, 종료 코드), 오류가 아닌 값", () => {
  assert.equal(discordRejection(new DOMException("시간 초과", "TimeoutError")), null);
  assert.equal(discordRejection(new DOMException("중단", "AbortError")), null);
  assert.equal(discordRejection(Object.assign(new Error("Command failed"), { code: 1, signal: null })), null);
  assert.equal(discordRejection(new Error("버그")), null);
  assert.equal(discordRejection(Object.assign(new Error("x"), { code: "ECONNRESET" })), null);
  assert.equal(discordRejection(Object.assign(new Error("x"), { code: "stream-failed" })), null);
  assert.equal(discordRejection("문자열"), null);
  assert.equal(discordRejection(null), null);
});

test("원인 사슬 안의 거절도 본다", () => {
  const wrapped = Object.assign(new Error("패널 갱신 실패", { cause: rejected(10008) }), { code: "panel-failed" });
  assert.equal(discordRejection(wrapped)?.family, "gone");
});

test("요청: 메서드와 경로만(쿼리 뺌), 웹훅과 상호작용 콜백 경로의 토큰은 가린다", () => {
  const requestOf = (url: string, method = "post") => discordRejection(rejected(50027, { url, method }))?.request;
  assert.equal(requestOf("https://discord.com/api/v10/channels/1/messages?limit=5", "get"), "GET /channels/1/messages");
  assert.equal(requestOf("https://discord.com/api/v10/webhooks/123/aW50ZXJhY3Rpb24.dG9rZW4/messages/@original", "patch"), "PATCH /webhooks/123/[REDACTED]/messages/@original");
  assert.equal(requestOf("https://discord.com/api/v10/interactions/456/aW50ZXJhY3Rpb24.dG9rZW4/callback"), "POST /interactions/456/[REDACTED]/callback");
  assert.equal(discordRejection(rejected(10008))?.request, null, "주소가 없으면 모름");
});

test("로그 줄: 뜻(모르는 코드는 일반 문장), 코드와 디스코드 메시지, 요청, 서버, 어디서", () => {
  const known = discordRejection(rejected(10003, { url: "https://discord.com/api/v10/channels/9/messages", method: "post" }))!;
  assert.equal(rejectionLine(known, "g1", testText("음성 상태")), "채널이 없음 (10003 거절 10003) | POST /channels/9/messages | 서버 g1 | 음성 상태");
  const other = discordRejection(rejected(50035))!;
  assert.equal(rejectionLine(other, null, testText("rejection")), "디스코드가 요청을 거절함 (50035 거절 50035) | 요청 모름 | 서버 모름 | rejection");
});
