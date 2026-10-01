// 오류 · 거절 안내. 부르는 자리는 뜻으로 고르고 값만 넘긴다. 안내는 무엇에 관한 것인지(topic) · 심각한 정도(severity) · 머리 줄 · 본문이고,
// 머리 줄의 이모지와 색은 응답 틀(ui/frame)이 붙인다

import { formatMs } from "../format.ts";
import { noticeOf, type Notice, type Topic } from "../frame.ts";

// 봇 쪽 문제 · 외부 실패로 못 했다
const error = (topic: Topic, title: string, body?: string) => noticeOf("error", topic, title, body);
// 사용자가 고칠 수 있거나 지금 상태라 못 했다
const warning = (topic: Topic, title: string, body?: string) => noticeOf("warning", topic, title, body);

const voiceRequired = () => warning("voice", "음성 채널에 있어야 합니다!");
const noPlayer = () => warning("state", "현재 재생 중인 음악이 없습니다!");
const sameChannelRequired = () => warning("voice", "봇과 같은 음성 채널에 있어야 합니다!");
const notDj = () => warning("permission", "음악 컨트롤 권한이 없습니다. (DJ 역할 필요)");
const noTrack = () => warning("state", "현재 재생 중인 노래가 없습니다!");
const botCannotJoin = () => error("permission", "이 음성 채널에서 말할 권한이 없습니다!");
const voiceFailed = () => error("voice", "음성 채널에 연결하지 못했습니다!");
const queueEmpty = () => warning("state", "대기열에 노래가 없습니다!");
const staleSession = () => warning("stale", "이 버튼은 더 이상 유효하지 않습니다! 음악 시스템이 재시작되었습니다.");
const processingFailed = () => error("failed", "처리 중 오류가 발생했습니다!");
// 버튼 · 메뉴를 받을 처리기가 없다. 봇을 고치기 전에 올린 메시지의 것이 대개 이렇다(custom_id 모양이 바뀌었다)
const unknownInteraction = () => warning("stale", "오래됐거나 알 수 없는 버튼이에요. 명령이나 패널을 다시 불러 주세요.");
const liveUpcoming = () => warning("live", "아직 시작하지 않은 방송이에요. 방송이 시작된 뒤에 다시 넣어 주세요!");
const liveNoFfmpeg = () => error("live", "지금 설치된 ffmpeg로는 라이브 방송을 재생할 수 없어요. `pnpm run install:ffmpeg`로 받은 빌드를 쓰거나 FFMPEG_PATH를 확인해 주세요.");
const liveNoSeek = () => warning("live", "라이브 방송은 구간 이동을 할 수 없어요.");
const liveNoLoop = () => warning("live", "라이브 방송이 있으면 반복을 켤 수 없어요.");
// 시간 입력(/seek)을 읽지 못했다
const badTime = () => warning("input", "올바른 형식으로 입력하세요. (예: `1:30`, `3m20s`, `90`)");
// 곡으로 건너뛰기 메뉴에서 고른 곡이 대기열에 없다(메뉴를 연 뒤 대기열이 바뀌었다)
const jumpTargetGone = () => warning("stale", "선택한 곡을 대기열에서 찾을 수 없습니다!");
// 설정 화면은 서버 관리 권한이 있어야 만진다
const needManageGuild = () => warning("permission", "서버 관리 권한이 필요해요.");
const channelSetFailed = () => error("failed", "채널 설정 중 오류가 발생했어요.");
const settingsSaveFailed = () => error("failed", "설정을 저장하지 못했어요.");
const djRoleSaveFailed = () => error("failed", "저장 실패", "DJ 역할 설정 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
// 재생목록 한 번에 넣는 곡 수가 범위 밖이다. queueCap 은 범위의 끝이 대기열 상한이라 그렇다면 그 상한
const playlistLimitOutOfRange = (min: number, max: number, queueCap: number | null) => warning("input", `${min}~${max}곡 사이로 정해 주세요.${queueCap ? ` 대기열 상한(${queueCap}곡)보다 클 수 없어요.` : ""}`);
// 전용 채널이 있으면 /dashboard 는 그 채널에서만. channelId 는 전용 채널
const onlyInBotChannel = (channelId: string) => warning("permission", `이 명령어는 <#${channelId}> 채널에서만 사용할 수 있습니다!`);
// 봇 운영자(OWNER_ID)만 쓰는 화면을 다른 사람이 열었다
const ownerOnly = () => warning("permission", "봇 운영자만 사용할 수 있습니다!");
// 새로고침 버튼이 화면을 다시 그리다 실패했다
const helpRefreshFailed = () => error("failed", "도움말을 새로고침하는 중 오류가 발생했습니다!");
const systemRefreshFailed = () => error("failed", "시스템 정보를 새로고침하는 중 오류가 발생했습니다!");
// 검색 결과가 하나도 없다
const noSearchResults = () => warning("notFound", "검색 결과가 없습니다!");
// 검색 결과 버튼은 검색한 사람만 누른다
const searchOwnerOnly = () => warning("permission", "검색을 요청한 사용자만 선택할 수 있습니다!");
// 명령 처리기가 던졌는데 종류를 가를 수 없다
const commandFailed = () => error("failed", "명령어 실행 중 오류가 발생했습니다!");
// DM 에서 서버 명령을 불렀다
const guildOnly = () => warning("permission", "서버에서만 쓸 수 있는 명령이에요.");
// 전용 채널 입력의 처리가 던졌다
const processingFailedInChannel = () => error("failed", "처리 중 오류가 발생했어요.");

// 권한 판정(usecases/permissions)이 막은 까닭마다
const PERMISSION = { "voice-required": voiceRequired, "same-channel-required": sameChannelRequired, "not-dj": notDj, "bot-cannot-join": botCannotJoin } as const;
type PermissionDenied = keyof typeof PERMISSION;
/** 권한 거절의 안내 */
const permission = (code: PermissionDenied) => PERMISSION[code]();

// 오류 종류(rules/errorKind)마다
const BY_KIND: Record<string, () => Notice> = {
  // 고치는 법(bgutil · 쿠키)은 운영자 로그에(rules/operatorHints). 사용자는 설정을 만질 수 없다
  "bot-check": () => error("failed", "YouTube가 이 요청을 차단했습니다 (봇 감지)", "YouTube가 이 서버의 IP 주소에서 오는 요청을 거부하고 있습니다.\n\n**해결 방법:** 잠시 후 다시 시도하세요. 계속되면 봇 운영자에게 알려 주세요."),
  // 운영자가 쿠키를 일부러 안 걸어 둔 것일 수 있다. 사용자에게 설정 방법을 늘어놓지 않는다
  "age-restricted": () => warning("blocked", "연령 제한 영상은 재생할 수 없어요."),
  // 운영자가 쿠키를 다시 넣으면 풀린다
  "age-cookies-invalid": () => error("blocked", "연령 제한 영상을 일시적으로 재생할 수 없어요. 오류가 계속되면 봇 운영자에게 알려주세요."),
  "video-unavailable": () => warning("blocked", "비공개이거나 삭제된 영상은 재생할 수 없어요."),
  "track-unavailable": () => warning("blocked", "없거나 비공개인 곡이에요."),
  // 사운드클라우드 Go+ · 음반사 곡은 30초 조각만 열린다. 조각을 곡처럼 틀지 않는다
  "preview-only": () => warning("blocked", "미리듣기(30초)만 열린 곡이라 틀 수 없어요."),
  "playlist-unavailable": () => warning("blocked", "없거나 비공개인 재생목록이에요."),
  // 운영자 설정이 없다. 까닭은 운영자 로그에만
  "spotify-unavailable": () => error("blocked", "지금은 스포티파이 링크를 재생할 수 없어요."),
  // 막힌 주소 같은 까닭은 운영자 로그에만(내부망 탐지 도구가 되지 않게)
  "link-unavailable": () => warning("link", "재생할 수 없는 링크예요."),
  "geo-blocked": () => warning("blocked", "지역 차단 콘텐츠", "이 동영상은 봇이 호스팅된 지역에서 제한되어 있습니다.\n\n**해결 방법:** 다른 링크를 시도해 보세요."),
  "rate-limited": () => error("failed", "요청이 너무 많습니다 (속도 제한)", "YouTube 또는 다른 플랫폼이 일시적으로 요청을 차단하고 있습니다.\n\n**해결 방법:** 몇 분 기다렸다가 다시 시도하세요. 자주 발생하면 봇 운영자에게 알려 주세요."),
  "no-youtube-match": () => warning("notFound", "Spotify 트랙을 YouTube에서 찾을 수 없습니다", "이 곡에 대한 일치하는 YouTube 동영상을 찾을 수 없었습니다.\n\n**해결 방법:** Spotify 링크 대신 곡 이름으로 직접 검색하거나 YouTube 링크를 붙여넣으세요."),
  network: () => error("failed", "네트워크 오류", "봇이 음악 플랫폼에 연결할 수 없었습니다. 보통 일시적인 문제입니다.\n\n**해결 방법:** 잠시 기다렸다가 다시 시도하세요."),
  "stream-failed": () => error("failed", "오디오 스트림 실패", "봇이 트랙을 찾았지만 오디오 스트림을 시작할 수 없었습니다.\n\n**해결 방법:** 다시 시도하거나 다른 버전의 곡을 시도해 보세요."),
  "voice-permission": () => error("permission", "음성 채널 권한 없음", "봇이 음성 채널에 참여하거나 말할 권한이 없습니다.\n\n**해결 방법:** 음성 채널 설정 → 권한 → 봇에게 **연결** 및 **말하기** 권한을 부여하세요."),
  // 디스코드가 권한 없음으로 거절했다. 글(메시지 · 고정 · 웹훅)과 그 밖(rules/errorKind 가 거절된 요청의 주소로 가른다)
  "text-permission": () => error("permission", "제게 권한이 없어요.", "봇이 그 텍스트 채널에 메시지를 올릴 권한이 없어요. 서버 관리자에게 봇의 권한을 확인해 달라고 해 주세요."),
  "other-permission": () => error("permission", "제게 권한이 없어요.", "봇이 그 행동을 하는 데에 필요한 권한이 없어요. 서버 관리자에게 봇의 권한 설정을 확인해달라고 해 주세요."),
  "voice-failed": voiceFailed,
  unknown: () => error("failed", "예상치 못한 오류가 발생했습니다", "요청을 처리하는 중 문제가 발생했습니다.\n\n**해결 방법:** 잠시 후 다시 시도하세요. 문제가 계속되면 봇 운영자에게 알려 주세요."),
};

/** 오류 종류의 안내. 모르는 종류는 unknown */
const forKind = (kind: string) => (BY_KIND[kind] ?? BY_KIND.unknown)();

/** 까닭을 모르고 곡을 못 틀었다 */
const cannotStart = () => error("failed", "재생을 시작할 수 없습니다.");
/** 곡 찾기가 찾은 것이 없다 */
const noResult = () => warning("notFound", "결과를 찾을 수 없습니다!");

// 곡을 찾거나 담지 못한 까닭(sources/lookup · usecases/addTracks · play() 의 code)마다. skipped 는 받을 수 없어 뺀 곡 수, max 는 대기열 상한.
// 오류로 못 한 것(lookup-failed · play-failed · play-threw)은 여기 없다. 오류 종류로 알린다
type AddDetail = { skipped?: number; max: number };
const ADD_REFUSAL: Record<string, (detail: AddDetail) => Notice> = {
  "no-result": noResult,
  "youtube-unplayable": () => warning("link", "재생할 수 없는 유튜브 주소입니다."),
  "unsupported-link": () => warning("link", "지원하지 않는 링크입니다."),
  "unsupported-soundcloud": () => warning("link", "지원하지 않는 사운드클라우드 링크예요. 곡이나 세트 링크를 넣어 주세요."),
  "nothing-playable": () => warning("blocked", "이 세트의 앞 곡들은 모두 틀 수 없어요(미리듣기만 열린 곡 · 지역 제한 등)."),
  "live-upcoming": liveUpcoming,
  "live-no-ffmpeg": liveNoFfmpeg,
  "queue-empty": () => warning("state", "대기열에 트랙이 없습니다!"),
  "voice-failed": voiceFailed,
  "queue-full": ({ max }) => warning("state", `대기열이 가득 찼습니다 (최대 ${max}곡)`),
  "no-player": () => warning("state", "음악 플레이어를 찾을 수 없습니다."),
  threw: () => error("failed", "음악을 처리하는 중 오류가 발생했습니다."),
  // 더 넣기
  "more-no-player": noPlayer,
  "more-nothing-playable": ({ skipped }) => warning("blocked", `받을 수 없는 곡(미리듣기 · 지역 제한 등)뿐이라 넣지 못했어요(${skipped}곡).`),
  "more-nothing-found": () => warning("notFound", "더 넣을 곡을 찾지 못했어요."),
};
/** 곡을 찾거나 담지 못한 까닭의 안내. 오류 종류로 알릴 까닭이면 null */
const addRefusal = (code: string, detail: AddDetail) => ADD_REFUSAL[code]?.(detail) ?? null;

// 재생 조작(usecases/controls)이 거절한 결과({ ok: false, code, … }). 여기서 읽는 칸만. 길이 넘침은 durationMs, 자리 틀림은 size, 권한은 그 까닭(permission), 붙들린 멈춤은 reason, 모르는 장르는 genre 를 싣는다
type Refusal = { code: string; permission?: PermissionDenied; durationMs?: number; size?: number; reason?: string; genre?: string };

const failed = () => error("failed", "작업이 실패했습니다!");

// 사람이 풀 수 없는 멈춤의 까닭(Player.pauseReasons)
const HELD: Record<string, () => Notice> = {
  mute: () => warning("muted", "봇이 서버에서 음소거되어 멈춰 있습니다. 음소거가 풀리면 이어서 재생합니다."),
  alone: () => warning("waiting", "음성 채널에 아무도 없어 멈춰 있습니다. 누가 들어오면 이어서 재생합니다."),
};

// 건너뛰기 · 이전 곡 · 곡으로 이동이 실패하는 것은 지금 곡이 없을 때라 지금 상태의 경고다
const REFUSAL: Record<string, (r: Refusal) => Notice> = {
  "no-player": () => noPlayer(),
  "no-track": () => noTrack(),
  failed,
  held: ({ reason }) => (reason && HELD[reason]?.()) || error("failed", "다른 까닭으로 멈춰 있어 이어서 재생할 수 없습니다."),
  "skip-failed": () => warning("state", "노래가 건너뛰어지지 않았습니다!"),
  "previous-failed": () => warning("state", "이전 노래로 이동하지 못했습니다!"),
  "jump-failed": () => warning("state", "곡으로 이동하지 못했습니다!"),
  "nothing-to-skip": () => warning("state", "건너뛸 노래가 없습니다! 대기열에 노래가 없습니다."),
  "no-previous": () => warning("state", "이전 노래가 없습니다!"),
  "live-no-seek": () => liveNoSeek(),
  starting: () => warning("waiting", "재생을 준비 중입니다. 잠시 후 다시 시도해 주세요."),
  "beyond-end": ({ durationMs }) => warning("input", `입력한 시간이 곡 길이를 초과합니다. (최대: ${durationMs === undefined ? "?" : formatMs(durationMs)})`),
  "no-highlight": () => warning("state", "이 곡에는 SponsorBlock 하이라이트 지점이 없어요."),
  "bad-volume": () => warning("input", "볼륨은 0에서 100 사이의 숫자여야 합니다!"),
  "bad-loop-mode": () => warning("input", "반복 모드가 올바르지 않습니다."),
  "live-no-loop": () => liveNoLoop(),
  "too-few-to-shuffle": () => warning("state", "셔플하려면 대기열에 최소 2개의 노래가 있어야 합니다!"),
  "too-few-to-move": () => warning("state", "순서를 변경하려면 대기열에 2곡 이상 있어야 합니다."),
  "queue-empty": () => queueEmpty(),
  "bad-position": ({ size }) => warning("input", `대기열에 ${size}개의 곡만 있습니다. (1 ~ ${size} 범위로 입력하세요)`),
  "same-position": () => warning("input", "현재 위치와 이동할 위치가 같습니다."),
  "unknown-genre": ({ genre }) => warning("stale", `알 수 없는 장르입니다: \`${genre}\`. 자동재생 버튼을 다시 눌러 선택해 주세요.`),
};

/** 거절 까닭의 안내. 모르는 까닭은 일반 실패 */
const refusal = (r: Refusal) => REFUSAL[r.code]?.(r) ?? failed();

export {
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
  djRoleSaveFailed,
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
  permission,
  forKind,
  cannotStart,
  noResult,
  addRefusal,
  refusal,
};
export type { Refusal, PermissionDenied };
