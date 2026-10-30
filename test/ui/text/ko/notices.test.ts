// src/ui/text/ko/notices.ts: 플레이어 알림을 모두 적어 둔다(안내는 경고 수준 · 이모지 · 헤더 줄, 본문은 다음 줄). 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as notices from "../../../../src/ui/text/ko/notices.ts";
import { shown } from "../../../helpers/notice.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [shown(notices.autoplayUnknownGenre("jazz")), shown(notices.autoplayUnknownGenre("가요")), shown(notices.autoplayGaveUp("jazz")), shown(notices.parkedFailures(3)), shown(notices.parkedDropped()), notices.parkedLine(), notices.copiesRemoved(2), shown(notices.skippedMore(4)), shown(notices.savedSessionReplaced(5)), notices.restored("곡_1", "1분", true), notices.restored(undefined, "1분", false)],
    [
      "warning 🎲 알 수 없는 장르예요!\n장르 목록이 변경되어 `jazz`가 없어져서 자동재생을 껐어요. 장르를 다시 선택해 주세요.",
      "warning 🎲 알 수 없는 장르예요!\n장르 목록이 변경되어 `가요`가 없어져서 자동재생을 껐어요. 장르를 다시 선택해 주세요.",
      "warning 🎲 `jazz` 장르에서 틀 곡을 찾지 못해 자동재생을 종료했어요.",
      "error ❌ 3곡이 연달아 재생되지 않아 일시정지했어요.\n재생 버튼으로 다시 시도하거나 다음 곡 버튼으로 넘길 수 있어요.",
      "error ❌ 재생이 중간에 끊겨 일시정지했어요.\n재생 버튼을 누르면 끊긴 위치부터 다시 재생해요.",
      "다음 곡으로 넘기지 않고 일시정지했어요. 재생 버튼을 누르면 다시 시도해요.",
      "대기열에 같은 곡이 2번 더 있어서 함께 뺐어요.",
      "error ❌ 재생할 수 없는 4곡을 더 넘겼어요.",
      "warning ⚠️ 저장해 둔 대기열 5곡을 지우고 새로 시작했어요.\n다음부터 이어 들으려면 곡을 넣기 전에 `/join`을 먼저 써 주세요.",
      { icon: "restored", title: "봇이 복구됐어요", body: "마지막 일시정지 상태를 유지할게요.\n• **곡\\_1** (1분)" },
      { icon: "restored", title: "봇이 복구됐어요", body: "기록된 마지막 재생 상태를 이어갈게요.\n• **알 수 없는 곡** (1분)" },
    ],
  );
});
