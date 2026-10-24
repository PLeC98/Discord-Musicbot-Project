// src/infra/console-text.ts — 바깥 프로그램의 출력: UTF-8 이 아니면 콘솔 코드 페이지로 읽는다

import { test } from "node:test";
import assert from "node:assert/strict";
import { consoleText } from "../../src/infra/console-text.ts";

test("UTF-8 이면 그대로, 아니면 주어진 코드 페이지로, 읽을 디코더가 없으면 latin1", () => {
  assert.equal(consoleText(Buffer.from("ERROR: Invalid argument.\r\n")), "ERROR: Invalid argument.\r\n");
  // 한국어 Windows 의 tasklist 가 cp949 로 쓴 "오류: 검색 필터"
  const korean = Buffer.from([0xbf, 0xc0, 0xb7, 0xf9, 0x3a, 0x20, 0xb0, 0xcb, 0xbb, 0xf6, 0x20, 0xc7, 0xca, 0xc5, 0xcd]);
  assert.equal(consoleText(korean, 949), "오류: 검색 필터");
  // 일본어 Windows(932)의 "エラー"
  assert.equal(consoleText(Buffer.from([0x83, 0x47, 0x83, 0x89, 0x81, 0x5b]), 932), "エラー");
  // 영어권 OEM(437)은 디코더가 없다. 메시지는 대개 ASCII 라 latin1 로 읽는다
  assert.equal(consoleText(Buffer.from([0x45, 0x72, 0x72, 0xe9]), 437), "Erré");
});
