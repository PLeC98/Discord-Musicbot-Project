// src/ui/text/errors.ts — 오류 · 거절 안내를 모두 적어 둔다(경고 수준 · 이모지 · 머리 줄, 본문은 다음 줄). 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as errors from "../../../src/ui/text/errors.ts";
import { shown } from "../../helpers/notice.ts";

test("뜻마다 하나인 문장", () => {
  assert.deepEqual(
    {
      voiceRequired: shown(errors.voiceRequired()),
      noPlayer: shown(errors.noPlayer()),
      sameChannelRequired: shown(errors.sameChannelRequired()),
      notDj: shown(errors.notDj()),
      noTrack: shown(errors.noTrack()),
      botCannotJoin: shown(errors.botCannotJoin()),
      queueEmpty: shown(errors.queueEmpty()),
      staleSession: shown(errors.staleSession()),
      processingFailed: shown(errors.processingFailed()),
      unknownInteraction: shown(errors.unknownInteraction()),
      liveUpcoming: shown(errors.liveUpcoming()),
      liveNoFfmpeg: shown(errors.liveNoFfmpeg()),
      liveNoSeek: shown(errors.liveNoSeek()),
      liveNoLoop: shown(errors.liveNoLoop()),
      badTime: shown(errors.badTime()),
      jumpTargetGone: shown(errors.jumpTargetGone()),
      needManageGuild: shown(errors.needManageGuild()),
      channelSetFailed: shown(errors.channelSetFailed()),
      settingsSaveFailed: shown(errors.settingsSaveFailed()),
      djRoleSaveFailed: shown(errors.djRoleSaveFailed()),
      playlistLimitOutOfRange: shown(errors.playlistLimitOutOfRange(1, 100, null)),
      playlistLimitAtQueueCap: shown(errors.playlistLimitOutOfRange(1, 100, 100)),
      onlyInBotChannel: shown(errors.onlyInBotChannel("42")),
      ownerOnly: shown(errors.ownerOnly()),
      helpRefreshFailed: shown(errors.helpRefreshFailed()),
      systemRefreshFailed: shown(errors.systemRefreshFailed()),
      noSearchResults: shown(errors.noSearchResults()),
      searchOwnerOnly: shown(errors.searchOwnerOnly()),
      commandFailed: shown(errors.commandFailed()),
      guildOnly: shown(errors.guildOnly()),
      processingFailedInChannel: shown(errors.processingFailedInChannel()),
      cannotStart: shown(errors.cannotStart()),
      noResult: shown(errors.noResult()),
    },
    {
      voiceRequired: "warning 🎧 음성 채널에 있어야 합니다!",
      noPlayer: "warning ⚠️ 현재 재생 중인 음악이 없습니다!",
      sameChannelRequired: "warning 🎧 봇과 같은 음성 채널에 있어야 합니다!",
      notDj: "warning 🚫 음악 컨트롤 권한이 없습니다. (DJ 역할 필요)",
      noTrack: "warning ⚠️ 현재 재생 중인 노래가 없습니다!",
      botCannotJoin: "error 🚫 이 음성 채널에서 말할 권한이 없습니다!",
      queueEmpty: "warning ⚠️ 대기열에 노래가 없습니다!",
      staleSession: "warning ⌛ 이 버튼은 더 이상 유효하지 않습니다! 음악 시스템이 재시작되었습니다.",
      processingFailed: "error ❌ 처리 중 오류가 발생했습니다!",
      unknownInteraction: "warning ⌛ 오래됐거나 알 수 없는 버튼이에요. 명령이나 패널을 다시 불러 주세요.",
      liveUpcoming: "warning 🔴 아직 시작하지 않은 방송이에요. 방송이 시작된 뒤에 다시 넣어 주세요!",
      liveNoFfmpeg: "error 🔴 지금 설치된 ffmpeg로는 라이브 방송을 재생할 수 없어요. `pnpm run install:ffmpeg`로 받은 빌드를 쓰거나 FFMPEG_PATH를 확인해 주세요.",
      liveNoSeek: "warning 🔴 라이브 방송은 구간 이동을 할 수 없어요.",
      liveNoLoop: "warning 🔴 라이브 방송이 있으면 반복을 켤 수 없어요.",
      badTime: "warning ✏️ 올바른 형식으로 입력하세요. (예: `1:30`, `3m20s`, `90`)",
      jumpTargetGone: "warning ⌛ 선택한 곡을 대기열에서 찾을 수 없습니다!",
      needManageGuild: "warning 🚫 서버 관리 권한이 필요해요.",
      channelSetFailed: "error ❌ 채널 설정 중 오류가 발생했어요.",
      settingsSaveFailed: "error ❌ 설정을 저장하지 못했어요.",
      djRoleSaveFailed: "error ❌ 저장 실패\nDJ 역할 설정 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.",
      playlistLimitOutOfRange: "warning ✏️ 1~100곡 사이로 정해 주세요.",
      playlistLimitAtQueueCap: "warning ✏️ 1~100곡 사이로 정해 주세요. 대기열 상한(100곡)보다 클 수 없어요.",
      onlyInBotChannel: "warning 🚫 이 명령어는 <#42> 채널에서만 사용할 수 있습니다!",
      ownerOnly: "warning 🚫 봇 운영자만 사용할 수 있습니다!",
      helpRefreshFailed: "error ❌ 도움말을 새로고침하는 중 오류가 발생했습니다!",
      systemRefreshFailed: "error ❌ 시스템 정보를 새로고침하는 중 오류가 발생했습니다!",
      noSearchResults: "warning 🔍 검색 결과가 없습니다!",
      searchOwnerOnly: "warning 🚫 검색을 요청한 사용자만 선택할 수 있습니다!",
      commandFailed: "error ❌ 명령어 실행 중 오류가 발생했습니다!",
      guildOnly: "warning 🚫 서버에서만 쓸 수 있는 명령이에요.",
      processingFailedInChannel: "error ❌ 처리 중 오류가 발생했어요.",
      cannotStart: "error ❌ 재생을 시작할 수 없습니다.",
      noResult: "warning 🔍 결과를 찾을 수 없습니다!",
    },
  );
});

