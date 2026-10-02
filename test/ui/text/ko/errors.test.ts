// src/ui/text/ko/errors.ts — 오류 · 거절 안내를 모두 적어 둔다(경고 수준 · 이모지 · 머리 줄, 본문은 다음 줄). 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as errors from "../../../../src/ui/text/ko/errors.ts";
import { shown } from "../../../helpers/notice.ts";

test("뜻마다 하나인 문장", () => {
  assert.deepEqual(
    {
      mustBeInVoice: shown(errors.mustBeInVoice()),
      noSong: shown(errors.noSong()),
      mustBeInSameVoice: shown(errors.mustBeInSameVoice()),
      mustDj: shown(errors.mustDj()),
      permissionVoice: shown(errors.permissionVoice()),
      queueEmpty: shown(errors.queueEmpty()),
      staleSession: shown(errors.staleSession()),
      processingFailed: shown(errors.processingFailed()),
      unknownCommand: shown(errors.unknownCommand()),
      unknownInteraction: shown(errors.unknownInteraction()),
      liveUpcoming: shown(errors.liveUpcoming()),
      liveNoFfmpeg: shown(errors.liveNoFfmpeg()),
      liveNoSeek: shown(errors.liveNoSeek()),
      liveNoLoop: shown(errors.liveNoLoop()),
      badTime: shown(errors.badTime()),
      jumpTargetGone: shown(errors.jumpTargetGone()),
      mustModerator: shown(errors.mustModerator()),
      channelSetFailed: shown(errors.channelSetFailed()),
      settingsSaveFailed: shown(errors.settingsSaveFailed()),
      djRoleSaveFailed: shown(errors.djRoleSaveFailed()),
      playlistLimitOutOfRange: shown(errors.playlistLimitOutOfRange(1, 100, null)),
      playlistLimitAtQueueCap: shown(errors.playlistLimitOutOfRange(1, 100, 100)),
      onlyInBotChannel: shown(errors.onlyInBotChannel("42")),
      mustOwner: shown(errors.mustOwner()),
      refreshFailed: shown(errors.refreshFailed()),
      noSearchResults: shown(errors.noSearchResults()),
      searchOwnerOnly: shown(errors.searchOwnerOnly()),
      commandFailed: shown(errors.commandFailed()),
      guildOnly: shown(errors.guildOnly()),
      cannotStart: shown(errors.cannotStart()),
      noSongResult: shown(errors.noSongResult()),
    },
    {
      mustBeInVoice: "warning 🎧 먼저 음성 채널에 접속해 주세요!\n그래야 제가 어느 채널에서 곡을 틀지 알 수 있어요.",
      noSong: "warning ⚠️ 재생 중인 곡이 없어요!\n이 조작을 하려면 재생 중인 곡이 있어야 해요.",
      mustBeInSameVoice: "warning 🎧 봇과 같은 음성 채널에 있어야 해요!\n곡을 듣고 있는 사람들만 재생을 제어할 수 있어요.",
      mustDj: "warning 🚫 이 조작을 할 권한이 없어요.\n이 조작을 하려면 DJ 역할을 갖고 있어야 해요.",
      permissionVoice: "error 🚫 제게 권한이 없어요.\n봇이 그 음성 채널에 접속하거나 말할 권한이 없어요.",
      queueEmpty: "warning ⚠️ 대기열에 곡이 없어요!\n이 조작을 하려면 대기열에 곡이 있어야 해요.",
      staleSession: 'warning ⌛ 만료된 버튼이에요!\n새 패널의 버튼을 눌러 주세요.\n새 패널이 없다면, "현재 재생 중" 패널을 새로 불러와서 사용해 주세요!',
      processingFailed: "error ❌ 예상치 못한 오류예요!\n처리 중에 오류가 발생했어요. 오류가 반복되면 봇 운영자에게 알려주세요.",
      unknownCommand: "warning ⌛ 지금은 쓸 수 없는 명령이에요.\n꺼져 있거나 없어진 명령이에요.",
      unknownInteraction: "warning ⌛ 만료되었거나 알 수 없는 버튼이에요.\n새 패널의 버튼을 눌러 주세요.\n새 패널이 없다면, 명령을 다시 실행하거나 패널을 새로 불러와서 사용해 주세요!",
      liveUpcoming: "warning 🔴 아직 시작되지 않은 라이브예요!\n예정된 라이브는 재생할 수 없어요. 라이브가 시작된 뒤에 다시 요청해 주세요!",
      liveNoFfmpeg: "error 🔴 라이브 방송을 틀 수 없어요!\n의도된 동작이 아니니 봇 운영자에게 알려 주세요.",
      liveNoSeek: "warning 🔴 라이브 방송은 이동을 할 수 없어요!\n라이브 방송은 실시간으로만 재생이 가능해요.",
      liveNoLoop: "warning 🔴 라이브 방송은 반복 모드를 지원하지 않아요!\n라이브 방송이 재생중이거나 대기열에 있을 때는 반복 모드를 설정할 수 없어요. 해당 곡을 빼고 시도해 주세요.",
      badTime: "warning ✏️ 알 수 없는 시간 형식이에요!\n제가 읽어 들일 수 없는 형식이에요. `1:30`, `3m20s`, `90` 처럼 적어 주세요!",
      jumpTargetGone: "warning ⌛ 선택한 곡이 대기열에 없어요!\n메뉴를 연 뒤에 대기열이 바뀌었어요. 다시 선택해 주세요.",
      mustModerator: "warning 🚫 이 조작을 할 권한이 없어요.\n이 조작에는 서버 관리 권한이 필요해요!",
      channelSetFailed: "error ❌ 채널 지정에 실패했어요.\n채널을 조회하지 못했거나 저장에 실패했어요. 권한 설정을 확인해보고, 잠시 후 시도해도 오류가 발생한다면 봇 운영자에게 알려주세요.",
      settingsSaveFailed: "error ❌ 설정을 저장하지 못했어요.\n데이터베이스나 저장소에 문제가 있어요. 봇 운영자에게 알려주세요.",
      djRoleSaveFailed: "error ❌ 저장하지 못했어요\nDJ 역할 저장 중에 오류가 발생했어요. 잠시 후 다시 시도해 주세요.",
      playlistLimitOutOfRange: "warning ✏️ 범위를 벗어난 수치예요!\n한 번에 넣을 곡 수는 1에서 100곡 사이여야 해요.",
      playlistLimitAtQueueCap: "warning ✏️ 범위를 벗어난 수치예요!\n한 번에 넣을 곡 수는 대기열 상한치인 100곡을 넘을 수 없고, 1에서 100곡 사이여야 해요.",
      onlyInBotChannel: "warning 🚫 전용 채널이 아니에요!\n이 명령어는 <#42> 채널에서만 사용할 수 있어요.",
      mustOwner: "warning 🚫 이 조작을 할 권한이 없어요.\n이 조작은 봇 운영자 전용이에요.",
      refreshFailed: "error ❌ 정보를 새로 고치지 못했어요.\n명령어를 다시 입력하여 새 패널로 조회해 주세요.",
      noSearchResults: "warning 🔍 검색 결과가 없어요.\n다른 검색어로 시도해 주세요.",
      searchOwnerOnly: "warning 🚫 다른 사람의 패널이에요!\n검색한 사람만 고를 수 있어요.",
      commandFailed: "error ❌ 예상치 못한 오류예요!\n명령어 처리 중 오류가 발생했어요. 오류가 반복되면 봇 운영자에게 알려주세요.",
      guildOnly: "warning 🚫 마음만 받을게요.\n아쉽게도 서버에서만 사용할 수 있는 명령어예요. 서버에서 사용해 주세요!",
      cannotStart: "error ❌ 예상치 못한 오류예요!\n곡을 재생하지 못했어요. 오류가 반복되면 봇 운영자에게 알려주세요.",
      noSongResult: "warning 🔍 곡을 찾지 못했어요.\n다른 검색어나 링크로 시도해 주세요.",
    },
  );
});

