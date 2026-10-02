// src/ui/frame.ts — 응답 틀. 이모지는 무엇에 관한 것인지, 색은 경고 수준. 대시보드는 같은 머리 줄 · 본문의 글자를 받는다

import { test } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags, resolveColor } from "discord.js";
import { EMOJI, frame, noticeFrame, noticeReply, post, reply } from "../../src/ui/frame.ts";
import { noticeOf } from "../../src/ui/text/notice.ts";
import { textsOf, thumbnailOf } from "../helpers/cv2.ts";

const accentOf = (container: ReturnType<typeof frame>) => (container.toJSON() as { accent_color?: number }).accent_color;

test("이모지는 주제마다 하나", () => {
  assert.deepEqual(EMOJI, {
    failed: "❌",
    permission: "🚫",
    voice: "🎧",
    stale: "⌛",
    input: "✏️",
    notFound: "🔍",
    link: "🔗",
    blocked: "🔒",
    live: "🔴",
    waiting: "⏳",
    muted: "🔇",
    autoplay: "🎲",
    state: "⚠️",
  });
});

test("안내의 화면: 머리 줄에 주제의 이모지, 본문은 그 아래, 색은 경고 수준", () => {
  const withBody = noticeOf("error", "failed", "네트워크 오류", "잠시 뒤에");
  assert.deepEqual(textsOf(noticeReply(withBody)), ["### ❌ 네트워크 오류\n잠시 뒤에"]);
  assert.equal(accentOf(noticeFrame(withBody)), resolveColor("#ED4245"));

  const bare = noticeOf("warning", "voice", "음성 채널에 있어야 합니다!");
  assert.deepEqual(bare, { topic: "voice", severity: "warning", title: "음성 채널에 있어야 합니다!" }, "본문이 없으면 칸을 두지 않는다");
  assert.deepEqual(textsOf(noticeReply(bare)), ["### 🎧 음성 채널에 있어야 합니다!"]);
  assert.equal(accentOf(noticeFrame(bare)), resolveColor("#FEE75C"));
});

test("틀: 머리 줄 · 본문 · 작은 글씨 줄, 썸네일은 머리 칸 옆. 빈 꼬리 줄은 건너뛴다", () => {
  const shown = post(frame({ title: "제목", body: "본문", footer: ["누가", null], thumbnail: "https://i/t.jpg" }));
  assert.deepEqual(textsOf(shown), ["### 제목\n본문", "-# 누가"]);
  assert.equal(thumbnailOf(shown), "https://i/t.jpg");
  assert.deepEqual(textsOf(post(frame({ body: "본문만" }))), ["본문만"]);
  assert.equal(accentOf(frame({ body: "x", color: "done" })), resolveColor("#57F287"));
});

test("새 응답은 본인에게만, 채널 메시지 · 고치기는 Components V2 만", () => {
  const c = frame({ body: "x" });
  assert.deepEqual(reply(c).flags, [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]);
  assert.deepEqual(post(c).flags, [MessageFlags.IsComponentsV2]);
});
