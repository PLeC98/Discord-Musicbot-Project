/**
 * 음성 채널 상태의 현재 값과 그게 우리가 쓴 것인지를 추적한다.
 *
 * REST로는 알 수 없다. 채널 객체에 `status`가 실려 오지 않아서, 읽어 비교하려 하면 언제나
 * 빈 문자열을 받고 사람이 적어 둔 상태를 덮어쓰게 된다.
 *
 * 값은 게이트웨이로만 온다. 기동 시 `GUILD_CREATE`의 채널 목록에 실려 오고(없으면 `null`),
 * 이후 바뀔 때마다 `VOICE_CHANNEL_STATUS_UPDATE`가 온다(우리가 쓴 것도 되돌아온다).
 */

const current = new Map<string, string>(); // channelId -> 현재 상태 문자열 ("" = 비어 있음)
const ours = new Map<string, string>(); // channelId -> 우리가 마지막으로 쓴 값

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** 게이트웨이가 알려 준 현재 값. 누가 바꿨든 그대로 기록한다. */
function observe(channelId: string | null | undefined, status: unknown) {
  if (!channelId) return;
  current.set(channelId, text(status));
}

/** 우리가 쓴 값. 되돌아오는 이벤트가 "남이 바꾼 것"으로 보이지 않게 해 준다. */
function mark(channelId: string | null | undefined, status: unknown) {
  if (!channelId) return;
  const value = text(status);
  ours.set(channelId, value);
  current.set(channelId, value);
}

/**
 * 지금 이 채널의 상태를 우리가 써도 되는가.
 *
 * 비어 있거나, 마지막으로 우리가 쓴 값 그대로면 우리 것이다.
 * 사람이 적어 둔 것이 올라와 있으면 건드리지 않는다.
 */
function canWrite(channelId: string | null | undefined) {
  if (!channelId) return false;
  const now = current.get(channelId);
  if (now === undefined) return true; // 아직 아무 소식도 못 들은 채널. 기동 시 GUILD_CREATE가 채운다
  return now === "" || now === ours.get(channelId);
}

// 게이트웨이 패킷에서 여기서 읽는 칸만
type Packet = { t?: unknown; d?: { id?: string; status?: unknown; channels?: Array<{ id?: string; type?: number; status?: unknown } | null> } | null };

/** 봇이 받는 모든 게이트웨이 패킷에서 상태 정보만 골라 담는다. */
function consumePacket(packet: Packet | null | undefined) {
  if (!packet || typeof packet.t !== "string") return;

  if (packet.t === "VOICE_CHANNEL_STATUS_UPDATE") {
    observe(packet.d?.id, packet.d?.status);
    return;
  }
  if (packet.t === "GUILD_CREATE") {
    for (const channel of packet.d?.channels ?? []) {
      if (channel?.type === 2) observe(channel.id, channel.status);
    }
  }
}

/** 테스트용. 기록 비우기 */
function _reset() {
  current.clear();
  ours.clear();
}

export { observe, mark, canWrite, consumePacket };
export const _internals = { current, ours, _reset };