test("오류 종류마다. 모르는 종류는 unknown", () => {
  const expected: Record<string, string> = {
    "bot-check": "error ❌ YouTube가 이 요청을 차단했습니다 (봇 감지)\nYouTube가 이 서버의 IP 주소에서 오는 요청을 거부하고 있습니다.\n\n**해결 방법:** 잠시 후 다시 시도하세요. 계속되면 봇 운영자에게 알려 주세요.",
    "age-restricted": "warning 🔒 연령 제한 영상은 재생할 수 없어요.",
    "age-cookies-invalid": "error 🔒 연령 제한 영상을 일시적으로 재생할 수 없어요. 오류가 계속되면 봇 운영자에게 알려주세요.",
    "video-unavailable": "warning 🔒 비공개이거나 삭제된 영상은 재생할 수 없어요.",
    "track-unavailable": "warning 🔒 없거나 비공개인 곡이에요.",
    "preview-only": "warning 🔒 미리듣기(30초)만 열린 곡이라 틀 수 없어요.",
    "playlist-unavailable": "warning 🔒 없거나 비공개인 재생목록이에요.",
    "spotify-unavailable": "error 🔒 지금은 스포티파이 링크를 재생할 수 없어요.",
    "link-unavailable": "warning 🔗 재생할 수 없는 링크예요.",
    "geo-blocked": "warning 🔒 지역 차단 콘텐츠\n이 동영상은 봇이 호스팅된 지역에서 제한되어 있습니다.\n\n**해결 방법:** 다른 링크를 시도해 보세요.",
    "rate-limited": "error ❌ 요청이 너무 많습니다 (속도 제한)\nYouTube 또는 다른 플랫폼이 일시적으로 요청을 차단하고 있습니다.\n\n**해결 방법:** 몇 분 기다렸다가 다시 시도하세요. 자주 발생하면 봇 운영자에게 알려 주세요.",
    "no-youtube-match": "warning 🔍 Spotify 트랙을 YouTube에서 찾을 수 없습니다\n이 곡에 대한 일치하는 YouTube 동영상을 찾을 수 없었습니다.\n\n**해결 방법:** Spotify 링크 대신 곡 이름으로 직접 검색하거나 YouTube 링크를 붙여넣으세요.",
    network: "error ❌ 네트워크 오류\n봇이 음악 플랫폼에 연결할 수 없었습니다. 보통 일시적인 문제입니다.\n\n**해결 방법:** 잠시 기다렸다가 다시 시도하세요.",
    "stream-failed": "error ❌ 오디오 스트림 실패\n봇이 트랙을 찾았지만 오디오 스트림을 시작할 수 없었습니다.\n\n**해결 방법:** 다시 시도하거나 다른 버전의 곡을 시도해 보세요.",
    "voice-permission": "error 🚫 음성 채널 권한 없음\n봇이 음성 채널에 참여하거나 말할 권한이 없습니다.\n\n**해결 방법:** 음성 채널 설정 → 권한 → 봇에게 **연결** 및 **말하기** 권한을 부여하세요.",
    "text-permission": "error 🚫 제게 권한이 없어요.\n봇이 그 텍스트 채널에 메시지를 올릴 권한이 없어요. 서버 관리자에게 봇의 권한을 확인해 달라고 해 주세요.",
    "other-permission": "error 🚫 제게 권한이 없어요.\n봇이 그 행동을 하는 데에 필요한 권한이 없어요. 서버 관리자에게 봇의 권한 설정을 확인해달라고 해 주세요.",
    "voice-failed": "error 🎧 음성 채널에 연결하지 못했습니다!",
    unknown: "error ❌ 예상치 못한 오류가 발생했습니다\n요청을 처리하는 중 문제가 발생했습니다.\n\n**해결 방법:** 잠시 후 다시 시도하세요. 문제가 계속되면 봇 운영자에게 알려 주세요.",
  };
  for (const [kind, sentence] of Object.entries(expected)) assert.equal(shown(errors.forKind(kind)), sentence, kind);
  assert.equal(shown(errors.forKind("never-seen")), expected.unknown);
});

