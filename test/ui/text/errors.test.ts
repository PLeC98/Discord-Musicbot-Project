// src/ui/text/errors.ts — 오류 · 거절 문장을 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as errors from "../../../src/ui/text/errors.ts";

test("뜻마다 하나인 문장", () => {
  assert.deepEqual(
    {
      voiceRequired: errors.voiceRequired(),
      noPlayer: errors.noPlayer(),
      sameChannelRequired: errors.sameChannelRequired(),
      notDj: errors.notDj(),
      noTrack: errors.noTrack(),
      botCannotJoin: errors.botCannotJoin(),
      queueEmpty: errors.queueEmpty(),
      staleSession: errors.staleSession(),
      processingFailed: errors.processingFailed(),
      unknownInteraction: errors.unknownInteraction(),
      liveUpcoming: errors.liveUpcoming(),
      liveNoFfmpeg: errors.liveNoFfmpeg(),
      liveNoSeek: errors.liveNoSeek(),
      liveNoLoop: errors.liveNoLoop(),
      badTime: errors.badTime(),
      jumpTargetGone: errors.jumpTargetGone(),
      needManageGuild: errors.needManageGuild(),
      channelSetFailed: errors.channelSetFailed(),
      settingsSaveFailed: errors.settingsSaveFailed(),
      playlistLimitOutOfRange: errors.playlistLimitOutOfRange(1, 100, null),
      playlistLimitAtQueueCap: errors.playlistLimitOutOfRange(1, 100, 100),
      onlyInBotChannel: errors.onlyInBotChannel("42"),
      ownerOnly: errors.ownerOnly(),
      helpRefreshFailed: errors.helpRefreshFailed(),
      systemRefreshFailed: errors.systemRefreshFailed(),
      noSearchResults: errors.noSearchResults(),
      searchOwnerOnly: errors.searchOwnerOnly(),
      commandFailed: errors.commandFailed(),
      guildOnly: errors.guildOnly(),
      processingFailedInChannel: errors.processingFailedInChannel(),
      cannotStart: errors.cannotStart(),
      noResult: errors.noResult(),
    },
    {
      voiceRequired: "❌ 음성 채널에 있어야 합니다!",
      noPlayer: "❌ 현재 재생 중인 음악이 없습니다!",
      sameChannelRequired: "❌ 봇과 같은 음성 채널에 있어야 합니다!",
      notDj: "❌ 음악 컨트롤 권한이 없습니다. (DJ 역할 필요)",
      noTrack: "❌ 현재 재생 중인 노래가 없습니다!",
      botCannotJoin: "❌ 이 음성 채널에서 말할 권한이 없습니다!",
      queueEmpty: "❌ 대기열에 노래가 없습니다!",
      staleSession: "❌ 이 버튼은 더 이상 유효하지 않습니다! 음악 시스템이 재시작되었습니다.",
      processingFailed: "❌ 처리 중 오류가 발생했습니다!",
      unknownInteraction: "❌ 오래됐거나 알 수 없는 버튼이에요. 명령이나 패널을 다시 불러 주세요.",
      liveUpcoming: "❌ 아직 시작하지 않은 방송이에요. 방송이 시작된 뒤에 다시 넣어 주세요!",
      liveNoFfmpeg: "❌ 지금 설치된 ffmpeg로는 라이브 방송을 재생할 수 없어요. `pnpm run install:ffmpeg`로 받은 빌드를 쓰거나 FFMPEG_PATH를 확인해 주세요.",
      liveNoSeek: "❌ 라이브 방송은 구간 이동을 할 수 없어요.",
      liveNoLoop: "❌ 라이브 방송이 있으면 반복을 켤 수 없어요.",
      badTime: "❌ 올바른 형식으로 입력하세요. (예: `1:30`, `3m20s`, `90`)",
      jumpTargetGone: "❌ 선택한 곡을 대기열에서 찾을 수 없습니다!",
      needManageGuild: "❌ 서버 관리 권한이 필요해요.",
      channelSetFailed: "❌ 채널 설정 중 오류가 발생했어요.",
      settingsSaveFailed: "❌ 설정을 저장하지 못했어요.",
      playlistLimitOutOfRange: "❌ 1~100곡 사이로 정해 주세요.",
      playlistLimitAtQueueCap: "❌ 1~100곡 사이로 정해 주세요. 대기열 상한(100곡)보다 클 수 없어요.",
      onlyInBotChannel: "❌ 이 명령어는 <#42> 채널에서만 사용할 수 있습니다!",
      ownerOnly: "❌ 봇 운영자만 사용할 수 있습니다!",
      helpRefreshFailed: "❌ 도움말을 새로고침하는 중 오류가 발생했습니다!",
      systemRefreshFailed: "❌ 시스템 정보를 새로고침하는 중 오류가 발생했습니다!",
      noSearchResults: "❌ 검색 결과가 없습니다!",
      searchOwnerOnly: "❌ 검색을 요청한 사용자만 선택할 수 있습니다!",
      commandFailed: "❌ 명령어 실행 중 오류가 발생했습니다!",
      guildOnly: "❌ 서버에서만 쓸 수 있는 명령이에요.",
      processingFailedInChannel: "❌ 처리 중 오류가 발생했어요.",
      cannotStart: "재생을 시작할 수 없습니다.",
      noResult: "❌ 결과를 찾을 수 없습니다!",
    },
  );
});

