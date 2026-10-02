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
      settings.sponsorSaved(false, "끔"),
      settings.playlistLimitReset(50),
      settings.playlistLimitNow({ count: 50, isDefault: true, min: 1, max: 100 }),
      settings.playlistLimitNow({ count: 30, isDefault: false, min: 1, max: 100 }),
      settings.playlistLimitSet(30),
    ],
    [
      { save: "저장", cancel: "취소" },
      { title: "🔧 전용 채널 해제됨", description: "이제 명령어로만 곡을 재생할 수 있어요." },
      { title: "✅ 전용 채널 설정됨", description: "<#1> 채널을 봇 전용 채널로 설정했어요.\n\n이 채널에 링크나 검색어를 적으면 바로 재생해요.\n대시보드의 공지도 이 채널로 발송돼요.", inputs: "📋 넣을 수 있는 것", inputsValue: "• 지원하는 플랫폼 링크 (유튜브, 스포티파이, 사운드클라우드)\n• 재생 가능한 미디어 링크\n• 곡 이름이나 아티스트 이름 등의 검색어" },
      { title: "🎧 DJ 역할", description: "DJ 역할이 없어 **모두**가 재생을 조작할 수 있어요.\n\n아래 메뉴에서 DJ로 정할 역할을 고른 뒤 **저장**을 누르세요. (여러 역할을 지정할 수 있어요)\n아무 역할도 고르지 않으면 모두가 DJ 권한을 가져요.\n서버 관리자들(서버 관리, 추방, 차단, 타임아웃 권한을 가진 사람)은 설정과 상관없이 늘 조작할 수 있어요.", placeholder: "DJ로 정할 역할 고르기" },
      { title: "🎧 DJ 역할", description: "현재 DJ 역할: <@&11> <@&22>\n\n아래 메뉴에서 DJ로 정할 역할을 고른 뒤 **저장**을 누르세요. (여러 역할을 지정할 수 있어요)\n아무 역할도 고르지 않으면 모두가 DJ 권한을 가져요.\n서버 관리자들(서버 관리, 추방, 차단, 타임아웃 권한을 가진 사람)은 설정과 상관없이 늘 조작할 수 있어요.", placeholder: "DJ로 정할 역할 고르기" },
      { title: "🎧 DJ 역할 설정을 취소했어요", description: "변경 사항은 반영하지 않았어요." },
      { title: "🎧 DJ 역할을 지정하지 않았어요", description: "모두가 재생을 조작할 수 있어요." },
      { title: "✅ DJ 역할을 설정했어요", description: "DJ 역할: <@&11> <@&22>\n\n이제 🔒 재생 조작(건너뛰기 · 정지 · 볼륨 등)은 이 역할이 있는 사람만 할 수 있어요.\n특정 권한을 가진 서버 관리자들은 항상 조작할 수 있어요." },
      { title: "⏭️ SponsorBlock 자동 건너뛰기", description: "현재 설정: **켬**\n건너뛸 구간 종류를 아래에서 고르고 **저장**을 누르세요. 켜고 끄기는 버튼으로 해요.", placeholder: "건너뛸 구간 종류 선택", toggle: "켜짐 (끄기)" },
      { title: "⏭️ SponsorBlock 자동 건너뛰기", description: "⚠️ 봇 전체 설정에서 SponsorBlock이 꺼져 있어서 이 설정은 적용되지 않아요.\n현재 설정: **끔**\n건너뛸 구간 종류를 아래에서 고르고 **저장**을 누르세요. 켜고 끄기는 버튼으로 해요.", placeholder: "건너뛸 구간 종류 선택", toggle: "꺼짐 (켜기)" },
      "끔",
      "고른 구간 없음 (건너뛰지 않아요)",
      "광고, 인트로",
      { title: "⏭️ SponsorBlock 설정을 취소했어요", description: "변경 사항은 반영하지 않았어요." },
      { title: "⏭️ SponsorBlock 설정을 저장했어요", description: "현재 설정: **켬**\n구간: 광고" },
      { title: "⏭️ SponsorBlock 설정을 저장했어요", description: "현재 설정: **끔**\n구간: 끔" },
      { title: "🔧 기본값으로 되돌렸어요", description: "재생목록을 넣으면 한 번에 **50곡**씩 들어가요." },
      { title: "📃 재생목록에 한 번에 넣을 곡 수", description: "지금은 **50곡**이에요 (기본값).\n`/setplaylistlimit count:<곡 수>`로 바꿀 수 있어요 (1~100곡)." },
      { title: "📃 재생목록에 한 번에 넣을 곡 수", description: "지금은 **30곡**이에요.\n`/setplaylistlimit count:<곡 수>`로 바꿀 수 있어요 (1~100곡)." },
      { title: "✅ 재생목록에 한 번에 넣을 곡 수를 바꿨어요", description: '이제 재생목록을 넣으면 한 번에 **30곡**씩 들어가요.\n남은 곡은 "더 넣기"로 이어 넣을 수 있어요.' },
    ],
  );
});