test("곡을 찾거나 담지 못한 까닭마다. 오류로 알릴 까닭이면 null", () => {
  const detail = { skipped: 7, max: 100 };
  const expected: Record<string, string> = {
    "no-result": "warning 🔍 결과를 찾을 수 없습니다!",
    "youtube-unplayable": "warning 🔗 재생할 수 없는 유튜브 주소입니다.",
    "unsupported-link": "warning 🔗 지원하지 않는 링크입니다.",
    "unsupported-soundcloud": "warning 🔗 지원하지 않는 사운드클라우드 링크예요. 곡이나 세트 링크를 넣어 주세요.",
    "nothing-playable": "warning 🔒 이 세트의 앞 곡들은 모두 틀 수 없어요(미리듣기만 열린 곡 · 지역 제한 등).",
    "live-upcoming": "warning 🔴 아직 시작하지 않은 방송이에요. 방송이 시작된 뒤에 다시 넣어 주세요!",
    "live-no-ffmpeg": "error 🔴 지금 설치된 ffmpeg로는 라이브 방송을 재생할 수 없어요. `pnpm run install:ffmpeg`로 받은 빌드를 쓰거나 FFMPEG_PATH를 확인해 주세요.",
    "queue-empty": "warning ⚠️ 대기열에 트랙이 없습니다!",
    "voice-failed": "error 🎧 음성 채널에 연결하지 못했습니다!",
    "queue-full": "warning ⚠️ 대기열이 가득 찼습니다 (최대 100곡)",
    "no-player": "warning ⚠️ 음악 플레이어를 찾을 수 없습니다.",
    threw: "error ❌ 음악을 처리하는 중 오류가 발생했습니다.",
    "more-no-player": "warning ⚠️ 현재 재생 중인 음악이 없습니다!",
    "more-nothing-playable": "warning 🔒 받을 수 없는 곡(미리듣기 · 지역 제한 등)뿐이라 넣지 못했어요(7곡).",
    "more-nothing-found": "warning 🔍 더 넣을 곡을 찾지 못했어요.",
  };
  for (const [code, sentence] of Object.entries(expected)) {
    const notice = errors.addRefusal(code, detail);
    assert.equal(notice && shown(notice), sentence, code);
  }
  for (const code of ["lookup-failed", "play-failed", "play-threw", "live-ended"]) assert.equal(errors.addRefusal(code, detail), null, code);
});

