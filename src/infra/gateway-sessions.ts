// 샤드마다 게이트웨이 새 세션을 받은 때. 새 세션이면 디스코드가 봇의 음성 상태를 지우고 음성 서버는 4014 로 닫는다(player/voice-link 가 강제 퇴장과 가른다).
// 신호는 원본 READY 패킷이다. shardReady 는 모든 서버를 받은 뒤에 와서, 봇 채널 캐시가 비는 때(GUILD_CREATE)보다 늦을 수 있다. 세션 재개는 음성을 건드리지 않아 세지 않는다

import { Events, type Client } from "discord.js";

const renewedAt = new Map<number, number>();

/** 새 세션을 듣기 시작한다. READY 를 처리하기 전에 오는 원본 패킷으로 본다 */
function watchGatewaySessions(client: Pick<Client, "on">) {
  client.on(Events.Raw, (packet: { t?: string | null }, shardId: number) => {
    if (packet.t === "READY") renewedAt.set(shardId, Date.now());
  });
}

/** 그 샤드가 마지막으로 새 세션을 받은 때(ms). 받은 적이 없으면 null */
const newSessionAt = (shardId: number): number | null => renewedAt.get(shardId) ?? null;

export { watchGatewaySessions, newSessionAt };
