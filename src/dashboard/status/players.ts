// 봇 상태 탭의 플레이어 줄: 플레이어가 있는 서버 전부(재생 · 일시정지 · 곡 없이 대기)

import { getVoiceConnections } from "@discordjs/voice";
import type { Client } from "discord.js";
import { playState } from "../../ui/player-status.ts";
import type { Player } from "../../player/player.ts";
import type { PlayerRegistry } from "../../player/registry.ts";
import type { AdminStatus, PlayerRow } from "../contract/admin.ts";
import { guildIconUrl } from "../images.ts";

/** viewerId 가 그 서버 멤버인가(멤버가 아니면 화면은 그 서버 화면으로 잇지 않는다). 캐시 우선 */
async function isMember(client: Client, guildId: string, viewerId: string) {
  const guild = client.guilds.cache.get(guildId);
  return Boolean(guild && (await guild.members.fetch(viewerId).catch(() => null)));
}

/** 지금 곡. 소리가 붙기 전에는 곡이 없다(재생 화면과 같은 규칙) */
function nowPlaying(player: Player, state: PlayerRow["state"]) {
  const track = state === "idle" ? null : player.currentTrack;
  if (!track) return { title: null, artist: null, position: 0, duration: 0 };
  return { title: track.title ?? null, artist: track.artist ?? null, position: Math.floor((player.getCurrentTime?.() || 0) / 1000), duration: track.duration ?? 0 };
}

function playerRow(player: Player, member: boolean): PlayerRow {
  const guild = player.guild;
  const state = playState(player);
  const channel = guild.members.me?.voice?.channel;
  return {
    guildId: guild.id,
    name: guild.name,
    icon: guildIconUrl(guild.id, guild.icon),
    member,
    state,
    ...nowPlaying(player, state),
    // 듣는 사람(봇 빼고)
    listeners: channel ? channel.members.filter((m) => !m.user.bot).size : 0,
    queued: player.queue?.length ?? 0,
  };
}

async function playerRows(client: Client, players: PlayerRegistry, viewerId: string): Promise<AdminStatus["players"]> {
  const list = await Promise.all([...players.values()].map(async (player) => playerRow(player, await isMember(client, player.guild.id, viewerId))));
  return { voiceConnections: getVoiceConnections().size, queued: list.reduce((n, row) => n + row.queued, 0), list };
}

export { playerRows };
