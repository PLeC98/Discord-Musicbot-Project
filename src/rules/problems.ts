// 문제(오류 · 거절) 코드 목록. 디스코드 안내와 대시보드 HTTP 오류(RFC 9457)가 같은 코드를 쓴다.
// 코드 하나에 뜻 하나. 코드를 바꾸면 받는 쪽이 깨지니 새 뜻은 새 코드로. 문장에 드는 값은 params 에 이름을 적는다.
// HTTP 상태: 400 입력이 틀림 · 403 요청한 사람에게 권한이 없음 · 404 대상이나 처리기가 없음 · 409 지금 상태로는 못 함 ·
// 410 그 사이 사라짐 · 422 받을 수 없는 내용 · 500 봇 안쪽 실패 · 502 외부(플랫폼 · 디스코드) 실패 · 503 운영자 설정 · 잠시 못 함

/** 문장에 드는 값. 이름은 RFC 9457 확장 필드 규칙(글자로 시작, 글자 · 숫자 · _, 3자 이상)을 따른다 */
type Params = { max?: number; min?: number; queueCap?: number | null; size?: number; skipped?: number; durationMs?: number; genre?: string; keys?: string; channelId?: string; length?: number; left?: number };
type Param = keyof Params;
type ProblemSpec = { status: number; title: string; params?: readonly Param[] };