test("오류 종류마다. 모르는 종류는 unknown", () => {
  const expected: Record<string, string> = {
    "yt-bot-check": "error ❌ 유튜브가 요청을 차단했어요!\n잠시 후에 재시도해 보고, 계속 동일한 문제가 발생하면 봇 운영자에게 알려주세요.",
    "yt-age-no-cookies": "warning 🔒 연령 제한 영상은 틀 수 없어요!\n제한되지 않은 곡을 틀어주세요.",
    "yt-age-cookies-invalid": "error 🔒 일시적으로 연령 제한 영상을 틀 수 없어요!\n오류가 계속되면 봇 운영자에게 알려주세요.",
    "unavailable-contents": "warning 🔒 접근할 수 없거나 존재하지 않는 영상이에요!\n비공개이거나 삭제된 콘텐츠는 틀 수 없어요.",
    "sc-preview-only": "warning 🔒 미리듣기만 가능한 곡이라 틀 수 없어요.\n다른 곡을 재생하거나, 다른 플랫폼으로 시도해 주세요.",
    "unavailable-playlist": "warning 🔒 접근할 수 없거나 존재하지 않는 재생 목록이에요!\n비공개이거나 삭제된 재생 목록은 재생할 수 없어요.",
    "spotify-unavailable": "error 🔒 지금은 스포티파이 링크를 재생할 수 없어요.",
    "direct-unavailable": "warning 🔗 재생할 수 없는 링크예요!\n해당 링크가 오디오나 영상이 맞는지, 용량이 너무 크지는 않은지, 접속이 정상적으로 가능한지 확인해주세요.",
    "geo-blocked": "warning 🔒 지역 제한 콘텐츠예요!\n이 링크의 콘텐츠는 제가 있는 곳에서 접근할 수 없어요. 다른 링크로 시도해 보세요.",
    "rate-limited": "error ❌ 요청이 너무 많아요...!\n해당 플랫폼이 제 요청을 차단했어요. 몇 분 뒤에 다시 해 보고, 계속되거나 자주 발생하면 봇 운영자에게 알려주세요.",
    "sp-no-youtube-match": "warning 🔍 일치하는 음원을 찾지 못했어요!\n재생하려는 스포티파이 곡과 일치하는 곡을 유튜브에서 찾지 못했어요. 곡 이름으로 검색하거나 유튜브 링크를 넣어 보세요.",
    network: "error ❌ 연결 오류가 발생했어요!\n해당 플랫폼에 연결하지 못했어요. 보통은 일시적인 오류이니 잠시 뒤에 다시 시도해 보세요. 오류가 계속되면 봇 운영자에게 알려주세요.",
    "stream-failed": "error ❌ 오디오를 받아오지 못했어요!\n링크에 성공적으로 접속했지만 정상적으로 재생 가능한 음원을 가져오지 못했어요. 다시 시도하거나 다른 버전을 넣어 주세요.",
    "permission-voice": "error 🚫 제게 권한이 없어요.\n봇이 그 음성 채널에 접속하거나 말할 권한이 없어요.",
    "permission-text": "error 🚫 제게 권한이 없어요.\n봇이 그 텍스트 채널에 메시지를 올릴 권한이 없어요. 서버 관리자에게 봇의 권한을 확인해 달라고 해 주세요.",
    "permission-other": "error 🚫 제게 권한이 없어요.\n봇이 그 행동을 하는 데에 필요한 권한이 없어요. 서버 관리자에게 봇의 권한 설정을 확인해달라고 해 주세요.",
    "voice-failed": "error 🎧 음성 채널에 들어가지 못했어요!\n디스코드 서버의 문제나 채널 인원 제한, 봇의 네트워크 문제 등이 원인일 수 있어요. 잠시 후에 다시 시도해 보고, 동일한 오류가 반복되면 서버 관리자에게 알려주세요. 그래도 해결되지 않으면 봇 운영자에게 보고해 주세요.",
    unknown: "error ❌ 예상치 못한 오류예요!\n잠시 후 재시도해 보세요. 오류가 계속되면 봇 운영자에게 알려 주세요.",
  };
  for (const [kind, sentence] of Object.entries(expected)) assert.equal(shown(errors.forKind(kind)), sentence, kind);
  assert.equal(shown(errors.forKind("never-seen")), expected.unknown);
});

