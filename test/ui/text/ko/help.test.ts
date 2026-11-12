// src/ui/text/ko/help.ts: /help 화면의 글자(첫 화면, 섹션 이름, 권한 표시와 그 뜻, 메뉴와 버튼)를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as help from "../../../../src/ui/text/ko/help.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [help.home({ play: "`/play`", dashboard: true }), help.home({ play: "`/play`", dashboard: false }).lines.length, (["play", "queue", "mode", "explore", "channel", "info"] as const).map((key) => help.section(key).name), [help.tierMark("everyone"), help.tierMark("dj"), help.tierMark("dj-or-requester"), help.tierMark("dj-outside-bot-channel"), help.tierMark("server-manager"), help.tierMark("owner")], help.controls()],
    [
      {
        title: "도움말",
        lines: ["- 음성 채널에 들어가서 `/play`로 곡을 틀어요. 재생 패널의 버튼으로도 조작할 수 있어요.", "- 전용 채널이 있는 서버는 그 채널에 곡 이름이나 링크만 넣어도 돼요.", "- 모든 조작과 설정은 웹 대시보드에서도 할 수 있어요."],
      },
      2,
      ["재생", "대기열", "모드 & 오디오", "탐색 & 정보", "채널 & 세션", "봇 정보"],
      ["", "🔒", "🔒 (자기가 추가한 곡은 누구나)", "(봇 전용 채널에서는 전원, 그 외 🔒)", "🛡️", "(봇 운영자)"],
      { placeholder: "명령어 분류를 골라 주세요", back: "뒤로", dashboard: "웹 대시보드" },
    ],
  );
});

test("권한 표시의 뜻: 그 섹션에 나온 표시만 한 번씩, 누구나와 봇 운영자는 적지 않는다", () => {
  const dj = "🔒 봇과 같은 음성 채널에 있는 DJ만 쓸 수 있어요. DJ 역할이 없는 서버는 모두가 DJ이고, 서버 관리자는 늘 쓸 수 있어요.";
  assert.deepEqual(help.legend(["everyone", "dj", "dj-or-requester"]), [dj]);
  assert.deepEqual(help.legend(["dj-outside-bot-channel", "server-manager"]), [dj, "🛡️ 서버 관리자만 쓸 수 있어요."]);
  assert.deepEqual(help.legend(["everyone", "owner"]), []);
});