// 디스코드와 대시보드가 같이 쓰는 것. 대시보드 화면도 디스코드와 같은 문장만 보인다
const SHARED = {
  // 요청한 사람이 갖추지 못함
  "must-be-in-voice": { status: 409, title: "Join a voice channel first" },
  "must-be-in-same-voice": { status: 409, title: "Join the bot's voice channel first" },
  // 봇을 부를 때 봇이 다른 음성 채널에 있다(디스코드 /join · 대시보드 참가)
  "bot-in-other-voice": { status: 409, title: "Bot is busy in another voice channel" },
  "must-dj": { status: 403, title: "DJ role required" },
  "must-moderator": { status: 403, title: "Manage Server permission required" },
  "must-owner": { status: 403, title: "Bot owner only" },
  "search-owner-only": { status: 403, title: "Only the searcher can pick a result" },
  "only-in-bot-channel": { status: 403, title: "Only in the bot channel", params: ["channelId"] },
  "guild-only": { status: 403, title: "Server-only command" },
  // 봇에게 디스코드 권한이 없음
  "permission-voice": { status: 409, title: "Bot lacks voice channel permissions" },
  "permission-text": { status: 409, title: "Bot lacks text channel permissions" },
  "permission-other": { status: 409, title: "Bot lacks a required permission" },
  // 지금 상태로는 못 함
  "no-song": { status: 409, title: "Nothing is playing" },
  "queue-empty": { status: 409, title: "Queue is empty" },
  "queue-full": { status: 409, title: "Queue is full", params: ["max"] },
  "no-previous": { status: 409, title: "No previous track" },
  "no-highlight": { status: 409, title: "Track has no highlight" },
  "too-few-to-shuffle": { status: 409, title: "Too few tracks to shuffle" },
  "too-few-to-move": { status: 409, title: "Too few tracks to move" },
  "switch-failed": { status: 409, title: "Could not switch tracks" },
  "held-mute": { status: 409, title: "Paused because the bot is server-muted" },
  "held-alone": { status: 409, title: "Paused because the bot is alone" },
  "ended-while-adding": { status: 409, title: "Playback ended while adding" },
  "live-no-seek": { status: 409, title: "Cannot seek a live stream" },
  "live-no-loop": { status: 409, title: "Cannot loop with a live stream" },
  "live-upcoming": { status: 409, title: "Live stream has not started" },
  // 라이브로 담은 방송(직접 링크 HLS)이 끝났다. 다시보기를 처음부터 틀지 않는다
  "live-ended": { status: 409, title: "Live stream has ended" },
  // 직접 지정한 음원이 라이브다(지정할 수 없다). 그 재생은 지정을 건너뛰고 다시 찾고, 찾지 못했을 때만 보인다
  "pinned-live": { status: 409, title: "Pinned source is a live stream" },
  // 그 사이 사라짐
  "stale-session": { status: 410, title: "Panel is from an earlier session" },
  "jump-target-gone": { status: 410, title: "Selected track left the queue" },
  "entry-gone": { status: 410, title: "Queue entry is gone" },
  "track-changed": { status: 409, title: "The current track changed" },
  "more-expired": { status: 410, title: "Add-more menu expired" },
  // 입력이 틀림
  "bad-time": { status: 400, title: "Unreadable time" },
  "bad-volume": { status: 400, title: "Volume out of range" },
  "bad-position": { status: 400, title: "No track at that position", params: ["size"] },
  "same-position": { status: 400, title: "Source and target positions are the same" },
  "beyond-end": { status: 400, title: "Position is past the end of the track", params: ["durationMs"] },
  "unknown-genre": { status: 400, title: "Unknown genre", params: ["genre"] },
  // 장르의 소스가 모두 키가 없어 못 쓴다(운영자가 키를 입력해야 한다)
  "genre-unusable": { status: 503, title: "Genre has no usable source", params: ["genre", "keys"] },
  "playlist-limit-out-of-range": { status: 400, title: "Playlist add limit out of range", params: ["min", "max", "queueCap"] },
  "more-bad-count": { status: 400, title: "Track count must be a positive number" },
  "more-not-requester": { status: 403, title: "Only the requester can add more" },
  "more-not-requester-close": { status: 403, title: "Only the requester can close the menu" },
  // 대상이나 처리기가 없음
  "unknown-command": { status: 404, title: "Command is not available" },
  "unknown-interaction": { status: 404, title: "Unknown or expired button" },
  "more-unknown-menu": { status: 404, title: "Unknown menu" },
  "no-song-result": { status: 404, title: "No track found" },
  "no-search-results": { status: 404, title: "No search results" },
  "sp-no-youtube-match": { status: 404, title: "No YouTube match for the Spotify track" },
  "more-nothing-found": { status: 404, title: "No more tracks found" },
  // 받을 수 없는 내용
  "unsupported-link": { status: 422, title: "Unsupported link" },
  // 옛 SHOUTcast(v1) 방송. 첫 줄이 ICY 라 받지 못한다
  "shoutcast-v1": { status: 422, title: "Legacy SHOUTcast stream" },
  "yt-unplayable": { status: 422, title: "Unsupported YouTube link" },
  "sc-unsupported": { status: 422, title: "Unsupported SoundCloud link" },
  "direct-unavailable": { status: 422, title: "Link is not playable" },
  "unavailable-contents": { status: 422, title: "Content is private or removed" },
  "unavailable-playlist": { status: 422, title: "Playlist is private or removed" },
  "yt-age-no-cookies": { status: 422, title: "Age-restricted video" },
  "sc-preview-only": { status: 422, title: "Preview-only track" },
  "geo-blocked": { status: 422, title: "Region-blocked content" },
  "nothing-playable": { status: 422, title: "No playable tracks", params: ["skipped"] },
  "more-nothing-playable": { status: 422, title: "No playable tracks in that range", params: ["skipped"] },
  // 외부 실패
  "yt-bot-check": { status: 502, title: "YouTube blocked the request" },
  "network-error": { status: 502, title: "Could not reach the platform" },
  "stream-failed": { status: 502, title: "Could not fetch audio" },
  "voice-failed": { status: 502, title: "Could not join the voice channel" },
  // 운영자 설정 · 잠시 못 함
  "rate-limited": { status: 503, title: "Platform rate limit" },
  "spotify-unavailable": { status: 503, title: "Spotify links are unavailable" },
  "yt-age-cookies-invalid": { status: 503, title: "Age-restricted videos are temporarily unavailable" },
  "live-no-ffmpeg": { status: 503, title: "Live streams are unavailable" },
  "still-starting": { status: 503, title: "Playback is still starting" },
  // 봇 안쪽 실패
  "unknown-error": { status: 500, title: "Unexpected error" },
  "command-failed": { status: 500, title: "Command failed" },
  "processing-failed": { status: 500, title: "Interaction failed" },
  "control-failed": { status: 500, title: "Control failed" },
  "add-failed": { status: 500, title: "Adding tracks failed" },
  "cannot-start": { status: 500, title: "Could not start playback" },
  "refresh-failed": { status: 500, title: "Could not refresh" },
  "channel-set-failed": { status: 500, title: "Could not set the bot channel" },
  "settings-save-failed": { status: 500, title: "Could not save settings" },
  "dj-role-save-failed": { status: 500, title: "Could not save the DJ role" },
  // /join 이 저장한 세션을 복원하지 못했다
  "restore-nothing-left": { status: 500, title: "Could not play the saved track" },
  "restore-failed-in-row": { status: 500, title: "Saved tracks failed in a row", params: ["left"] },
  "restore-failed": { status: 500, title: "Could not restore the session" },
} as const satisfies Record<string, ProblemSpec>;

