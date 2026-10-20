// src/ui/frame.ts — 응답 템플릿. 이모지는 무엇에 관한 것인지, 색은 경고 수준. 대시보드는 같은 헤더 줄 · 본문의 글자를 받는다

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MessageFlags, resolveColor } from "discord.js";
import { TOPIC_ICON, frame, headOf, noticeFrame, noticeReply, post, reply } from "../../src/ui/frame.ts";
import { ICONS, useUploaded, type IconSpec } from "../../src/ui/icons.ts";
import { noticeOf, type Topic } from "../../src/ui/text/notice.ts";
import { textsOf, thumbnailOf } from "../helpers/cv2.ts";

const accentOf = (container: ReturnType<typeof frame>) => (container.toJSON() as { accent_color?: number }).accent_color;

afterEach(() => useUploaded(new Map()));

test("주제마다 아이콘 하나. 앱 이모지를 맞추기 전에는 유니코드", () => {
  const shown = Object.fromEntries((Object.keys(TOPIC_ICON) as Topic[]).map((topic) => [topic, headOf(noticeOf("warning", topic, "")).trim()]));
  assert.deepEqual(shown, {
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

test("안내를 만드는 곳의 (경고 수준, 주제)마다 그 색으로 그려 둔 아이콘이 있다(없으면 다른 색 타일로 내려간다)", () => {
  const dir = path.join(import.meta.dirname, "../../src");
  const pairs = new Set<string>();
  const scan = (at: string) => {
    for (const name of fs.readdirSync(at)) {
      const file = path.join(at, name);
      if (fs.statSync(file).isDirectory()) scan(file);
      else if (file.endsWith(".ts")) for (const m of fs.readFileSync(file, "utf8").matchAll(/\b(?:noticeOf\(\s*"(error|warning)",\s*|(error|warning)\()"(\w+)"/g)) pairs.add(`${m[1] ?? m[2]} ${m[3]}`);
    }
  };
  scan(dir);
  assert.ok(pairs.size > 10, `찾은 짝이 너무 적다: ${[...pairs].join(", ")}`);
  for (const pair of pairs) {
    const [severity, topic] = pair.split(" ") as ["error" | "warning", Topic];
    const key = TOPIC_ICON[topic];
    assert.ok(key !== undefined, `모르는 주제: ${pair}`);
    if (key) assert.ok(((ICONS[key] as IconSpec).tints ?? ["brand"]).includes(severity), `${pair}: ${key} 의 tints 에 ${severity} 가 없다`);
  }
});

test("앱 이모지를 맞추면 헤더 줄은 그 화면 색의 앱 이모지", () => {
  useUploaded(
    new Map([
      ["voice_warning", { id: "11", animated: false }],
      ["pause", { id: "12", animated: false }],
      ["done_done", { id: "13", animated: false }],
    ]),
  );
  assert.deepEqual(textsOf(noticeReply(noticeOf("warning", "voice", "음성 채널에 있어야 합니다!"))), ["### <:voice_warning:11> 음성 채널에 있어야 합니다!"]);
  assert.deepEqual(textsOf(post(frame({ icon: "pause", title: "일시정지했어요!" }))), ["### <:pause:12> 일시정지했어요!"]);
  assert.deepEqual(textsOf(post(frame({ icon: "done", title: "저장했어요", color: "done" }))), ["### <:done_done:13> 저장했어요"]);
});

test("안내의 화면: 헤더 줄에 주제의 이모지, 본문은 그 아래, 색은 경고 수준", () => {
  const withBody = noticeOf("error", "failed", "네트워크 오류", "잠시 뒤에");
  assert.deepEqual(textsOf(noticeReply(withBody)), ["### ❌ 네트워크 오류\n잠시 뒤에"]);
  assert.equal(accentOf(noticeFrame(withBody)), resolveColor("#ED4245"));

  const bare = noticeOf("warning", "voice", "음성 채널에 있어야 합니다!");
  assert.deepEqual(bare, { topic: "voice", severity: "warning", title: "음성 채널에 있어야 합니다!" }, "본문이 없으면 필드를 두지 않는다");
  assert.deepEqual(textsOf(noticeReply(bare)), ["### 🎧 음성 채널에 있어야 합니다!"]);
  assert.equal(accentOf(noticeFrame(bare)), resolveColor("#FEE75C"));
});

test("템플릿: 헤더 줄 · 본문 · 작은 글씨 줄, 썸네일은 헤더 옆. 빈 푸터 줄은 건너뛴다", () => {
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