test("곡을 찾거나 담지 못한 까닭마다. 오류로 알릴 까닭이면 null", () => {
  const detail = { skipped: 7, max: 100 };
  const expected: Record<string, string> = {
    "no-song-result": "warning 🔍 곡을 찾지 못했어요.\n다른 검색어나 링크로 시도해 주세요.",
    "yt-unplayable": "warning 🔗 지원하지 않는 유튜브 링크예요!\n영상이나 재생목록의 주소를 넣어주세요.",
    "unsupported-link": "warning 🔗 알 수 없는 링크예요!\n재생을 지원하지 않는 플랫폼이에요.",
    "sc-unsupported": "warning 🔗 지원하지 않는 사운드클라우드 링크예요!\n곡이나 플레이리스트의 링크를 넣어 주세요.",
    "nothing-playable": "warning 🔒 앞의 7곡이 전부 재생할 수 없는 곡이에요.\n미리듣기만 가능하거나 지역 제한 등이 걸린 곡들이에요.",
    "live-upcoming": "warning 🔴 아직 시작되지 않은 라이브예요!\n예정된 라이브는 재생할 수 없어요. 라이브가 시작된 뒤에 다시 요청해 주세요!",
    "live-no-ffmpeg": "error 🔴 라이브 방송을 틀 수 없어요!\n의도된 동작이 아니니 봇 운영자에게 알려 주세요.",
    "queue-empty": "warning ⚠️ 대기열에 곡이 없어요!\n이 조작을 하려면 대기열에 곡이 있어야 해요.",
    "voice-failed": "error 🎧 음성 채널에 들어가지 못했어요!\n디스코드 서버의 문제나 채널 인원 제한, 봇의 네트워크 문제 등이 원인일 수 있어요. 잠시 후에 다시 시도해 보고, 동일한 오류가 반복되면 서버 관리자에게 알려주세요. 그래도 해결되지 않으면 봇 운영자에게 보고해 주세요.",
    "queue-full": "warning ⚠️ 곡을 추가하지 못했어요!\n대기열이 가득 찼어요... (최대 100곡)",
    "no-player": "warning ⚠️ 그 사이에 재생이 끝나버렸어요!\n플레이어가 만료됐어요. 링크를 다시 넣어서 재생해주세요.",
    threw: "error ❌ 오류가 발생했어요!\n곡을 넣는 중에 오류가 발생했어요.",
    "more-nothing-playable": "warning 🔒 해당 구간의 곡들이 받을 수 없는 곡뿐이에요.\n미리듣기나 지역 제한 등이 걸린 곡들이라 넣지 못했어요. (7곡)",
    "more-nothing-found": "warning 🔍 더 넣을 곡을 찾지 못했어요!\n재생목록이 변경되었을 수 있어요. 해당 플랫폼에 접속하여 재생목록을 확인해주세요.",
  };
  for (const [code, sentence] of Object.entries(expected)) {
    const notice = errors.addRefusal(code, detail);
    assert.equal(notice && shown(notice), sentence, code);
  }
  for (const code of ["lookup-failed", "play-failed", "play-threw", "live-ended"]) assert.equal(errors.addRefusal(code, detail), null, code);
});