// 대시보드 HTTP 층에서만 나는 것. 화면은 웹 오류 화면처럼 문장 끝에 코드와 HTTP 상태를 함께 보인다
const WEB = {
  // 대시보드: 접속 · 권한
  "login-required": { status: 401, title: "Login required" },
  // 위험한 조작(비밀값 · 주소 바꾸기 등)은 로그인한 지 얼마 안 됐어야 한다. 세션은 살아 있어 401 이 아니다
  "reauth-required": { status: 403, title: "Recent login required" },
  "bad-csrf-token": { status: 403, title: "Invalid CSRF token" },
  "no-guild-access": { status: 403, title: "No access to this server" },
  "bad-tier": { status: 400, title: "Unknown permission tier" },
  // 대시보드: 상태
  "bot-not-ready": { status: 503, title: "Bot is not ready" },
  // 실행기 없이 시작해서 다시 실행해 줄 쪽이 없다
  "restart-unavailable": { status: 409, title: "Restart is not available" },
  // 대시보드 초대 화면: 공개 봇이 아니고 앱 소유자도 아니거나, code grant 를 요구하는 봇이거나, 앱 정보를 아직 못 받았다
  "invite-unavailable": { status: 403, title: "Inviting is not available" },
  "guild-not-found": { status: 404, title: "Server not found" },
  "bot-not-in-voice": { status: 409, title: "Bot is not in a voice channel" },
  "too-many-requests": { status: 429, title: "Too many requests" },
  "too-many-streams": { status: 429, title: "Too many event streams" },
  // 대시보드: 요청 형식
  "bad-request": { status: 400, title: "Malformed request" },
  // 명령과 버튼은 선택할 수 있는 모드만 보낸다
  "bad-loop-mode": { status: 400, title: "Unknown loop mode" },
  "payload-too-large": { status: 413, title: "Request body is too large" },
  "route-not-found": { status: 404, title: "Route not found" },
  "bad-queue-range": { status: 400, title: "Invalid queue range" },
  "bad-query": { status: 400, title: "Invalid search query", params: ["max"] },
  "bad-more-state": { status: 400, title: "Invalid add-more state" },
  "bad-settings": { status: 400, title: "Invalid server settings" },
  "bad-sponsorblock": { status: 400, title: "Invalid SponsorBlock settings" },
  "bad-sponsor-categories": { status: 400, title: "SponsorBlock categories must be strings" },
  "bad-dj-roles": { status: 400, title: "DJ roles must be role ID strings" },
  "too-many-dj-roles": { status: 400, title: "Too many DJ roles", params: ["max"] },
  "bad-bot-channel": { status: 400, title: "Bot channel must be a text channel" },
  // 대시보드: 운영자
  "announce-empty": { status: 400, title: "Announcement is empty" },
  "announce-too-long": { status: 400, title: "Announcement is too long", params: ["max", "length"] },
  "bad-announce-type": { status: 400, title: "Unknown announcement type" },
  "announce-no-guilds": { status: 409, title: "Bot is in no servers" },
  "announce-failed": { status: 502, title: "Announcement reached no server" },
  "leave-guild-failed": { status: 502, title: "Could not leave the server" },
  "deploy-failed": { status: 502, title: "Command deployment failed" },
  "suggest-failed": { status: 502, title: "Could not fetch suggestions" },
  "model-refresh-failed": { status: 502, title: "Could not fetch model information" },
  "token-count-failed": { status: 503, title: "Could not count tokens" },
  "bad-suggest-type": { status: 400, title: "No suggestions for this source type" },
  "bad-suggest-field": { status: 400, title: "No suggestions for this field" },
  "bad-suggest-term": { status: 400, title: "Suggestion term length out of range", params: ["max"] },
  "too-many-items": { status: 400, title: "Too many items", params: ["max"] },
  "urls-empty": { status: 400, title: "No YouTube URLs given" },
  "nothing-to-save": { status: 400, title: "Nothing was sent" },
  "config-not-found": { status: 404, title: "Unknown config file" },
  "config-invalid": { status: 400, title: "Config has problems" },
  // 읽은 뒤 다른 탭 · 다른 사람이 먼저 저장했다(저장 번호가 다르다)
  "config-changed": { status: 409, title: "Config changed since it was read" },
  "config-save-failed": { status: 409, title: "Config could not be saved" },
  // 설정 가져오기: ZIP 이 깨졌거나 이 봇의 내보내기가 아니다
  "bad-archive": { status: 400, title: "Not a settings archive" },
  // 올린 파일을 둘 디스크의 남은 크기가 모자라다(size: 남은 크기)
  "disk-full": { status: 409, title: "Not enough free disk space", params: ["size"] },
  // 오디오 캐시 내보내기: 캐시 파일이 ZIP 하나에 담는 상한(max)보다 많다
  "archive-too-many-files": { status: 422, title: "Too many cache files for one archive", params: ["max"] },
  // 미리 보기 때 올린 파일이 없다(1시간이 지났거나 봇이 다시 시작됐다)
  "upload-gone": { status: 410, title: "Uploaded file is gone" },
  // 설정 DB 스냅샷 복원: 없는 이름 · 이 봇과 구조가 다른 스냅샷
  "snapshot-not-found": { status: 404, title: "Snapshot not found" },
  "snapshot-mismatch": { status: 409, title: "Snapshot does not match this bot" },
  // AI 리퀘스트 로그: 없는 행(저장 용량을 넘어 삭제됐거나 모두 삭제했다)
  "ai-log-not-found": { status: 404, title: "Request log entry not found" },
  // 로그 파일 보기: 보관 개수를 넘어 삭제됐거나 파일 로그를 껐다
  "log-file-not-found": { status: 404, title: "Log file not found" },
  "storage-unavailable": { status: 503, title: "Storage is temporarily unavailable" },
  // 대시보드: 파비콘(올린 이미지 · 링크로 다운로드하는 이미지)
  "bad-image": { status: 400, title: "Not a supported image" },
  "image-not-square": { status: 400, title: "Image must be square" },
  "image-too-small": { status: 400, title: "Image is too small", params: ["min"] },
  // 링크에서 이미지를 다운로드하지 못했다(접속 · 내부 주소 · 크기 · 시간). 까닭은 로그에만
  "image-link-failed": { status: 502, title: "Could not get the image from the link", params: ["max"] },
  "appearance-save-failed": { status: 500, title: "Could not save the image" },
  // 대시보드: 로그인 배경. 편집은 편집을 기다리는 배경에 한 번만, 기록으로 교체하기는 다 만든 배경만
  "background-not-editable": { status: 409, title: "Background cannot be edited now" },
  "background-not-ready": { status: 409, title: "Background is not ready" },
  // 저장 위치 디스크의 남은 크기가 모자라다(size: 남은 크기)
  "background-no-space": { status: 409, title: "Not enough free disk space", params: ["size"] },
  // 단계가 실패했다(까닭은 로그에). 배경의 실패 까닭으로도 싣는다
  "background-failed": { status: 500, title: "Could not make the background" },
  // 가져온 파일이 쓸 수 있는 그림 · 영상이 아니다(형식 · 해상도 · 길이 · 초당 장면 수)
  "background-bad-source": { status: 422, title: "Not a usable image or video" },
  // 링크에서 다운로드하지 못했다(접속 · 내부 주소 · 형식 · 유튜브). 까닭은 로그에만
  "background-link-failed": { status: 502, title: "Could not get the file from the link" },
  // 봇의 ffmpeg 에 영상 배경을 만들 인코더(H.264 · VP9)가 없다. 이미지 배경은 된다
  "background-no-video-encoder": { status: 409, title: "No encoder for video backgrounds" },
  // 대시보드: 캐시 DB. 필터 식(열마다 · 아무 열에서나)과 읽는 구간
  "bad-filter": { status: 400, title: "Invalid filter expression" },
  "filter-too-long": { status: 400, title: "Filter expression is too long", params: ["max"] },
  "regex-too-long": { status: 400, title: "Regular expression is too long", params: ["max"] },
  // 겹친 반복처럼 오래 걸릴 수 있는 정규식(서버가 재생과 같은 이벤트 루프에서 필터링한다)
  "unsafe-regex": { status: 400, title: "Regular expression may run too long" },
  "filter-timeout": { status: 422, title: "Filtering took too long" },
  "bad-page-range": { status: 400, title: "Invalid row range" },
  "too-many-file-deletes": { status: 400, title: "Too many files to delete at once", params: ["max"] },
  // 지정할 요청이 곡 하나의 링크가 아니다(재생목록 · 앨범 · 세트 · 짧은 링크 · 검색어)
  "not-single-track": { status: 422, title: "Not a single-track link" },
  // 지정할 음원이 다운로드할 수 있는 음원이 아니다(스포티파이 등)
  "not-audio-source": { status: 422, title: "Not a downloadable audio source" },
  // 링크 데이터의 음원이 원래 링크 그대로라 삭제할 자동 검색 결과가 없다
  "nothing-to-clear": { status: 409, title: "Nothing to clear" },
  "track-cache-write-failed": { status: 500, title: "Could not write the changes" },
  // 대시보드: 초기화
  "reset-name-mismatch": { status: 400, title: "Bot name does not match" },
  "reset-already-staged": { status: 409, title: "Full reset is already staged" },
  "reset-not-staged": { status: 404, title: "No full reset is staged" },
  "reset-failed": { status: 500, title: "Could not reset" },
} as const satisfies Record<string, ProblemSpec>;

