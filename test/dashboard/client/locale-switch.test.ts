// dashboard/src/utils/locale: 형식 로케일을 바꾸면 숫자, 상대 시각, 정렬이 그 로케일을 따르고, 되돌리면 돌아온다(테스트 언어는 ko-KR이라 화면 훑기로는 보이지 않는다)

import { test } from "node:test";
import assert from "node:assert/strict";
import { compareText, formatNumber, relativeTime, useLocale } from "../../../dashboard/src/utils/locale.ts";

test("형식 로케일을 바꾸면 숫자, 상대 시각, 정렬이 따라간다", () => {
  try {
    useLocale("en-US");
    assert.equal(formatNumber(1234.5), "1,234.5");
    assert.equal(relativeTime.format(-1, "day"), "yesterday");
    assert.ok(compareText("ä", "z") < 0, "영어는 ä를 a 옆에 둔다");

    useLocale("de-DE");
    assert.equal(formatNumber(1234.5), "1.234,5");
    useLocale("sv-SE");
    assert.ok(compareText("ä", "z") > 0, "스웨덴어는 ä를 z 뒤에 둔다");

    useLocale("ko-KR");
    assert.equal(relativeTime.format(-1, "day"), "어제");
    assert.equal(formatNumber(1234.5), "1,234.5");
  } finally {
    useLocale("ko-KR");
  }
});
