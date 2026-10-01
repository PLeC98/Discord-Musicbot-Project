// src/ui/text/settings.ts — 설정 화면의 글자를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as settings from "../../../src/ui/text/settings.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [
      settings.buttons(),
      settings.channelRemoved(),
      settings.channelSet("<#1>"),
      settings.djRoleMenu([]),
      settings.djRoleMenu(["11", "22"]),
      settings.djRoleCancelled(),
      settings.djRoleCleared(),
      settings.djRoleSaved(["11", "22"]),
      settings.sponsorMenu({ enabled: true, globalOff: false }),
      settings.sponsorMenu({ enabled: false, globalOff: true }),
      settings.sponsorSummary(false, ["광고"]),
      settings.sponsorSummary(true, []),
      settings.sponsorSummary(true, ["광고", "인트로"]),
      settings.sponsorCancelled(),
      settings.sponsorSaved(true, "광고"),
      settings.sponsorSaved(false, "미사용"),
      settings.playlistLimitReset(50),
      settings.playlistLimitNow({ count: 50, isDefault: true, min: 1, max: 100 }),
      settings.playlistLimitNow({ count: 30, isDefault: false, min: 1, max: 100 }),
      settings.playlistLimitSet(30),
    ],
    [
      { save: "저장", cancel: "취소" },
      { title: "🔧 봇 채널 제거됨", description: "봇 전용 채널 설정이 해제됐어요.\n이제 `/play` 명령어로만 음악을 요청할 수 있어요." },
      { title: "✅ 봇 채널 설정됨", description: "<#1>이(가) 봇 전용 채널로 설정됐어요!\n\n이 채널에 음악 링크나 검색어를 입력하면 자동으로 재생해요.\n대시보드의 공지 발송도 이 채널을 우선으로 사용해요.", inputs: "📋 지원 입력", inputsValue: "• YouTube, Spotify, SoundCloud URL\n• 곡 이름이나 아티스트 검색어" },
      { title: "🎧 DJ 역할 설정", description: "현재 DJ 역할이 설정되어 있지 않아 **모든 유저**가 재생을 제어할 수 있습니다.\n\n아래 메뉴에서 DJ로 지정할 역할을 고른 뒤 **저장**을 누르세요. (복수 선택 가능)\n아무 역할도 선택하지 않고 저장하면 제한이 해제됩니다.\n모더레이터(서버 관리·추방·차단·타임아웃 권한 보유자)는 설정과 무관하게 항상 제어할 수 있어요.", placeholder: "DJ로 지정할 역할 선택" },
      { title: "🎧 DJ 역할 설정", description: "현재 DJ 역할: <@&11> <@&22>\n\n아래 메뉴에서 DJ로 지정할 역할을 고른 뒤 **저장**을 누르세요. (복수 선택 가능)\n아무 역할도 선택하지 않고 저장하면 제한이 해제됩니다.\n모더레이터(서버 관리·추방·차단·타임아웃 권한 보유자)는 설정과 무관하게 항상 제어할 수 있어요.", placeholder: "DJ로 지정할 역할 선택" },
      { title: "🎧 DJ 역할 설정 취소됨", description: "변경 사항 없이 닫았어요." },
      { title: "🎧 DJ 역할 제한 해제됨", description: "이제 모든 유저가 재생을 제어할 수 있어요.\n(모더레이터는 설정과 무관하게 항상 가능합니다)" },
      { title: "✅ DJ 역할 설정됨", description: "DJ 역할: <@&11> <@&22>\n\n이제 🔒 재생 제어(스킵/정지/볼륨 등)는 이 역할 보유자만 사용할 수 있어요.\n모더레이터(서버 관리·추방·차단·타임아웃 권한 보유자)는 항상 제어할 수 있습니다." },
      { title: "⏭️ SponsorBlock 자동 스킵 설정", description: "현재: **사용**\n건너뛸 구간 종류를 아래에서 고르고 **저장**을 누르세요. 사용 여부는 버튼으로 토글합니다.", placeholder: "건너뛸 구간 종류 선택", toggle: "사용 중 (끄기)" },
      { title: "⏭️ SponsorBlock 자동 스킵 설정", description: "⚠️ 봇 전역 설정에서 SponsorBlock이 꺼져 있어 이 설정은 적용되지 않습니다.\n현재: **미사용**\n건너뛸 구간 종류를 아래에서 고르고 **저장**을 누르세요. 사용 여부는 버튼으로 토글합니다.", placeholder: "건너뛸 구간 종류 선택", toggle: "미사용 (켜기)" },
      "미사용",
      "선택된 구간 없음(사실상 미적용)",
      "광고, 인트로",
      { title: "⏭️ SponsorBlock 설정 취소됨", description: "변경 사항 없이 닫았어요." },
      { title: "⏭️ SponsorBlock 설정 저장됨", description: "사용: **예**\n구간: 광고" },
      { title: "⏭️ SponsorBlock 설정 저장됨", description: "사용: **아니오**\n구간: 미사용" },
      { title: "🔧 기본값으로 되돌렸어요", description: "재생목록을 넣으면 한 번에 **50곡**씩 들어가요." },
      { title: "📃 재생목록 한 번에 넣는 곡 수", description: "지금은 **50곡**이에요 (기본값).\n`/setplaylistlimit count:<곡 수>`로 바꿀 수 있어요 (1~100곡)." },
      { title: "📃 재생목록 한 번에 넣는 곡 수", description: "지금은 **30곡**이에요.\n`/setplaylistlimit count:<곡 수>`로 바꿀 수 있어요 (1~100곡)." },
      { title: "✅ 재생목록 한 번에 넣는 곡 수를 바꿨어요", description: '이제 재생목록을 넣으면 한 번에 **30곡**씩 들어가요.\n남은 곡은 "더 넣기"로 이어 넣을 수 있어요.' },
    ],
  );
});
