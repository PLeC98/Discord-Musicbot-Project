// src/ui/text/ko/notices.ts — 플레이어 알림을 모두 적어 둔다(안내는 경고 수준 · 이모지 · 머리 줄, 본문은 다음 줄). 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as notices from "../../../../src/ui/text/ko/notices.ts";
import { shown } from "../../../helpers/notice.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [shown(notices.autoplayUnknownGenre("jazz")), shown(notices.autoplayUnknownGenre("가요")), shown(notices.autoplayGaveUp("jazz")), shown(notices.failedInRow(3, 0)), shown(notices.failedInRow(3, 5)), notices.restored("곡_1", "1분", true), notices.restored(undefined, "1분", false)],
    [
      "warning 🎲 알 수 없는 장르예요!\n장르 목록이 변경되어 `jazz`가 없어져서 자동재생을 껐어요. 장르를 다시 선택해 주세요.",
      "warning 🎲 알 수 없는 장르예요!\n장르 목록이 변경되어 `가요`가 없어져서 자동재생을 껐어요. 장르를 다시 선택해 주세요.",
      "warning 🎲 `jazz` 장르에서 틀 곡을 찾지 못해 자동재생을 종료했어요.",
      "error ❌ 곡 3개 재생에 연달아 실패해서 재생을 중단했어요.",
      "error ❌ 곡 3개 재생에 연달아 실패해서 재생을 중단했어요.\n남은 5곡은 대기열에 그대로 있고, 곡을 넣으면 이어서 틀어요.",
      { title: "⏸️ 봇이 복구됐어요", body: "마지막 일시정지 상태를 유지할게요.\n• **곡\\_1** (1분)" },
      { title: "▶️ 봇이 복구됐어요", body: "기록된 마지막 재생 상태를 이어갈게요.\n• **알 수 없는 곡** (1분)" },
    ],
  );
});