test("재생 조작의 거절. 모르는 까닭은 일반 실패", () => {
  const cases: [errors.Refusal, string][] = [
    [{ code: "no-player" }, "warning ⚠️ 재생 중인 곡이 없어요!\n이 조작을 하려면 재생 중인 곡이 있어야 해요."],
    [{ code: "no-track" }, "warning ⚠️ 재생 중인 곡이 없어요!\n이 조작을 하려면 재생 중인 곡이 있어야 해요."],
    [{ code: "failed" }, "error ❌ 작업이 실패했어요!\n잠시 뒤 재시도해 보고, 계속되면 봇 운영자에게 알려주세요."],
    [{ code: "held", reason: "mute" }, "warning 🔇 음소거되었어요!\n봇이 서버에서 음소거되어서 곡을 멈춰뒀어요. 음소거가 풀리면 이어서 틀게요."],
    [{ code: "held", reason: "alone" }, "warning ⏳ 기다리고 있어요.\n음성 채널에 저 혼자 있어서 곡을 멈춰뒀어요. 누가 들어오면 이어서 틀게요!"],
    [{ code: "held", reason: "other" }, "error ❌ 예상치 못한 오류예요!\n알 수 없는 이유로 재생이 멈춰 있어 이어서 틀 수 없어요. 봇 운영자에게 알려주세요."],
    [{ code: "switch-failed" }, "warning ⚠️ 작업에 실패했어요!\n곡을 전환하지 못했어요. 잠시 후 재시도해 보고, 계속되면 봇 운영자에게 알려주세요."],
    [{ code: "nothing-to-skip" }, "warning ⚠️ 건너뛸 노래가 없습니다! 대기열에 노래가 없습니다."],
    [{ code: "no-previous" }, "warning ⚠️ 이전 곡이 없어요!\n이 곡이 처음으로 튼 곡이거나, 기록이 초기화되어 이전 곡을 재생할 수 없어요."],
    [{ code: "live-no-seek" }, "warning 🔴 라이브 방송은 이동을 할 수 없어요!\n라이브 방송은 실시간으로만 재생이 가능해요."],
    [{ code: "starting" }, "warning ⏳ 잠시만 기다려 주세요...!\n아직 재생을 준비하는 중이에요. 잠시 뒤에 다시 시도해 주세요."],
    [{ code: "beyond-end", durationMs: 185000 }, "warning ✏️ 곡이 그만큼 길지 않아요!\n곡 길이(3:05)보다 뒤로 이동할 수는 없어요."],
    [{ code: "beyond-end" }, "warning ✏️ 곡이 그만큼 길지 않아요!\n곡 길이(?)보다 뒤로 이동할 수는 없어요."],
    [{ code: "no-highlight" }, "warning ⚠️ 하이라이트가 없어요!\n이 곡에는 SponsorBlock 하이라이트 지점이 없어요."],
    [{ code: "bad-volume" }, "warning ✏️ 정해진 범위의 숫자로 입력해 주세요!\n볼륨은 0에서 100 까지의 숫자로 적어야 해요."],
    [{ code: "bad-loop-mode" }, "warning ✏️ 반복 모드가 올바르지 않습니다."],
    [{ code: "live-no-loop" }, "warning 🔴 라이브 방송은 반복 모드를 지원하지 않아요!\n라이브 방송이 재생중이거나 대기열에 있을 때는 반복 모드를 설정할 수 없어요. 해당 곡을 빼고 시도해 주세요."],
    [{ code: "too-few-to-shuffle" }, "warning ⚠️ 섞을 곡이 없어요!\n셔플하려면 대기열에 곡이 2곡 이상 있어야 해요."],
    [{ code: "too-few-to-move" }, "warning ⚠️ 순서를 바꿀 곡이 없어요!\n순서를 바꾸려면 대기열에 곡이 2곡 이상 있어야 해요."],
    [{ code: "queue-empty" }, "warning ⚠️ 대기열에 곡이 없어요!\n이 조작을 하려면 대기열에 곡이 있어야 해요."],
    [{ code: "bad-position", size: 3 }, "warning ✏️ 그 번호의 곡은 존재하지 않아요!\n대기열에는 3곡만 있어요. 1~3 사이로 적어 주세요."],
    [{ code: "same-position" }, "warning ✏️ 제자리로 옮길 수는 없어요!\n옮길 곡의 번호와 옮겨질 위치가 같아요. 번호를 다시 확인해주세요."],
    [{ code: "unknown-genre", genre: "jazz" }, "warning ⌛ 알 수 없는 장르예요!\n그 사이 장르 목록이 변경되어 `jazz`는 없어졌어요. 장르를 다시 선택해 주세요."],
    [{ code: "unknown-genre", genre: "가요" }, "warning ⌛ 알 수 없는 장르예요!\n그 사이 장르 목록이 변경되어 `가요`는 없어졌어요. 장르를 다시 선택해 주세요."],
    [{ code: "what-is-this" }, "error ❌ 작업이 실패했어요!\n잠시 뒤 재시도해 보고, 계속되면 봇 운영자에게 알려주세요."],
  ];
  for (const [r, sentence] of cases) assert.equal(shown(errors.refusal(r)), sentence, r.code);
});

test("권한 판정이 막은 까닭마다", () => {
  assert.deepEqual(
    (["must-be-in-voice", "must-be-in-same-voice", "must-dj", "permission-voice"] as const).map((code) => shown(errors.permission(code))),
    ["warning 🎧 먼저 음성 채널에 접속해 주세요!\n그래야 제가 어느 채널에서 곡을 틀지 알 수 있어요.", "warning 🎧 봇과 같은 음성 채널에 있어야 해요!\n곡을 듣고 있는 사람들만 재생을 제어할 수 있어요.", "warning 🚫 이 조작을 할 권한이 없어요.\n이 조작을 하려면 DJ 역할을 갖고 있어야 해요.", "error 🚫 제게 권한이 없어요.\n봇이 그 음성 채널에 접속하거나 말할 권한이 없어요."],
  );
});