test("재생 조작의 거절. 모르는 까닭은 일반 실패", () => {
  const cases: [errors.Refusal, string][] = [
    [{ code: "no-player" }, "warning ⚠️ 현재 재생 중인 음악이 없습니다!"],
    [{ code: "no-track" }, "warning ⚠️ 현재 재생 중인 노래가 없습니다!"],
    [{ code: "failed" }, "error ❌ 작업이 실패했습니다!"],
    [{ code: "held", reason: "mute" }, "warning 🔇 봇이 서버에서 음소거되어 멈춰 있습니다. 음소거가 풀리면 이어서 재생합니다."],
    [{ code: "held", reason: "alone" }, "warning ⏳ 음성 채널에 아무도 없어 멈춰 있습니다. 누가 들어오면 이어서 재생합니다."],
    [{ code: "held", reason: "other" }, "error ❌ 다른 까닭으로 멈춰 있어 이어서 재생할 수 없습니다."],
    [{ code: "skip-failed" }, "warning ⚠️ 노래가 건너뛰어지지 않았습니다!"],
    [{ code: "previous-failed" }, "warning ⚠️ 이전 노래로 이동하지 못했습니다!"],
    [{ code: "jump-failed" }, "warning ⚠️ 곡으로 이동하지 못했습니다!"],
    [{ code: "nothing-to-skip" }, "warning ⚠️ 건너뛸 노래가 없습니다! 대기열에 노래가 없습니다."],
    [{ code: "no-previous" }, "warning ⚠️ 이전 노래가 없습니다!"],
    [{ code: "live-no-seek" }, "warning 🔴 라이브 방송은 구간 이동을 할 수 없어요."],
    [{ code: "starting" }, "warning ⏳ 재생을 준비 중입니다. 잠시 후 다시 시도해 주세요."],
    [{ code: "beyond-end", durationMs: 185000 }, "warning ✏️ 입력한 시간이 곡 길이를 초과합니다. (최대: 3:05)"],
    [{ code: "beyond-end" }, "warning ✏️ 입력한 시간이 곡 길이를 초과합니다. (최대: ?)"],
    [{ code: "no-highlight" }, "warning ⚠️ 이 곡에는 SponsorBlock 하이라이트 지점이 없어요."],
    [{ code: "bad-volume" }, "warning ✏️ 볼륨은 0에서 100 사이의 숫자여야 합니다!"],
    [{ code: "bad-loop-mode" }, "warning ✏️ 반복 모드가 올바르지 않습니다."],
    [{ code: "live-no-loop" }, "warning 🔴 라이브 방송이 있으면 반복을 켤 수 없어요."],
    [{ code: "too-few-to-shuffle" }, "warning ⚠️ 셔플하려면 대기열에 최소 2개의 노래가 있어야 합니다!"],
    [{ code: "too-few-to-move" }, "warning ⚠️ 순서를 변경하려면 대기열에 2곡 이상 있어야 합니다."],
    [{ code: "queue-empty" }, "warning ⚠️ 대기열에 노래가 없습니다!"],
    [{ code: "bad-position", size: 3 }, "warning ✏️ 대기열에 3개의 곡만 있습니다. (1 ~ 3 범위로 입력하세요)"],
    [{ code: "same-position" }, "warning ✏️ 현재 위치와 이동할 위치가 같습니다."],
    [{ code: "unknown-genre", genre: "jazz" }, "warning ⌛ 알 수 없는 장르입니다: `jazz`. 자동재생 버튼을 다시 눌러 선택해 주세요."],
    [{ code: "what-is-this" }, "error ❌ 작업이 실패했습니다!"],
  ];
  for (const [r, sentence] of cases) assert.equal(shown(errors.refusal(r)), sentence, r.code);
});

test("권한 판정이 막은 까닭마다", () => {
  assert.deepEqual(
    (["voice-required", "same-channel-required", "not-dj", "bot-cannot-join"] as const).map((code) => shown(errors.permission(code))),
    ["warning 🎧 음성 채널에 있어야 합니다!", "warning 🎧 봇과 같은 음성 채널에 있어야 합니다!", "warning 🚫 음악 컨트롤 권한이 없습니다. (DJ 역할 필요)", "error 🚫 이 음성 채널에서 말할 권한이 없습니다!"],
  );
});