test("오류 종류마다. 모르는 종류는 unknown", () => {
  const expected: Record<string, string> = {
    "bot-check": "❌ **YouTube가 이 요청을 차단했습니다 (봇 감지)**\nYouTube가 이 서버의 IP 주소에서 오는 요청을 거부하고 있습니다.\n\n**해결 방법:** 잠시 후 다시 시도하세요. 계속되면 봇 운영자에게 알려 주세요.",
    "age-restricted": "❌ 연령 제한 영상은 재생할 수 없어요.",
    "age-cookies-invalid": "❌ 연령 제한 영상을 일시적으로 재생할 수 없어요. 오류가 계속되면 봇 운영자에게 알려주세요.",
    "video-unavailable": "❌ 비공개이거나 삭제된 영상은 재생할 수 없어요.",
    "track-unavailable": "❌ 없거나 비공개인 곡이에요.",
    "preview-only": "❌ 미리듣기(30초)만 열린 곡이라 틀 수 없어요.",
    "playlist-unavailable": "❌ 없거나 비공개인 재생목록이에요.",
    "spotify-unavailable": "❌ 지금은 스포티파이 링크를 재생할 수 없어요.",
    "link-unavailable": "❌ 재생할 수 없는 링크예요.",
    "geo-blocked": "❌ **지역 차단 콘텐츠**\n이 동영상은 봇이 호스팅된 지역에서 제한되어 있습니다.\n\n**해결 방법:** 다른 링크를 시도해 보세요.",
    "rate-limited": "❌ **요청이 너무 많습니다 (속도 제한)**\nYouTube 또는 다른 플랫폼이 일시적으로 요청을 차단하고 있습니다.\n\n**해결 방법:** 몇 분 기다렸다가 다시 시도하세요. 자주 발생하면 봇 운영자에게 알려 주세요.",
    "no-youtube-match": "❌ **Spotify 트랙을 YouTube에서 찾을 수 없습니다**\n이 곡에 대한 일치하는 YouTube 동영상을 찾을 수 없었습니다.\n\n**해결 방법:** Spotify 링크 대신 곡 이름으로 직접 검색하거나 YouTube 링크를 붙여넣으세요.",
    network: "❌ **네트워크 오류**\n봇이 음악 플랫폼에 연결할 수 없었습니다. 보통 일시적인 문제입니다.\n\n**해결 방법:** 잠시 기다렸다가 다시 시도하세요.",
    "stream-failed": "❌ **오디오 스트림 실패**\n봇이 트랙을 찾았지만 오디오 스트림을 시작할 수 없었습니다.\n\n**해결 방법:** 다시 시도하거나 다른 버전의 곡을 시도해 보세요.",
    "voice-permission": "❌ **음성 채널 권한 없음**\n봇이 음성 채널에 참여하거나 말할 권한이 없습니다.\n\n**해결 방법:** 음성 채널 설정 → 권한 → 봇에게 **연결** 및 **말하기** 권한을 부여하세요.",
    unknown: "❌ **예상치 못한 오류가 발생했습니다**\n요청을 처리하는 중 문제가 발생했습니다.\n\n**해결 방법:** 잠시 후 다시 시도하세요. 문제가 계속되면 봇 운영자에게 알려 주세요.",
  };
  for (const [kind, sentence] of Object.entries(expected)) assert.equal(errors.forKind(kind), sentence, kind);
  assert.equal(errors.forKind("never-seen"), expected.unknown);
});

test("곡을 찾거나 담지 못한 까닭마다. 오류로 알릴 까닭이면 null", () => {
  const detail = { skipped: 7, max: 100 };
  const expected: Record<string, string> = {
    "no-result": "❌ 결과를 찾을 수 없습니다!",
    "youtube-unplayable": "❌ 재생할 수 없는 유튜브 주소입니다.",
    "unsupported-link": "❌ 지원하지 않는 링크입니다.",
    "unsupported-soundcloud": "❌ 지원하지 않는 사운드클라우드 링크예요. 곡이나 세트 링크를 넣어 주세요.",
    "nothing-playable": "❌ 이 세트의 앞 곡들은 모두 틀 수 없어요(미리듣기만 열린 곡 · 지역 제한 등).",
    "live-upcoming": "❌ 아직 시작하지 않은 방송이에요. 방송이 시작된 뒤에 다시 넣어 주세요!",
    "live-no-ffmpeg": "❌ 지금 설치된 ffmpeg로는 라이브 방송을 재생할 수 없어요. `pnpm run install:ffmpeg`로 받은 빌드를 쓰거나 FFMPEG_PATH를 확인해 주세요.",
    "queue-empty": "대기열에 트랙이 없습니다!",
    "voice-failed": "음성 채널에 연결하지 못했습니다!",
    "queue-full": "대기열이 가득 찼습니다 (최대 100곡)",
    "no-player": "음악 플레이어를 찾을 수 없습니다.",
    threw: "음악을 처리하는 중 오류가 발생했습니다.",
    "more-no-player": "❌ 현재 재생 중인 음악이 없습니다!",
    "more-nothing-playable": "받을 수 없는 곡(미리듣기 · 지역 제한 등)뿐이라 넣지 못했어요(7곡).",
    "more-nothing-found": "더 넣을 곡을 찾지 못했어요.",
  };
  for (const [code, sentence] of Object.entries(expected)) assert.equal(errors.addRefusal(code, detail), sentence, code);
  for (const code of ["lookup-failed", "play-failed", "play-threw", "live-ended"]) assert.equal(errors.addRefusal(code, detail), null, code);
});

