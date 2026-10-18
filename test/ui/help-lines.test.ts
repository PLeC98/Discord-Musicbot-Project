// src/ui/help-lines.ts — /help 의 명령 줄을 명령 정의와 명령 모듈의 help(섹션 · 권한)에서 만든다.
// 실제 명령 목록으로 만든 줄을 적어 둔다(명령 · 설명 · 옵션 이름 · 권한을 바꾸면 여기도 바뀐다)

import { test } from "node:test";
import assert from "node:assert/strict";
import { helpSections } from "../../src/ui/help-lines.ts";
import { COMMANDS } from "../../src/discord/commands/index.ts";
import { enabledCommands } from "../../src/app/command-loader.ts";
import { withConfig } from "../helpers/config.ts";

// 실행 목록(켜진 명령)으로 만든다. /help 가 client.commands 로 하는 것과 같다
const sectionsNow = () => helpSections(enabledCommands().map((command) => ({ defined: command.data.toJSON(), help: command.help })));

const EXPECTED = [
  {
    name: "🎵 재생",
    lines: ["`/play`: 곡을 재생해요", "`/playfirst`: 대기열 맨 앞에 곡을 넣어요 🔒", "`/pause`: 일시정지 상태를 전환해요 🔒", "`/stop`: 재생을 멈추고 음성 채널에서 나가요 🔒", "`/skip`: 현재 재생 중인 곡을 건너뛰어요 🔒 (자기가 추가한 곡은 누구나)", "`/previous`: 이전 곡으로 되돌아가요 🔒", "`/replay`: 현재 곡을 처음부터 재생해요 🔒", "`/seek`: 현재 곡의 특정 시간으로 이동해요 🔒", "`/highlight`: 현재 곡의 하이라이트로 이동해요 🔒"],
  },
  {
    name: "📋 대기열",
    lines: ["`/queue`: 대기열을 보여줘요", "`/clear`: 대기열을 비워요 🔒", "`/remove`: 대기열에서 선택한 곡을 빼요 🔒 (자기가 추가한 곡은 누구나)", "`/move`: 대기열에서 곡의 순번을 옮겨요 🔒", "`/shuffle`: 대기열을 무작위로 섞어요 🔒"],
  },
  {
    name: "🎛️ 모드 & 오디오",
    lines: ["`/loop`: 반복 모드를 설정해요 🔒", "`/autoplay`: 자동재생을 켜거나 꺼요 🔒", "`/volume`: 볼륨을 설정해요 🔒"],
  },
  {
    name: "🔍 탐색 & 정보",
    lines: ["`/search`: 유튜브에서 검색해서 재생해요", "`/nowplaying`: 재생 중인 곡의 정보를 보여줘요"],
  },
  {
    name: "📡 채널 & 세션",
    lines: ["`/join`: 봇을 음성 채널에 참가시켜요", "`/leave`: 대기열을 저장하고 음성 채널에서 나가요 🔒", "`/setchannel`: 제 전용 채널을 설정해요 (곡 요청 및 공지에 사용돼요) 🛡️", "`/setdjrole`: DJ 역할을 설정해요 (복수 선택 가능) 🛡️", "`/setplaylistlimit`: 재생목록을 넣을 때 한 번에 넣을 곡 수를 정해요 🛡️", "`/sponsorblock`: SponsorBlock 기능 설정 패널을 열어요 🛡️", "`/dashboard`: 재생 패널을 이 채널의 맨 아래에 다시 표시해요 (봇 전용 채널에서는 전원, 그 외 🔒)"],
  },
  {
    name: "📊 봇 정보",
    lines: ["`/ping`: 봇의 응답 시간을 측정해요 🛡️", "`/system`: 봇의 시스템 정보를 보여줘요 (봇 운영자)", "`/cachestatus`: 오디오 캐시 통계를 보여줘요 🛡️", "`/license`: 라이선스와 소스 코드 저장소를 표시해요"],
  },
  {
    name: "🌐 지원 플랫폼",
    lines: ["🔴 **YouTube** - 영상 링크 및 검색", "🟢 **Spotify** - 곡, 재생목록, 앨범 링크", "🟠 **SoundCloud** - 곡 링크 및 검색", "🔗 **직접 링크** - 미디어 파일 URL (MP3 · FLAC · M4A · MP4 등)"],
  },
];

test("명령 정의에서 만든 /help 의 줄(섹션 · 순서 · 권한 표시)", () => {
  const sections = withConfig({ sponsorblock: { enabled: true } }, sectionsNow);
  assert.deepEqual(sections, EXPECTED);
});

test("꺼진 명령은 도움말에도 없다", () => {
  const lines = withConfig({ sponsorblock: { enabled: false } }, sectionsNow).flatMap((section) => section.lines);
  assert.equal(
    lines.some((line) => line.startsWith("`/sponsorblock") || line.startsWith("`/highlight")),
    false,
  );
  assert.ok(lines.some((line) => line.startsWith("`/play`")));
});

test("help 를 적은 명령은 도움말에 한 번씩, /help 자신은 싣지 않는다", () => {
  const lines = withConfig({ sponsorblock: { enabled: true } }, sectionsNow).flatMap((section) => section.lines);
  for (const command of COMMANDS) {
    const count = lines.filter((line) => line.startsWith(`\`/${command.data.name}\``)).length;
    assert.equal(count, command.help ? 1 : 0, command.data.name);
  }
  assert.equal(COMMANDS.find((command) => command.data.name === "help")?.help, null);
});

test('"서버 관리 권한" 표시는 디스코드가 그 권한으로 막는 명령(default_member_permissions)과 같다', () => {
  for (const command of COMMANDS) {
    const gated = Boolean(command.data.toJSON().default_member_permissions);
    assert.equal(command.help?.tier === "moderator", gated, command.data.name);
  }
});

test("줄에는 옵션을 적지 않는다(입력할 때 디스코드 자동완성이 보인다). 권한 표시를 끝에 붙인다", () => {
  const [section] = helpSections([
    { defined: { name: "x", description: "en", description_localizations: { ko: "설명" } }, help: { section: "play", tier: "dj" } },
    { defined: { name: "y", description: "en", description_localizations: { ko: "설명" } }, help: { section: "play", tier: "moderator" } },
    { defined: { name: "z", description: "en", description_localizations: { ko: "설명" } }, help: { section: "play", tier: "everyone" } },
  ]);
  assert.deepEqual(section.lines, ["`/x`: 설명 🔒", "`/y`: 설명 🛡️", "`/z`: 설명"]);
});
