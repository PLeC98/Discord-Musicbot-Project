// 봇 상태 탭의 플레이어: 플레이어가 있는 서버(재생, 일시정지, 곡 없이 대기). 상태별로 세고, 필터링하고, 쿼리의 구간만 행으로

import { getVoiceConnections } from "@discordjs/voice";
import { listenersIn } from "../../rules/holds.ts";
import type { Client } from "discord.js";
import { playState } from "../../ui/player-status.ts";
import { koMatch } from "../../rules/ko-search.ts";
import type { Player } from "../../player/player.ts";
import type { PlayerRegistry } from "../../player/registry.ts";
import type { AdminStatus, PlayerRow, PlayerState, StatusQuery } from "../contract/admin.ts";
import { guildIconUrl } from "../images.ts";
import { cut } from "../list-window.ts";

/**
 * viewerId 가 그 서버 멤버로 보이나(멤버가 아니면 화면은 그 서버 화면으로 잇지 않는다). 멤버 캐시에 있거나 사용자의 서버 목록(memberIds)에 있으면 참.
 * 표시만이다(3초마다 서버마다 조회하지 않는다). 그 서버를 여는 것은 openGuild 가 본다. memberIds 가 null 이면(목록을 받지 못함) 멤버 캐시만
 */
function looksMember(client: Client, guildId: string, viewerId: string, memberIds: ReadonlySet<string> | null) {
  return Boolean(client.guilds.cache.get(guildId)?.members.cache.has(viewerId) || memberIds?.has(guildId));
}

/** 지금 곡. 소리가 붙기 전에는 곡이 없다(재생 화면과 같은 규칙) */
function nowPlaying(player: Player, state: PlayerState) {
  const track = state === "idle" ? null : player.currentTrack;
  if (!track) return { title: null, artist: null, position: 0, duration: 0 };
  return { title: track.title ?? null, artist: track.artist ?? null, position: Math.floor((player.getCurrentTime?.() || 0) / 1000), duration: track.duration ?? 0 };
}

/** 플레이어 하나의 행에서 멤버 표시, 아이콘을 뺀 것(필터링, 합계는 전부에 대해 계산한다) */
function playerLine(player: Player) {
  const state = playState(player);
  const channel = player.guild.members.me?.voice?.channel;
  // 듣는 사람(봇, 헤드셋을 끈 사람 빼고). 혼자 남음과 같은 기준(rules/holds)
  return { player, state, ...nowPlaying(player, state), listeners: channel ? listenersIn(channel.members.values()) : 0, queued: player.queue?.length ?? 0 };
}
type PlayerLine = ReturnType<typeof playerLine>;

function playerRow({ player, ...line }: PlayerLine, member: boolean): PlayerRow {
  const { guild } = player;
  return { guildId: guild.id, name: guild.name, icon: guildIconUrl(guild.id, guild.icon), member, ...line };
}

/** 개수, 합계는 전부, 행은 필터링된 것의 구간만(삽입 순서, 멤버 표시도 그 행만). viewerId, memberIds 는 looksMember */
function playerRows(client: Client, players: PlayerRegistry, query: Pick<StatusQuery, "players" | "states" | "q">, viewerId: string, memberIds: ReadonlySet<string> | null): AdminStatus["players"] {
  const all = [...players.values()].map(playerLine);
  const counts: Record<PlayerState, number> = { playing: 0, paused: 0, idle: 0 };
  for (const line of all) counts[line.state]++;
  const states = new Set(query.states);
  const matched = all.filter((line) => states.has(line.state) && [line.player.guild.name, line.title ?? "", line.artist ?? ""].some((text) => koMatch(text, query.q)));
  const { from, rows } = cut(matched, query.players);
  return {
    voiceConnections: getVoiceConnections().size,
    queued: all.reduce((n, line) => n + line.queued, 0),
    listeners: all.reduce((n, line) => n + line.listeners, 0),
    counts,
    matched: matched.length,
    from,
    rows: rows.map((line) => playerRow(line, looksMember(client, line.player.guild.id, viewerId, memberIds))),
  };
}

export { playerRows };
