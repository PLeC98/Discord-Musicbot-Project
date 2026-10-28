// 게이트웨이에서 새 세션을 시작할 때(identify) READY 의 서버 목록에 없는 서버: 끊긴 동안 봇이 나갔다(내보내짐 · 서버 삭제).
// discord.js 는 READY 에서 서버를 지우지 않아 "쓸 수 있음" · 옛 멤버로 캐시에 남는다(대시보드가 그 서버를 보여 주고 옛 멤버로 판정한다).
// 봇이 나간 서버와 같은 길(GuildDelete 핸들러들: 플레이어 · 실행 상태 · 대시보드 알림)로 정리하고 캐시에서 뺀다.
// READY 를 처리하기 바로 전에 같은 흐름에서 오는 원본 패킷(Events.Raw)으로 본다(늦추면 그동안 옛 캐시를 믿는다)

import { Events, type Client } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "guild" });

type RawPacket = { t?: string | null; d?: { guilds?: Array<{ id: string }> } | null };
type GoneClient = Pick<Client, "guilds" | "channels" | "emit"> & { on(event: Events.Raw, listener: (packet: RawPacket, shardId: number) => void): unknown };

function watchGoneGuilds(client: GoneClient) {
  client.on(Events.Raw, (packet, shardId) => {
    if (packet.t !== "READY" || !packet.d?.guilds) return;
    const present = new Set(packet.d.guilds.map((g) => g.id));
    // 그 샤드의 서버만(다른 샤드의 서버는 그 샤드의 READY 가 본다)
    const gone = [...client.guilds.cache.values()].filter((guild) => guild.shardId === shardId && !present.has(guild.id));
    for (const guild of gone) {
      log.info(`끊긴 동안 나간 서버를 정리합니다: ${guild.name} (${guild.id})`);
      client.emit(Events.GuildDelete, guild);
      for (const id of guild.channels.cache.keys()) client.channels.cache.delete(id);
      client.guilds.cache.delete(guild.id);
    }
  });
}

export { watchGoneGuilds };
