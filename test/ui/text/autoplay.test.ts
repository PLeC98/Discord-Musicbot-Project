// src/ui/text/autoplay.ts — 자동재생 장르 화면의 글자를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as autoplay from "../../../src/ui/text/autoplay.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [autoplay.pickGenre(), autoplay.turnedOff(), autoplay.turnedOn("J-POP")],
    [
      { title: "🎲 음악 장르 선택", description: "어떤 장르를 재생할까요?", placeholder: "음악 장르를 선택하세요..." },
      { title: "🎲 자동 재생이 비활성화되었습니다", description: "다른 장르로 다시 켜려면 아래에서 고르세요. 그냥 두면 꺼진 채로 둡니다.", placeholder: "장르를 바꿔 다시 켜기..." },
      { title: "🎲 자동 재생이 활성화되었습니다", description: "**J-POP** 장르로 자동 재생이 설정되었습니다. 대기열이 끝나면 자동으로 재생됩니다.", by: "👤 변경한 사람" },
    ],
  );
});
