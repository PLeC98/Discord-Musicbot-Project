// src/ui/text/ko/panel.ts — 재생 패널의 글자를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as panel from "../../../../src/ui/text/ko/panel.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [
      panel.playingTitle(),
      panel.loopLabel("track"),
      panel.loopLabel("queue"),
      panel.loopLabel("off"),
      panel.buttons(),
      panel.jumpPlaceholder(),
      panel.pausedStatus("mute"),
      panel.pausedStatus("alone"),
      panel.pausedStatus("other"),
      panel.queuedStatus(3),
      panel.segmentsStatus(2),
      panel.dashboardLink("https://music.example.com"),
      panel.idle({ reason: "leave", dedicated: false }),
      panel.idle({ reason: "failures", dedicated: false }),
      panel.idle({ reason: "queue-end", leavesAt: 1700000000000, dedicated: false }),
      panel.idle({ reason: "joined", leavesAt: 1700000000000, dedicated: true }),
      panel.idle({ reason: "stop", dedicated: true }),
      panel.idle({ reason: "stop", dedicated: false }),
      panel.ended(),
    ],
    [
      "🎵 현재 재생 중",
      "한 곡 반복",
      "대기열 반복",
      "반복 꺼짐",
      { queue: "대기열", autoplay: "자동재생" },
      "⏭ 이 곡 먼저 재생하기",
      "🔇 음소거됨",
      "⏳ 혼자 남음",
      "⏸️ 일시정지",
      "대기열 3곡",
      "건너뛸 구간 2개",
      "🔗 [대시보드](https://music.example.com)",
      "### 💤 재생 대기 중\n**듣고 있던 곡이 있어요**\n-# 💾 `/join`으로 이어 들을 수 있어요",
      "### 💤 재생 대기 중\n**곡 재생에 연달아 실패해서 재생을 멈췄어요**\n-# 🎵 곡을 넣으면 다시 틀게요",
      "### 💤 재생 대기 중\n**재생이 끝났어요**\n-# 🌙 <t:1700000000:R> 쉬러 갈게요",
      "### 💤 재생 대기 중\n**곡을 기다리고 있어요**\n-# 🌙 <t:1700000000:R> 쉬러 갈게요",
      "### 💤 재생 대기 중\n**쉬는 중이에요**\n-# 👋 곡을 입력하면 다시 올게요",
      "### 💤 재생 대기 중\n**쉬는 중이에요**\n-# 👋 `/play`로 부르면 다시 올게요",
      { title: "🎵 재생이 끝났어요", description: "`/play`로 곡을 넣으면 다시 틀어요." },
    ],
  );
});
