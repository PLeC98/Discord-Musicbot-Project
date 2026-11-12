// src/ui/text/ko/help.ts: /help 화면의 글자(머리말, 섹션 이름, 권한 표시, 버튼, 자세히 보기)를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as help from "../../../../src/ui/text/ko/help.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [help.intro("`/play`"), help.footer("`/help`"), [help.sectionName("play"), help.sectionName("queue"), help.sectionName("mode"), help.sectionName("explore"), help.sectionName("channel"), help.sectionName("info")], [help.tierMark("everyone"), help.tierMark("dj"), help.tierMark("dj-or-requester"), help.tierMark("dj-outside-bot-channel"), help.tierMark("server-manager"), help.tierMark("owner")], help.buttons(), help.choice("play", "곡을 재생해요")],
    [
      {
        title: "도움말",
        lines: ["음성 채널에 들어가서 `/play`로 곡을 틀어요. 재생 패널의 버튼으로도 조작할 수 있어요.", "🔒 봇과 같은 음성 채널에 있는 DJ만 쓸 수 있어요. DJ 역할이 없는 서버는 모두가 DJ이고, 서버 관리자는 늘 쓸 수 있어요.", "🛡️ 서버 관리자만 쓸 수 있어요."],
      },
      "`/help`의 명령 칸에 명령 이름을 넣으면 하나씩 자세히 볼 수 있어요.",
      ["🎵 재생", "📋 대기열", "🎛️ 모드 & 오디오", "🔍 탐색 & 정보", "📡 채널 & 세션", "📊 봇 정보"],
      ["", "🔒", "🔒 (자기가 추가한 곡은 누구나)", "(봇 전용 채널에서는 전원, 그 외 🔒)", "🛡️", "(봇 운영자)"],
      { dashboard: "웹 대시보드" },
      "/play: 곡을 재생해요",
    ],
  );
});

test("자세히 보기: 입력, 쓸 수 있는 사람, 지금은(됨, 자기 곡만, 안 됨)", () => {
  const options = [
    { name: "곡", description: "링크나 검색어", required: true },
    { name: "위치", description: "넣을 자리", required: false },
  ];
  assert.deepEqual(help.detail({ mention: "`/play`", description: "곡을 재생해요", options, tier: "everyone", now: { state: "yes" } }), {
    title: "`/play`",
    lines: ["곡을 재생해요", "", "**입력**", "- `곡`: 링크나 검색어", "- `위치` (선택): 넣을 자리", "", "**쓸 수 있는 사람**: 누구나", "**지금은**: 쓸 수 있어요."],
  });
  assert.deepEqual(help.detail({ mention: "`/skip`", description: "건너뛰어요", options: [], tier: "dj-or-requester", now: { state: "own-track" } }).lines, ["건너뛰어요", "", "**쓸 수 있는 사람**: DJ, 또는 그 곡을 추가한 사람(봇과 같은 음성 채널에서)", "**지금은**: DJ가 아니라서 자기가 추가한 곡에만 쓸 수 있어요."]);
  assert.equal(help.detail({ mention: "`/system`", description: "시스템", options: [], tier: "owner", now: { state: "no", why: "이 조작은 봇 운영자 전용이에요." } }).lines.at(-1), "**지금은**: 쓸 수 없어요. 이 조작은 봇 운영자 전용이에요.");
  assert.equal(help.choice("x", "가".repeat(200)).length, 100, "자동완성 줄은 100자");
  assert.equal(help.detailFooter(), "권한과 음성 채널만 봐요. 재생 중인 곡이 없는 것처럼 지금 상태 때문에 안 되면 실행할 때 알려 줘요.");
});
