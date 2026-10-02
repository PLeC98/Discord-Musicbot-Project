// src/ui/text/ko/help.ts — /help 화면의 글자(묶음 이름 · 권한 표시 · 지원 플랫폼 · 머리 · 통계 · 링크)를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as help from "../../../../src/ui/text/ko/help.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [
      help.intro(),
      [help.sectionName("play"), help.sectionName("queue"), help.sectionName("mode"), help.sectionName("explore"), help.sectionName("channel"), help.sectionName("info")],
      [help.tierMark("everyone"), help.tierMark("dj"), help.tierMark("dj-or-requester"), help.tierMark("dj-outside-bot-channel"), help.tierMark("moderator"), help.tierMark("owner")],
      help.platforms(),
      help.stats({ guilds: 3, users: 12345, active: 1, uptime: "1시간 2분" }),
      help.links({ invite: "https://invite", website: null }),
      help.links({ invite: "https://invite", website: "https://site" }),
      help.buttons(),
    ],
    [
      { title: "🎵 도움말", description: "🔒 표시 명령은 **봇과 같은 음성 채널에 있는 DJ**만 쓸 수 있어요. 서버 관리자는 채널에 없어도 쓸 수 있어요.\nDJ 역할을 정하지 않은 서버에서는 모두가 DJ 역할을 가진 것으로 간주해요. (`/setdjrole`)" },
      ["🎵 재생", "📋 대기열", "🎛️ 모드 & 오디오", "🔍 탐색 & 정보", "📡 채널 & 세션", "📊 봇 정보"],
      ["", "🔒", "🔒 (자기가 추가한 곡은 누구나)", "(봇 전용 채널에서는 전원, 그 외 🔒)", "(서버 관리 권한)", "(봇 운영자)"],
      { name: "🌐 지원 플랫폼", lines: ["🔴 **YouTube** - 영상 링크 및 검색", "🟢 **Spotify** - 곡, 재생목록, 앨범 링크", "🟠 **SoundCloud** - 곡 링크 및 검색", "🔗 **직접 링크** - 미디어 파일 URL (MP3 · FLAC · M4A · MP4 등)"] },
      { name: "📊 통계", lines: ["🏠 **서버:** 3개", "👥 **사용자:** 12,345명", "🎵 **재생 중인 서버:** 1개", "⏱️ **업타임:** 1시간 2분"] },
      { name: "🔗 링크", lines: ["[📄 봇 초대하기](https://invite)"] },
      { name: "🔗 링크", lines: ["[🌐 웹사이트](https://site)", "[📄 봇 초대하기](https://invite)"] },
      { website: "웹사이트", refresh: "새로고침" },
    ],
  );
});
