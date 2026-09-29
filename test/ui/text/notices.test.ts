// src/ui/text/notices.ts — 플레이어 알림 문장을 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as notices from "../../../src/ui/text/notices.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [notices.autoplayUnknownGenre("jazz"), notices.autoplayGaveUp("jazz"), notices.failedInRow(3, 0), notices.failedInRow(3, 5), notices.restored("곡_1", "1분", true), notices.restored(undefined, "1분", false)],
    ["❌ 자동재생 장르 `jazz`(을)를 찾을 수 없어 자동재생을 껐습니다. `/autoplay`로 다시 설정해 주세요.", "⏹️ `jazz` 장르에서 틀 만한 곡을 찾지 못해 자동재생을 껐습니다.", "⏹️ 곡 3개를 연달아 틀지 못해 재생을 멈췄습니다.", "⏹️ 곡 3개를 연달아 틀지 못해 재생을 멈췄습니다. 남은 5곡은 대기열에 그대로 있고, 곡을 추가하면 이어서 틉니다.", "⏸️ 일시정지 상태로 복원됨 • **곡\\_1** (1분)", "▶️ 음악 재개됨 • **Unknown** (1분)"],
  );
});
