"use strict";

const MusicPlayer = require("./MusicPlayer");
const TrackResolver = require("./TrackResolver");
const GuildSettingsManager = require("./GuildSettingsManager");
const { silentResponder } = require("./playbackResponder");
const log = require("./logger").child({ category: "player" });

/**
 * 곡 추가 경로의 단일 코어. 진입점(슬래시 명령/전용 채널/검색 선택/대시보드)은
 * 권한 검사와 응답 매체(responder)만 책임지고 나머지는 전부 여기를 지난다.
 *
 * 여기서 디스코드 상호작용도 HTTP 응답도 만들지 않는다 — 결과 객체만 돌려준다.
 */

/**
 * 요청자 표준형. GuildMember / 대시보드 세션 사용자 / 세션 복구 스텁이 각기 다른 모양으로
 * 들어오던 것을 한 모양으로 접는다. 소비자는 id·username·tag만 읽는다.
 */
function toRequester(source) {
  if (!source) return null;
  if (typeof source === "string") return { id: null, username: source, tag: source };

  return {
    id: source.id ?? null,
    username: source.username ?? source.user?.username ?? source.displayName ?? null,
    tag: source.tag ?? source.user?.tag ?? null,
  };
}

/**
 * 길드의 플레이어를 확보한다. 이미 있으면 재사용하고 채널만 갱신.
 *
 * voiceChannel은 봇이 유휴일 때만 갱신한다 — 재생 중 다른 채널 참조로 오염되면
 * 이후 재연결이 엉뚱한 채널로 간다. textChannel은 null로 덮어쓰지 않는다(대시보드).
 */
function ensurePlayer(client, { guild, textChannel = null, voiceChannel = null }) {
  const botVoiceChannel = guild.members.me?.voice?.channel ?? null;

  let player = client.players.get(guild.id);
  if (!player) {
    player = new MusicPlayer(guild, textChannel, voiceChannel ?? botVoiceChannel);
    client.players.set(guild.id, player);
    return player;
  }

  if (!botVoiceChannel && voiceChannel) player.voiceChannel = voiceChannel;
  if (textChannel) player.textChannel = textChannel;
  return player;
}

/**
 * 대시보드처럼 텍스트 채널 개념이 없는 진입점의 출력 채널을 정한다.
 * 서버가 지정한 봇 전용 채널만 쓴다 — 아무 채널이나 추측하면 엉뚱한 곳에 도배한다.
 */
async function resolveFallbackTextChannel(guild) {
  try {
    const botChannelId = await GuildSettingsManager.getBotChannel(guild.id);
    if (!botChannelId) return null;
    const channel = guild.channels.cache.get(botChannelId) ?? null;
    return channel && typeof channel.send === "function" ? channel : null;
  } catch {
    return null;
  }
}

/**
 * 곡 추가/재생 요청을 처리한다.
 *
 * @param {object} client 디스코드 클라이언트
 * @param {object} options
 * @param {object} options.guild            길드
 * @param {object} options.requester        요청자 (GuildMember 또는 { id, username })
 * @param {string} [options.query]          검색어/URL — tracks를 주지 않으면 필수
 * @param {Array}  [options.tracks]         이미 해석된 트랙 (검색 선택 경로)
 * @param {object} [options.textChannel]    안내·임베드를 보낼 채널
 * @param {object} [options.voiceChannel]   접속할 음성 채널
 * @param {boolean}[options.insertFirst]    대기열 맨 앞에 삽입
 * @param {boolean}[options.single]         재생목록이어도 첫 곡만
 * @param {object} [options.responder]      응답 매체 어댑터 (기본: 무동작)
 * @param {string} options.source           로그 라벨
 * @returns {Promise<{success: boolean, message?: string, isPlaylist?: boolean, tracks?: Array}>}
 */
async function requestPlayback(client, { guild, requester, query = null, tracks = null, textChannel = null, voiceChannel = null, insertFirst = false, single = false, responder = silentResponder, source = "play" }) {
  const guildId = guild.id;
  const who = toRequester(requester);

  let resolvedTextChannel = textChannel;
  if (!resolvedTextChannel && !client.players.get(guildId)?.textChannel) {
    resolvedTextChannel = await resolveFallbackTextChannel(guild);
  }

  const player = ensurePlayer(client, { guild, textChannel: resolvedTextChannel, voiceChannel });

  let trackData;
  if (tracks) {
    trackData = { success: true, isPlaylist: tracks.length > 1, tracks };
  } else {
    log.info({ sub: "play" }, `${source} | 서버=${guildId} | 사용자=${who?.tag ?? who?.username ?? who?.id ?? "?"} | 검색어="${query}"`);
    trackData = await TrackResolver.resolveQuery(query, guildId, `${source}.resolveQuery`);
    if (!trackData.success) return trackData;
  }

  // 재생목록에서 첫 곡만 (대시보드의 "한 곡만" 옵션)
  if (single && trackData.tracks.length > 1) {
    trackData = { ...trackData, isPlaylist: false, tracks: trackData.tracks.slice(0, 1) };
  }
  if (insertFirst) trackData.insertFirst = true;

  const result = await client.musicEmbedManager.handleMusicData(guildId, trackData, who, responder);
  return { ...result, isPlaylist: trackData.isPlaylist, tracks: trackData.tracks, player };
}

module.exports = { requestPlayback, toRequester, ensurePlayer, _internals: { resolveFallbackTextChannel } };