test("재생 조작의 거절. 모르는 까닭은 일반 실패", () => {
  const cases: [errors.Refusal, string][] = [
    [{ code: "no-player" }, "❌ 현재 재생 중인 음악이 없습니다!"],
    [{ code: "no-track" }, "❌ 현재 재생 중인 노래가 없습니다!"],
    [{ code: "failed" }, "❌ 작업이 실패했습니다!"],
    [{ code: "held", reason: "mute" }, "❌ 봇이 서버에서 음소거되어 멈춰 있습니다. 음소거가 풀리면 이어서 재생합니다."],
    [{ code: "held", reason: "alone" }, "❌ 음성 채널에 아무도 없어 멈춰 있습니다. 누가 들어오면 이어서 재생합니다."],
    [{ code: "held", reason: "other" }, "❌ 다른 까닭으로 멈춰 있어 이어서 재생할 수 없습니다."],
    [{ code: "skip-failed" }, "❌ 노래가 건너뛰어지지 않았습니다!"],
    [{ code: "previous-failed" }, "❌ 이전 노래로 이동하지 못했습니다!"],
    [{ code: "jump-failed" }, "❌ 곡으로 이동하지 못했습니다!"],
    [{ code: "nothing-to-skip" }, "❌ 건너뛸 노래가 없습니다! 대기열에 노래가 없습니다."],
    [{ code: "no-previous" }, "❌ 이전 노래가 없습니다!"],
    [{ code: "live-no-seek" }, "❌ 라이브 방송은 구간 이동을 할 수 없어요."],
    [{ code: "starting" }, "❌ 재생을 준비 중입니다. 잠시 후 다시 시도해 주세요."],
    [{ code: "beyond-end", durationMs: 185000 }, "❌ 입력한 시간이 곡 길이를 초과합니다. (최대: 3:05)"],
    [{ code: "beyond-end" }, "❌ 입력한 시간이 곡 길이를 초과합니다. (최대: ?)"],
    [{ code: "no-highlight" }, "❌ 이 곡에는 SponsorBlock 하이라이트 지점이 없어요."],
    [{ code: "bad-volume" }, "❌ 볼륨은 0에서 100 사이의 숫자여야 합니다!"],
    [{ code: "bad-loop-mode" }, "❌ 반복 모드가 올바르지 않습니다."],
    [{ code: "live-no-loop" }, "❌ 라이브 방송이 있으면 반복을 켤 수 없어요."],
    [{ code: "too-few-to-shuffle" }, "❌ 셔플하려면 대기열에 최소 2개의 노래가 있어야 합니다!"],
    [{ code: "too-few-to-move" }, "❌ 순서를 변경하려면 대기열에 2곡 이상 있어야 합니다."],
    [{ code: "queue-empty" }, "❌ 대기열에 노래가 없습니다!"],
    [{ code: "bad-position", size: 3 }, "❌ 대기열에 3개의 곡만 있습니다. (1 ~ 3 범위로 입력하세요)"],
    [{ code: "same-position" }, "❌ 현재 위치와 이동할 위치가 같습니다."],
    [{ code: "unknown-genre", genre: "jazz" }, "❌ 알 수 없는 장르입니다: `jazz`. 자동재생 버튼을 다시 눌러 선택해 주세요."],
    [{ code: "what-is-this" }, "❌ 작업이 실패했습니다!"],
  ];
  for (const [r, sentence] of cases) assert.equal(errors.refusal(r), sentence, r.code);
});

test("권한 판정이 막은 까닭마다", () => {
  assert.deepEqual((["voice-required", "same-channel-required", "not-dj", "bot-cannot-join"] as const).map(errors.permission), ["❌ 음성 채널에 있어야 합니다!", "❌ 봇과 같은 음성 채널에 있어야 합니다!", "❌ 음악 컨트롤 권한이 없습니다. (DJ 역할 필요)", "❌ 이 음성 채널에서 말할 권한이 없습니다!"]);
});
