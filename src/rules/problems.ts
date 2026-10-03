// 문제(오류 · 거절) 코드 목록. 디스코드 안내와 대시보드 HTTP 오류(RFC 9457)가 같은 코드를 쓴다.
// 코드 하나에 뜻 하나. 코드를 바꾸면 받는 쪽이 깨지니 새 뜻은 새 코드로. 문장에 드는 값은 params 에 이름을 적는다.
// HTTP 상태: 400 입력이 틀림 · 403 요청한 사람에게 권한이 없음 · 404 대상이나 처리기가 없음 · 409 지금 상태로는 못 함 ·
// 410 그 사이 사라짐 · 422 받을 수 없는 내용 · 500 봇 안쪽 실패 · 502 바깥(플랫폼 · 디스코드) 실패 · 503 운영자 설정 · 잠시 못 함

/** 문장에 드는 값. 이름은 RFC 9457 확장 칸 규칙(글자로 시작, 글자 · 숫자 · _, 3자 이상)을 따른다 */
type Params = { max?: number; min?: number; queueCap?: number | null; size?: number; skipped?: number; durationMs?: number; genre?: string; channelId?: string; length?: number; left?: number };
type Param = keyof Params;
type ProblemSpec = { status: number; title: string; params?: readonly Param[] };

const PROBLEMS = {
  // 요청한 사람이 갖추지 못함
  "must-be-in-voice": { status: 409, title: "Join a voice channel first" },
  "must-be-in-same-voice": { status: 409, title: "Join the bot's voice channel first" },
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
  // 그 사이 사라짐
  "stale-session": { status: 410, title: "Panel is from an earlier session" },
  "jump-target-gone": { status: 410, title: "Selected track left the queue" },
  "more-expired": { status: 410, title: "Add-more menu expired" },
  // 입력이 틀림
  "bad-time": { status: 400, title: "Unreadable time" },
  "bad-volume": { status: 400, title: "Volume out of range" },
  "bad-loop-mode": { status: 400, title: "Unknown loop mode" },
  "bad-position": { status: 400, title: "No track at that position", params: ["size"] },
  "same-position": { status: 400, title: "Source and target positions are the same" },
  "beyond-end": { status: 400, title: "Position is past the end of the track", params: ["durationMs"] },
  "unknown-genre": { status: 400, title: "Unknown genre", params: ["genre"] },
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
  // 바깥 실패
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
  // /join 이 저장한 세션을 되살리지 못했다
  "restore-nothing-left": { status: 500, title: "Could not play the saved track" },
  "restore-failed-in-row": { status: 500, title: "Saved tracks failed in a row", params: ["left"] },
  "restore-failed": { status: 500, title: "Could not restore the session" },

  // 대시보드: 접속 · 권한
  "login-required": { status: 401, title: "Login required" },
  "bad-csrf-token": { status: 403, title: "Invalid CSRF token" },
  "no-guild-access": { status: 403, title: "No access to this server" },
  "bad-tier": { status: 400, title: "Unknown permission tier" },
  // 대시보드: 상태
  "bot-not-ready": { status: 503, title: "Bot is not ready" },
  "guild-not-found": { status: 404, title: "Server not found" },
  "member-not-found": { status: 404, title: "Member not found in the server" },
  "bot-not-in-voice": { status: 409, title: "Bot is not in a voice channel" },
  "bot-in-other-voice": { status: 409, title: "Bot is busy in another voice channel" },
  "too-many-requests": { status: 429, title: "Too many requests" },
  "too-many-streams": { status: 429, title: "Too many event streams" },
  // 대시보드: 요청 형식
  "bad-request": { status: 400, title: "Malformed request" },
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
  "cache-clear-failed": { status: 500, title: "Could not clear the cache" },
  "token-count-failed": { status: 503, title: "Could not count tokens" },
  "bad-suggest-type": { status: 400, title: "No suggestions for this source type" },
  "bad-suggest-field": { status: 400, title: "No suggestions for this field" },
  "bad-suggest-term": { status: 400, title: "Suggestion term length out of range", params: ["max"] },
  "too-many-items": { status: 400, title: "Too many items", params: ["max"] },
  "urls-empty": { status: 400, title: "No YouTube URLs given" },
  "nothing-to-save": { status: 400, title: "Nothing was sent" },
  "config-not-found": { status: 404, title: "Unknown config file" },
  "config-invalid": { status: 400, title: "Config has problems" },
  "config-unreadable": { status: 409, title: "Config file could not be read" },
  "config-save-failed": { status: 409, title: "Config could not be saved" },
  "storage-unavailable": { status: 503, title: "Storage is temporarily unavailable" },
} as const satisfies Record<string, ProblemSpec>;

type Code = keyof typeof PROBLEMS;
/** 문제 하나: 코드와 그 문장에 드는 값 */
type Problem = { code: Code } & Params;

/** 목록에 있는 코드인가 */
const isCode = (value: string): value is Code => Object.hasOwn(PROBLEMS, value);

/** 코드의 정의 */
const problemOf = (code: Code): ProblemSpec => PROBLEMS[code];

export { PROBLEMS, problemOf, isCode };
export type { Code, Params, Param, Problem, ProblemSpec };