const PROBLEMS = { ...SHARED, ...WEB };

type Code = keyof typeof PROBLEMS;
/** 그 코드의 문장에 드는 값의 이름(목록의 params) */
// 코드마다 따로 본다(여러 코드의 유니온이면 그중 하나라도 드는 이름 모두)
type ParamNames<C extends Code> = C extends Code ? ((typeof PROBLEMS)[C] extends { params: readonly (infer P extends Param)[] } ? P : never) : never;
/** 그 코드의 문장에 드는 값. 목록에 적은 이름은 모두 있어야 한다 */
type ParamsOf<C extends Code> = { [K in ParamNames<C>]: Exclude<Params[K], undefined> };
/** 그 코드의 문장에 드는 값이 있는가(있으면 부를 때 값을 꼭 넘긴다) */
type NeedsParams<C extends Code> = [ParamNames<C>] extends [never] ? false : true;
/** 문제 하나: 코드와 그 코드의 문장에 드는 값 */
type Problem = { [C in Code]: { code: C } & ParamsOf<C> }[Code];
/** 실행 중에 코드가 정해져 값을 아직 견주지 않은 문제(대시보드 응답 · 곡 담기 결과). 그리기 전에 errors.noticeFor 가 견준다 */
type LooseProblem = { code: Code } & Params;

/** 목록에 있는 코드인가 */
const isCode = (value: string): value is Code => Object.hasOwn(PROBLEMS, value);

/** 대시보드 HTTP 층에서만 나는 코드인가(WEB) */
const isWebCode = (code: Code): boolean => Object.hasOwn(WEB, code);

/** 코드의 정의 */
const problemOf = (code: Code): ProblemSpec => PROBLEMS[code];

export { PROBLEMS, problemOf, isCode, isWebCode };
export type { Code, Params, Param, ParamsOf, NeedsParams, Problem, LooseProblem, ProblemSpec };
