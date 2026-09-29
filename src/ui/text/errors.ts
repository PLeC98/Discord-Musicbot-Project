// 오류 · 거절 문장. 부르는 자리는 뜻으로 고르고 값만 넘긴다. 문장은 ❌ 를 싣고, 표시 지점이 withErrorMark 로 하나로 맞춘다

import { formatMs } from "../format.ts";

// 오류 문자열의 ❌ 접두 규약. 출처(ui/text · sources/lookup · usecases)마다 접두 유무가 달라
// 표시 지점에서 반드시 정규화한다. 디스코드는 정확히 하나, 대시보드 JSON은 없음.
const withErrorMark = (msg: unknown) => {
  const text = String(msg ?? "");
  return text.trimStart().startsWith("❌") ? text : `❌ ${text}`;
};
const withoutErrorMark = (msg: unknown) => String(msg ?? "").replace(/^\s*❌\s*/, "");

const voiceRequired = () => "❌ 음성 채널에 있어야 합니다!";
const noPlayer = () => "❌ 현재 재생 중인 음악이 없습니다!";
const sameChannelRequired = () => "❌ 봇과 같은 음성 채널에 있어야 합니다!";
const notDj = () => "❌ 음악 컨트롤 권한이 없습니다. (DJ 역할 필요)";
const noTrack = () => "❌ 현재 재생 중인 노래가 없습니다!";
const botCannotJoin = () => "❌ 이 음성 채널에서 말할 권한이 없습니다!";
const queueEmpty = () => "❌ 대기열에 노래가 없습니다!";
const staleSession = () => "❌ 이 버튼은 더 이상 유효하지 않습니다! 음악 시스템이 재시작되었습니다.";
const processingFailed = () => "❌ 처리 중 오류가 발생했습니다!";
// 버튼 · 메뉴를 받을 처리기가 없다. 봇을 고치기 전에 올린 메시지의 것이 대개 이렇다(custom_id 모양이 바뀌었다)
const unknownInteraction = () => "❌ 오래됐거나 알 수 없는 버튼이에요. 명령이나 패널을 다시 불러 주세요.";
const liveUpcoming = () => "❌ 아직 시작하지 않은 방송이에요. 방송이 시작된 뒤에 다시 넣어 주세요!";
const liveNoFfmpeg = () => "❌ 지금 설치된 ffmpeg로는 라이브 방송을 재생할 수 없어요. `pnpm run install:ffmpeg`로 받은 빌드를 쓰거나 FFMPEG_PATH를 확인해 주세요.";
const liveNoSeek = () => "❌ 라이브 방송은 구간 이동을 할 수 없어요.";
const liveNoLoop = () => "❌ 라이브 방송이 있으면 반복을 켤 수 없어요.";
// 시간 입력(/seek)을 읽지 못했다
const badTime = () => "❌ 올바른 형식으로 입력하세요. (예: `1:30`, `3m20s`, `90`)";
// 곡으로 건너뛰기 메뉴에서 고른 곡이 대기열에 없다(메뉴를 연 뒤 대기열이 바뀌었다)
const jumpTargetGone = () => "❌ 선택한 곡을 대기열에서 찾을 수 없습니다!";
// 설정 화면은 서버 관리 권한이 있어야 만진다
const needManageGuild = () => "❌ 서버 관리 권한이 필요해요.";
const channelSetFailed = () => "❌ 채널 설정 중 오류가 발생했어요.";
const settingsSaveFailed = () => "❌ 설정을 저장하지 못했어요.";
// 재생목록 한 번에 넣는 곡 수가 범위 밖이다. queueCap 은 범위의 끝이 대기열 상한이라 그렇다면 그 상한
const playlistLimitOutOfRange = (min: number, max: number, queueCap: number | null) => `❌ ${min}~${max}곡 사이로 정해 주세요.${queueCap ? ` 대기열 상한(${queueCap}곡)보다 클 수 없어요.` : ""}`;
// 전용 채널이 있으면 /dashboard 는 그 채널에서만. channelId 는 전용 채널
const onlyInBotChannel = (channelId: string) => `❌ 이 명령어는 <#${channelId}> 채널에서만 사용할 수 있습니다!`;
// 봇 운영자(OWNER_ID)만 쓰는 화면을 다른 사람이 열었다
const ownerOnly = () => "❌ 봇 운영자만 사용할 수 있습니다!";
// 새로고침 버튼이 화면을 다시 그리다 실패했다
const helpRefreshFailed = () => "❌ 도움말을 새로고침하는 중 오류가 발생했습니다!";
const systemRefreshFailed = () => "❌ 시스템 정보를 새로고침하는 중 오류가 발생했습니다!";
// 검색 결과가 하나도 없다
const noSearchResults = () => "❌ 검색 결과가 없습니다!";
// 검색 결과 버튼은 검색한 사람만 누른다
const searchOwnerOnly = () => "❌ 검색을 요청한 사용자만 선택할 수 있습니다!";
// 명령 처리기가 던졌는데 종류를 가를 수 없다
const commandFailed = () => "❌ 명령어 실행 중 오류가 발생했습니다!";
// DM 에서 서버 명령을 불렀다
const guildOnly = () => "❌ 서버에서만 쓸 수 있는 명령이에요.";
// 전용 채널 입력의 처리가 던졌다
const processingFailedInChannel = () => "❌ 처리 중 오류가 발생했어요.";
// 전용 채널 입력이 까닭 없이 곡을 못 넣었다
const cannotStartInChannel = () => "재생을 시작할 수 없어요.";

