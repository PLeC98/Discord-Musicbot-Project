// src/ui/text/ko/autoplay.ts — 자동재생 장르 화면의 글자를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as autoplay from "../../../../src/ui/text/ko/autoplay.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [autoplay.pickGenre(), autoplay.turnedOff(), autoplay.turnedOn("J-POP")],
    [
      { title: "🎲 자동재생 장르 선택", description: "어떤 장르를 재생할까요?", placeholder: "장르를 선택해 주세요!" },
      { title: "🎲 자동재생을 껐어요!", description: "장르를 바꾸려던 거라면 아래에서 선택해 주세요! 자동재생을 끄려던 거라면 선택하지 않고 두면 돼요.", placeholder: "바꿀 장르를 선택해 주세요!" },
      { title: "🎲 자동재생을 시작할게요!", description: "**J-POP** 장르로 켰어요. 직접 넣어둔 대기열이 끝나면 자동재생 곡들이 나와요.", by: "👤 요청한 사람" },
    ],
  );
});
