// 오류 · 거절 안내. 부르는 자리는 뜻으로 고르고 값만 넘긴다. 안내는 무엇에 관한 것인지(topic) · 심각한 정도(severity) · 머리 줄 · 본문이고,
// 머리 줄의 이모지와 색은 응답 틀(ui/frame)이 붙인다

import { formatMs } from "../../format.ts";
import { noticeOf, type Notice, type Topic } from "../../frame.ts";
import { josa } from "../../../rules/josa.ts";

// 봇 쪽 문제 · 외부 실패로 못 했다
const error = (topic: Topic, title: string, body?: string) => noticeOf("error", topic, title, body);
// 사용자가 고칠 수 있거나 지금 상태라 못 했다
const warning = (topic: Topic, title: string, body?: string) => noticeOf("warning", topic, title, body);

// 봇을 부를 때 부른 사람이 음성 채널에 없다
const mustBeInVoice = () => warning("voice", "먼저 음성 채널에 접속해 주세요!", "그래야 제가 어느 채널에서 곡을 틀지 알 수 있어요.");
// 지금 곡이 없다(플레이어가 없거나 곡이 비었다)
const noSong = () => warning("state", "재생 중인 곡이 없어요!", "이 조작을 하려면 재생 중인 곡이 있어야 해요.");
// 봇이 음성 채널에 있는데 그 채널 밖에서 조작했다
const mustBeInSameVoice = () => warning("voice", "봇과 같은 음성 채널에 있어야 해요!", "곡을 듣고 있는 사람들만 재생을 제어할 수 있어요.");
const mustDj = () => warning("permission", "이 조작을 할 권한이 없어요.", "이 조작을 하려면 DJ 역할을 갖고 있어야 해요.");
// 봇이 그 음성 채널에 들어가거나 말할 권한이 없다
const permissionVoice = () => error("permission", "제게 권한이 없어요.", "봇이 그 음성 채널에 접속하거나 말할 권한이 없어요.");
const voiceFailed = () => error("voice", "음성 채널에 들어가지 못했어요!", "디스코드 서버의 문제나 채널 인원 제한, 봇의 네트워크 문제 등이 원인일 수 있어요. 잠시 후에 다시 시도해 보고, 동일한 오류가 반복되면 서버 관리자에게 알려주세요. 그래도 해결되지 않으면 봇 운영자에게 보고해 주세요.");
const queueEmpty = () => warning("state", "대기열에 곡이 없어요!", "이 조작을 하려면 대기열에 곡이 있어야 해요.");
// 지난 재생의 패널 버튼 · 메뉴(정지 뒤 다시 틀었거나 봇이 다시 켜졌다)
const staleSession = () => warning("stale", "만료된 버튼이에요!", '새 패널의 버튼을 눌러 주세요.\n새 패널이 없다면, "현재 재생 중" 패널을 새로 불러와서 사용해 주세요!');
// 버튼 · 메뉴의 처리가 던졌다(전용 채널 입력 포함)
const processingFailed = () => error("failed", "예상치 못한 오류예요!", "처리 중에 오류가 발생했어요. 오류가 반복되면 봇 운영자에게 알려주세요.");
// 버튼 · 메뉴를 받을 처리기가 없다. 봇을 고치기 전에 올린 메시지의 것이 대개 이렇다(custom_id 모양이 바뀌었다)
const unknownInteraction = () => warning("stale", "만료되었거나 알 수 없는 버튼이에요.", "새 패널의 버튼을 눌러 주세요.\n새 패널이 없다면, 명령을 다시 실행하거나 패널을 새로 불러와서 사용해 주세요!");
const liveUpcoming = () => warning("live", "아직 시작되지 않은 라이브예요!", "예정된 라이브는 재생할 수 없어요. 라이브가 시작된 뒤에 다시 요청해 주세요!");
// 설치된 ffmpeg 가 라이브를 열 수 없다. 고치는 법은 운영자 로그에
const liveNoFfmpeg = () => error("live", "라이브 방송을 틀 수 없어요!", "의도된 동작이 아니니 봇 운영자에게 알려 주세요.");
const liveNoSeek = () => warning("live", "라이브 방송은 이동을 할 수 없어요!", "라이브 방송은 실시간으로만 재생이 가능해요.");
const liveNoLoop = () => warning("live", "라이브 방송은 반복 모드를 지원하지 않아요!", "라이브 방송이 재생중이거나 대기열에 있을 때는 반복 모드를 설정할 수 없어요. 해당 곡을 빼고 시도해 주세요.");
// 시간 입력(/seek)을 읽지 못했다
const badTime = () => warning("input", "알 수 없는 시간 형식이에요!", "제가 읽어 들일 수 없는 형식이에요. `1:30`, `3m20s`, `90` 처럼 적어 주세요!");
// 곡으로 건너뛰기 메뉴에서 고른 곡이 대기열에 없다(메뉴를 연 뒤 대기열이 바뀌었다)
const jumpTargetGone = () => warning("stale", "선택한 곡이 대기열에 없어요!", "메뉴를 연 뒤에 대기열이 바뀌었어요. 다시 선택해 주세요.");
// 설정 화면은 서버 관리 권한이 있어야 만진다
const mustModerator = () => warning("permission", "이 조작을 할 권한이 없어요.", "이 조작에는 서버 관리 권한이 필요해요!");
const channelSetFailed = () => error("failed", "채널 지정에 실패했어요.", "채널을 조회하지 못했거나 저장에 실패했어요. 권한 설정을 확인해보고, 잠시 후 시도해도 오류가 발생한다면 봇 운영자에게 알려주세요.");
const settingsSaveFailed = () => error("failed", "설정을 저장하지 못했어요.", "데이터베이스나 저장소에 문제가 있어요. 봇 운영자에게 알려주세요.");
const djRoleSaveFailed = () => error("failed", "저장하지 못했어요", "DJ 역할 저장 중에 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
// 재생목록 한 번에 넣는 곡 수가 범위 밖이다. queueCap 은 범위의 끝이 대기열 상한이라 그렇다면 그 상한
const playlistLimitOutOfRange = (min: number, max: number, queueCap: number | null) => warning("input", "범위를 벗어난 수치예요!", `한 번에 넣을 곡 수는 ${queueCap ? `대기열 상한치인 ${queueCap}곡을 넘을 수 없고, ` : ""}${min}에서 ${max}곡 사이여야 해요.`);
// 전용 채널이 있으면 /dashboard 는 그 채널에서만. channelId 는 전용 채널
const onlyInBotChannel = (channelId: string) => warning("permission", "전용 채널이 아니에요!", `이 명령어는 <#${channelId}> 채널에서만 사용할 수 있어요.`);
// 봇 운영자(OWNER_ID)만 쓰는 화면을 다른 사람이 열었다
const mustOwner = () => warning("permission", "이 조작을 할 권한이 없어요.", "이 조작은 봇 운영자 전용이에요.");
// 새로고침 버튼이 화면(/help · /system)을 다시 그리다 실패했다
const refreshFailed = () => error("failed", "정보를 새로 고치지 못했어요.", "명령어를 다시 입력하여 새 패널로 조회해 주세요.");
// 검색 결과가 하나도 없다
const noSearchResults = () => warning("notFound", "검색 결과가 없어요.", "다른 검색어로 시도해 주세요.");
// 검색 결과 버튼은 검색한 사람만 누른다
const searchOwnerOnly = () => warning("permission", "다른 사람의 패널이에요!", "검색한 사람만 고를 수 있어요.");
// 명령 처리기가 던졌는데 종류를 가를 수 없다
const commandFailed = () => error("failed", "예상치 못한 오류예요!", "명령어 처리 중 오류가 발생했어요. 오류가 반복되면 봇 운영자에게 알려주세요.");
// DM 에서 서버 명령을 불렀다
const guildOnly = () => warning("permission", "마음만 받을게요.", "아쉽게도 서버에서만 사용할 수 있는 명령어예요. 서버에서 사용해 주세요!");

// 권한 판정(usecases/permissions)이 막은 까닭마다
const PERMISSION = { "must-be-in-voice": mustBeInVoice, "must-be-in-same-voice": mustBeInSameVoice, "must-dj": mustDj, "permission-voice": permissionVoice } as const;
type PermissionDenied = keyof typeof PERMISSION;
/** 권한 거절의 안내 */
const permission = (code: PermissionDenied) => PERMISSION[code]();

// 오류 종류(rules/errorKind)마다
const BY_KIND: Record<string, () => Notice> = {
  // 고치는 법(bgutil · 쿠키)은 운영자 로그에(rules/operatorHints). 사용자는 설정을 만질 수 없다
  "yt-bot-check": () => error("failed", "유튜브가 요청을 차단했어요!", "잠시 후에 재시도해 보고, 계속 동일한 문제가 발생하면 봇 운영자에게 알려주세요."),
  // 운영자가 쿠키를 일부러 안 걸어 둔 것일 수 있다. 사용자에게 설정 방법을 늘어놓지 않는다
  "yt-age-no-cookies": () => warning("blocked", "연령 제한 영상은 틀 수 없어요!", "제한되지 않은 곡을 틀어주세요."),
  // 운영자가 쿠키를 다시 넣으면 풀린다
  "yt-age-cookies-invalid": () => error("blocked", "일시적으로 연령 제한 영상을 틀 수 없어요!", "오류가 계속되면 봇 운영자에게 알려주세요."),
  "unavailable-contents": () => warning("blocked", "접근할 수 없거나 존재하지 않는 영상이에요!", "비공개이거나 삭제된 콘텐츠는 틀 수 없어요."),
  // 사운드클라우드 Go+ · 음반사 곡은 30초 조각만 열린다. 조각을 곡처럼 틀지 않는다
  "sc-preview-only": () => warning("blocked", "미리듣기만 가능한 곡이라 틀 수 없어요.", "다른 곡을 재생하거나, 다른 플랫폼으로 시도해 주세요."),
  "unavailable-playlist": () => warning("blocked", "접근할 수 없거나 존재하지 않는 재생 목록이에요!", "비공개이거나 삭제된 재생 목록은 재생할 수 없어요."),
  // 운영자 설정이 없다. 까닭은 운영자 로그에만
  "spotify-unavailable": () => error("blocked", "지금은 스포티파이 링크를 재생할 수 없어요."),
  // 막힌 주소 같은 까닭은 운영자 로그에만(내부망 탐지 도구가 되지 않게)
  "direct-unavailable": () => warning("link", "재생할 수 없는 링크예요!", "해당 링크가 오디오나 영상이 맞는지, 용량이 너무 크지는 않은지, 접속이 정상적으로 가능한지 확인해주세요."),
  "geo-blocked": () => warning("blocked", "지역 제한 콘텐츠예요!", "이 링크의 콘텐츠는 제가 있는 곳에서 접근할 수 없어요. 다른 링크로 시도해 보세요."),
  "rate-limited": () => error("failed", "요청이 너무 많아요...!", "해당 플랫폼이 제 요청을 차단했어요. 몇 분 뒤에 다시 해 보고, 계속되거나 자주 발생하면 봇 운영자에게 알려주세요."),
  "sp-no-youtube-match": () => warning("notFound", "일치하는 음원을 찾지 못했어요!", "재생하려는 스포티파이 곡과 일치하는 곡을 유튜브에서 찾지 못했어요. 곡 이름으로 검색하거나 유튜브 링크를 넣어 보세요."),
  network: () => error("failed", "연결 오류가 발생했어요!", "해당 플랫폼에 연결하지 못했어요. 보통은 일시적인 오류이니 잠시 뒤에 다시 시도해 보세요. 오류가 계속되면 봇 운영자에게 알려주세요."),
  "stream-failed": () => error("failed", "오디오를 받아오지 못했어요!", "링크에 성공적으로 접속했지만 정상적으로 재생 가능한 음원을 가져오지 못했어요. 다시 시도하거나 다른 버전을 넣어 주세요."),
  // 디스코드가 권한 없음으로 거절했다. 음성 채널 상태 · 글(메시지 · 고정 · 웹훅) · 그 밖(rules/errorKind 가 거절된 요청의 주소로 가른다)
  "permission-voice": permissionVoice,
  "permission-text": () => error("permission", "제게 권한이 없어요.", "봇이 그 텍스트 채널에 메시지를 올릴 권한이 없어요. 서버 관리자에게 봇의 권한을 확인해 달라고 해 주세요."),
  "permission-other": () => error("permission", "제게 권한이 없어요.", "봇이 그 행동을 하는 데에 필요한 권한이 없어요. 서버 관리자에게 봇의 권한 설정을 확인해달라고 해 주세요."),
  "voice-failed": voiceFailed,
  unknown: () => error("failed", "예상치 못한 오류예요!", "잠시 후 재시도해 보세요. 오류가 계속되면 봇 운영자에게 알려 주세요."),
};

/** 오류 종류의 안내. 모르는 종류는 unknown */
const forKind = (kind: string) => (BY_KIND[kind] ?? BY_KIND.unknown)();

/** 까닭을 모르고 곡을 못 틀었다 */
const cannotStart = () => error("failed", "예상치 못한 오류예요!", "곡을 재생하지 못했어요. 오류가 반복되면 봇 운영자에게 알려주세요.");
/** 곡 찾기가 찾은 것이 없다 */
const noSongResult = () => warning("notFound", "곡을 찾지 못했어요.", "다른 검색어나 링크로 시도해 주세요.");

// 곡을 찾거나 담지 못한 까닭(sources/lookup · usecases/addTracks · play() 의 code)마다. skipped 는 받을 수 없어 뺀 곡 수, max 는 대기열 상한.
// 오류로 못 한 것(lookup-failed · play-failed · play-threw)은 여기 없다. 오류 종류로 알린다
type AddDetail = { skipped?: number; max: number };
const ADD_REFUSAL: Record<string, (detail: AddDetail) => Notice> = {
  "no-song-result": noSongResult,
  "yt-unplayable": () => warning("link", "지원하지 않는 유튜브 링크예요!", "영상이나 재생목록의 주소를 넣어주세요."),
  "unsupported-link": () => warning("link", "알 수 없는 링크예요!", "재생을 지원하지 않는 플랫폼이에요."),
  "sc-unsupported": () => warning("link", "지원하지 않는 사운드클라우드 링크예요!", "곡이나 플레이리스트의 링크를 넣어 주세요."),
  "nothing-playable": ({ skipped }) => warning("blocked", `앞의 ${skipped}곡이 전부 재생할 수 없는 곡이에요.`, "미리듣기만 가능하거나 지역 제한 등이 걸린 곡들이에요."),
  "live-upcoming": liveUpcoming,
  "live-no-ffmpeg": liveNoFfmpeg,
  "queue-empty": queueEmpty,
  "voice-failed": voiceFailed,
  "queue-full": ({ max }) => warning("state", "곡을 추가하지 못했어요!", `대기열이 가득 찼어요... (최대 ${max}곡)`),
  // 곡을 담는 사이에 플레이어가 사라졌다(더 넣기 포함)
  "no-player": () => warning("state", "그 사이에 재생이 끝나버렸어요!", "플레이어가 만료됐어요. 링크를 다시 넣어서 재생해주세요."),
  threw: () => error("failed", "오류가 발생했어요!", "곡을 넣는 중에 오류가 발생했어요."),
  // 더 넣기
  "more-nothing-playable": ({ skipped }) => warning("blocked", "해당 구간의 곡들이 받을 수 없는 곡뿐이에요.", `미리듣기나 지역 제한 등이 걸린 곡들이라 넣지 못했어요. (${skipped}곡)`),
  "more-nothing-found": () => warning("notFound", "더 넣을 곡을 찾지 못했어요!", "재생목록이 변경되었을 수 있어요. 해당 플랫폼에 접속하여 재생목록을 확인해주세요."),
};
/** 곡을 찾거나 담지 못한 까닭의 안내. 오류 종류로 알릴 까닭이면 null */
const addRefusal = (code: string, detail: AddDetail) => ADD_REFUSAL[code]?.(detail) ?? null;

// 재생 조작(usecases/controls)이 거절한 결과({ ok: false, code, … }). 여기서 읽는 칸만. 길이 넘침은 durationMs, 자리 틀림은 size, 권한은 그 까닭(permission), 붙들린 멈춤은 reason, 모르는 장르는 genre 를 싣는다
type Refusal = { code: string; permission?: PermissionDenied; durationMs?: number; size?: number; reason?: string; genre?: string };

const failed = () => error("failed", "작업이 실패했어요!", "잠시 뒤 재시도해 보고, 계속되면 봇 운영자에게 알려주세요.");

// 사람이 풀 수 없는 멈춤의 까닭(Player.pauseReasons)
const HELD: Record<string, () => Notice> = {
  mute: () => warning("muted", "음소거되었어요!", "봇이 서버에서 음소거되어서 곡을 멈춰뒀어요. 음소거가 풀리면 이어서 틀게요."),
  alone: () => warning("waiting", "기다리고 있어요.", "음성 채널에 저 혼자 있어서 곡을 멈춰뒀어요. 누가 들어오면 이어서 틀게요!"),
};

// 건너뛰기 · 이전 곡 · 곡으로 건너뛰기가 곡을 바꾸지 못했다(지금 곡이 없을 때 난다)
const REFUSAL: Record<string, (r: Refusal) => Notice> = {
  "no-player": () => noSong(),
  "no-track": () => noSong(),
  failed,
  held: ({ reason }) => (reason && HELD[reason]?.()) || error("failed", "예상치 못한 오류예요!", "알 수 없는 이유로 재생이 멈춰 있어 이어서 틀 수 없어요. 봇 운영자에게 알려주세요."),
  "switch-failed": () => warning("state", "작업에 실패했어요!", "곡을 전환하지 못했어요. 잠시 후 재시도해 보고, 계속되면 봇 운영자에게 알려주세요."),
  "nothing-to-skip": () => warning("state", "건너뛸 노래가 없습니다! 대기열에 노래가 없습니다."),
  "no-previous": () => warning("state", "이전 곡이 없어요!", "이 곡이 처음으로 튼 곡이거나, 기록이 초기화되어 이전 곡을 재생할 수 없어요."),
  "live-no-seek": () => liveNoSeek(),
  starting: () => warning("waiting", "잠시만 기다려 주세요...!", "아직 재생을 준비하는 중이에요. 잠시 뒤에 다시 시도해 주세요."),
  "beyond-end": ({ durationMs }) => warning("input", "곡이 그만큼 길지 않아요!", `곡 길이(${durationMs === undefined ? "?" : formatMs(durationMs)})보다 뒤로 이동할 수는 없어요.`),
  "no-highlight": () => warning("state", "하이라이트가 없어요!", "이 곡에는 SponsorBlock 하이라이트 지점이 없어요."),
  "bad-volume": () => warning("input", "정해진 범위의 숫자로 입력해 주세요!", "볼륨은 0에서 100 까지의 숫자로 적어야 해요."),
  // 대시보드에서만 난다(명령과 버튼은 고를 수 있는 모드만 보낸다)
  "bad-loop-mode": () => warning("input", "반복 모드가 올바르지 않습니다."),
  "live-no-loop": () => liveNoLoop(),
  "too-few-to-shuffle": () => warning("state", "섞을 곡이 없어요!", "셔플하려면 대기열에 곡이 2곡 이상 있어야 해요."),
  "too-few-to-move": () => warning("state", "순서를 바꿀 곡이 없어요!", "순서를 바꾸려면 대기열에 곡이 2곡 이상 있어야 해요."),
  "queue-empty": () => queueEmpty(),
  "bad-position": ({ size }) => warning("input", "그 번호의 곡은 존재하지 않아요!", `대기열에는 ${size}곡만 있어요. 1~${size} 사이로 적어 주세요.`),
  "same-position": () => warning("input", "제자리로 옮길 수는 없어요!", "옮길 곡의 번호와 옮겨질 위치가 같아요. 번호를 다시 확인해주세요."),
  "unknown-genre": ({ genre = "" }) => warning("stale", "알 수 없는 장르예요!", `그 사이 장르 목록이 변경되어 \`${genre}\`${josa(genre, "은")} 없어졌어요. 장르를 다시 선택해 주세요.`),
};

/** 거절 까닭의 안내. 모르는 까닭은 일반 실패 */
const refusal = (r: Refusal) => REFUSAL[r.code]?.(r) ?? failed();

export { mustBeInVoice, noSong, mustBeInSameVoice, mustDj, permissionVoice, queueEmpty, staleSession, processingFailed, unknownInteraction, liveUpcoming, liveNoFfmpeg, liveNoSeek, liveNoLoop, badTime, jumpTargetGone, mustModerator, channelSetFailed, settingsSaveFailed, djRoleSaveFailed, playlistLimitOutOfRange, onlyInBotChannel, mustOwner, refreshFailed, noSearchResults, searchOwnerOnly, commandFailed, guildOnly, permission, forKind, cannotStart, noSongResult, addRefusal, refusal };
export type { Refusal, PermissionDenied };
