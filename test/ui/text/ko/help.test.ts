// src/ui/text/ko/help.ts: /help 화면의 글자(첫 화면, 섹션 이름과 설명, 권한 표시와 그 뜻, 메뉴와 버튼)를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as help from "../../../../src/ui/text/ko/help.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [help.home({ play: "`/play`", help: "`/help`", sections: ["play", "info"] }), (["play", "queue", "mode", "explore", "channel", "info"] as const).map((key) => [help.section(key).name, help.section(key).about]), [help.tierMark("everyone"), help.tierMark("dj"), help.tierMark("dj-or-requester"), help.tierMark("dj-outside-bot-channel"), help.tierMark("server-manager"), help.tierMark("owner"), help.lockMark()], help.controls()],
    [
      {
        title: "도움말",
        lines: ["음성 채널에 들어가서 `/play`로 곡을 틀어요. 재생 패널의 버튼으로도 조작할 수 있어요.", "", "**🎵 재생**: 곡을 틀고, 멈추고, 넘기고, 원하는 시간으로 옮겨요.", "**📊 봇 정보**: 응답 시간, 라이선스, 초대 링크 같은 봇 정보를 봐요."],
        footer: "아래 메뉴나 `/help`의 분류 칸으로 분류마다 명령어를 볼 수 있어요.",
      },
      [
        ["재생", "곡을 틀고, 멈추고, 넘기고, 원하는 시간으로 옮겨요."],
        ["대기열", "대기열을 보고, 곡을 빼거나 옮기고, 섞어요."],
        ["모드 & 오디오", "반복, 자동재생, 볼륨을 정해요."],
        ["탐색 & 정보", "곡을 검색하고, 지금 곡의 정보를 봐요."],
        ["채널 & 세션", "봇을 부르거나 내보내고, 상주 모드와 서버 설정을 다뤄요."],
        ["봇 정보", "응답 시간, 라이선스, 초대 링크 같은 봇 정보를 봐요."],
      ],
      ["", "💿", "💿 (자기가 추가한 곡은 누구나)", "(봇 전용 채널에서는 누구나, 그 외 💿)", "🛡️", "🔑", "🔒"],
      { option: "분류", optionDescription: "바로 볼 명령어 분류", placeholder: "명령어 분류를 골라 주세요", back: "뒤로", dashboard: "웹 대시보드" },
    ],
  );
});

test("표시의 뜻: 그 섹션에 나온 표시만 한 번씩, 자물쇠는 붙은 줄이 있을 때만", () => {
  const dj = "💿 DJ만 쓸 수 있어요. DJ 역할이 없는 서버는 모두가 DJ예요.";
  const lock = "🔒 지금 내 권한으로는 쓸 수 없어요.";
  assert.deepEqual(help.legend(["everyone", "dj", "dj-or-requester"], false), [dj]);
  assert.deepEqual(help.legend(["dj-outside-bot-channel", "server-manager"], true), [dj, "🛡️ 서버 관리자만 쓸 수 있어요.", lock]);
  assert.deepEqual(help.legend(["everyone", "owner"], true), ["🔑 봇 운영자만 쓸 수 있어요.", lock]);
  assert.deepEqual(help.legend(["everyone"], false), []);
});