// 권한 판정(usecases/permissions)이 막은 까닭마다
const PERMISSION = { "voice-required": voiceRequired, "same-channel-required": sameChannelRequired, "not-dj": notDj, "bot-cannot-join": botCannotJoin } as const;
type PermissionDenied = keyof typeof PERMISSION;
/** 권한 거절의 문장 */
const permission = (code: PermissionDenied) => PERMISSION[code]();

// 오류 종류(rules/errorKind)마다
const BY_KIND: Record<string, string> = {
  // 고치는 법(bgutil · 쿠키)은 운영자 로그에(rules/operatorHints). 사용자는 설정을 만질 수 없다
  "bot-check": "❌ **YouTube가 이 요청을 차단했습니다 (봇 감지)**\nYouTube가 이 서버의 IP 주소에서 오는 요청을 거부하고 있습니다.\n\n**해결 방법:** 잠시 후 다시 시도하세요. 계속되면 봇 운영자에게 알려 주세요.",
  // 운영자가 쿠키를 일부러 안 걸어 둔 것일 수 있다. 사용자에게 설정 방법을 늘어놓지 않는다
  "age-restricted": "❌ 연령 제한 영상은 재생할 수 없어요.",
  // 운영자가 쿠키를 다시 넣으면 풀린다
  "age-cookies-invalid": "❌ 연령 제한 영상을 일시적으로 재생할 수 없어요. 오류가 계속되면 봇 운영자에게 알려주세요.",
  "video-unavailable": "❌ 비공개이거나 삭제된 영상은 재생할 수 없어요.",
  "track-unavailable": "❌ 없거나 비공개인 곡이에요.",
  // 사운드클라우드 Go+ · 음반사 곡은 30초 조각만 열린다. 조각을 곡처럼 틀지 않는다
  "preview-only": "❌ 미리듣기(30초)만 열린 곡이라 틀 수 없어요.",
  "playlist-unavailable": "❌ 없거나 비공개인 재생목록이에요.",
  // 운영자 설정이 없다. 까닭은 운영자 로그에만
  "spotify-unavailable": "❌ 지금은 스포티파이 링크를 재생할 수 없어요.",
  // 막힌 주소 같은 까닭은 운영자 로그에만(내부망 탐지 도구가 되지 않게)
  "link-unavailable": "❌ 재생할 수 없는 링크예요.",
  "geo-blocked": "❌ **지역 차단 콘텐츠**\n이 동영상은 봇이 호스팅된 지역에서 제한되어 있습니다.\n\n**해결 방법:** 다른 링크를 시도해 보세요.",
  "rate-limited": "❌ **요청이 너무 많습니다 (속도 제한)**\nYouTube 또는 다른 플랫폼이 일시적으로 요청을 차단하고 있습니다.\n\n**해결 방법:** 몇 분 기다렸다가 다시 시도하세요. 자주 발생하면 봇 운영자에게 알려 주세요.",
  "no-youtube-match": "❌ **Spotify 트랙을 YouTube에서 찾을 수 없습니다**\n이 곡에 대한 일치하는 YouTube 동영상을 찾을 수 없었습니다.\n\n**해결 방법:** Spotify 링크 대신 곡 이름으로 직접 검색하거나 YouTube 링크를 붙여넣으세요.",
  network: "❌ **네트워크 오류**\n봇이 음악 플랫폼에 연결할 수 없었습니다. 보통 일시적인 문제입니다.\n\n**해결 방법:** 잠시 기다렸다가 다시 시도하세요.",
  "stream-failed": "❌ **오디오 스트림 실패**\n봇이 트랙을 찾았지만 오디오 스트림을 시작할 수 없었습니다.\n\n**해결 방법:** 다시 시도하거나 다른 버전의 곡을 시도해 보세요.",
  "voice-permission": "❌ **음성 채널 권한 없음**\n봇이 음성 채널에 참여하거나 말할 권한이 없습니다.\n\n**해결 방법:** 음성 채널 설정 → 권한 → 봇에게 **연결** 및 **말하기** 권한을 부여하세요.",
  unknown: "❌ **예상치 못한 오류가 발생했습니다**\n요청을 처리하는 중 문제가 발생했습니다.\n\n**해결 방법:** 잠시 후 다시 시도하세요. 문제가 계속되면 봇 운영자에게 알려 주세요.",
};

/** 오류 종류의 문장. 모르는 종류는 unknown */
const forKind = (kind: string) => BY_KIND[kind] || BY_KIND.unknown;

// play() 가 곡을 못 틀었을 때(code). 오류로 못 튼 것은 오류 종류로 안내한다
const PLAY_FAILURE: Record<string, string> = {
  "queue-empty": "대기열에 트랙이 없습니다!",
  "voice-failed": "음성 채널에 연결하지 못했습니다!",
};

/** play() 가 곡을 못 튼 까닭(code)의 문장. 모르면 null */
const playFailure = (code: string | undefined) => (code && PLAY_FAILURE[code]) || null;
/** 까닭을 모르고 곡을 못 틀었다 */
const cannotStart = () => "재생을 시작할 수 없습니다.";
/** 곡 찾기가 찾은 것이 없다 */
const noResult = () => "❌ 결과를 찾을 수 없습니다!";

// 재생 조작(usecases/controls)이 거절한 결과({ ok: false, code, … }). 여기서 읽는 칸만. 길이 넘침은 durationMs, 자리 틀림은 size, 권한은 그 까닭(permission), 붙들린 멈춤은 reason, 모르는 장르는 genre 를 싣는다
type Refusal = { code: string; permission?: PermissionDenied; durationMs?: number; size?: number; reason?: string; genre?: string };

// 사람이 풀 수 없는 멈춤의 까닭(Player.pauseReasons)
const HELD: Record<string, string> = {
  mute: "❌ 봇이 서버에서 음소거되어 멈춰 있습니다. 음소거가 풀리면 이어서 재생합니다.",
  alone: "❌ 음성 채널에 아무도 없어 멈춰 있습니다. 누가 들어오면 이어서 재생합니다.",
};

const REFUSAL: Record<string, (r: Refusal) => string> = {
  "no-player": () => noPlayer(),
  "no-track": () => noTrack(),
  failed: () => "❌ 작업이 실패했습니다!",
  held: ({ reason }) => (reason && HELD[reason]) || "❌ 다른 까닭으로 멈춰 있어 이어서 재생할 수 없습니다.",
  "skip-failed": () => "❌ 노래가 건너뛰어지지 않았습니다!",
  "previous-failed": () => "❌ 이전 노래로 이동하지 못했습니다!",
  "jump-failed": () => "❌ 곡으로 이동하지 못했습니다!",
  "nothing-to-skip": () => "❌ 건너뛸 노래가 없습니다! 대기열에 노래가 없습니다.",
  "no-previous": () => "❌ 이전 노래가 없습니다!",
  "live-no-seek": () => liveNoSeek(),
  starting: () => "❌ 재생을 준비 중입니다. 잠시 후 다시 시도해 주세요.",
  "beyond-end": ({ durationMs }) => `❌ 입력한 시간이 곡 길이를 초과합니다. (최대: ${durationMs === undefined ? "?" : formatMs(durationMs)})`,
  "no-highlight": () => "❌ 이 곡에는 SponsorBlock 하이라이트 지점이 없어요.",
  "bad-volume": () => "❌ 볼륨은 0에서 100 사이의 숫자여야 합니다!",
  "bad-loop-mode": () => "❌ 반복 모드가 올바르지 않습니다.",
  "live-no-loop": () => liveNoLoop(),
  "too-few-to-shuffle": () => "❌ 셔플하려면 대기열에 최소 2개의 노래가 있어야 합니다!",
  "too-few-to-move": () => "❌ 순서를 변경하려면 대기열에 2곡 이상 있어야 합니다.",
  "queue-empty": () => queueEmpty(),
  "bad-position": ({ size }) => `❌ 대기열에 ${size}개의 곡만 있습니다. (1 ~ ${size} 범위로 입력하세요)`,
  "same-position": () => "❌ 현재 위치와 이동할 위치가 같습니다.",
  "unknown-genre": ({ genre }) => `❌ 알 수 없는 장르입니다: \`${genre}\`. 자동재생 버튼을 다시 눌러 선택해 주세요.`,
};

/** 거절 까닭의 문장. 모르는 까닭은 일반 실패 */
const refusal = (r: Refusal) => REFUSAL[r.code]?.(r) ?? "❌ 작업이 실패했습니다!";

export {
  withErrorMark,
  withoutErrorMark,
  voiceRequired,
  noPlayer,
  sameChannelRequired,
  notDj,
  noTrack,
  botCannotJoin,
  queueEmpty,
  staleSession,
  processingFailed,
  unknownInteraction,
  liveUpcoming,
  liveNoFfmpeg,
  liveNoSeek,
  liveNoLoop,
  badTime,
  jumpTargetGone,
  needManageGuild,
  channelSetFailed,
  settingsSaveFailed,
  playlistLimitOutOfRange,
  onlyInBotChannel,
  ownerOnly,
  helpRefreshFailed,
  systemRefreshFailed,
  noSearchResults,
  searchOwnerOnly,
  commandFailed,
  guildOnly,
  processingFailedInChannel,
  cannotStartInChannel,
  permission,
  forKind,
  playFailure,
  cannotStart,
  noResult,
  refusal,
};
export type { Refusal, PermissionDenied };
