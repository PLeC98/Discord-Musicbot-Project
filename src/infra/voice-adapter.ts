// 음성 라이브러리와 디스코드 게이트웨이 사이에 끼우는 어댑터.
//
// @discordjs/voice 는 음성 서버 연결이 닫히면(닫힘 코드 4014 말고) 곧바로 그때의 설정으로 다시 참가한다.
// 봇이 다른 채널로 옮겨질 때 그 닫힘이 새 채널을 알리는 상태 패킷보다 먼저 오면 옛 채널로 참가해,
// 봇이 원래 채널로 끌려갔다가 돌아온다(사람이 봇을 자기 채널로 불러올 때 잘 난다).
// 참가 요청(op 4)을 잠깐 붙잡아, 그사이 게이트웨이가 봇이 다른 채널로 옮겨졌다고 알려 오면 그 채널로 고쳐 보낸다.
// 내보낼 때 고쳤는지 알린다(onSend). 고치지 않은 요청이 나간 뒤 봇이 그 채널로 돌아오면 라이브러리의 되돌림이다(voiceLink).

import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import logger from "./log/logger.ts";
const log = logger.child({ category: "voice" });

// 게이트웨이로 보내는 것. 여기서 보는 필드만
type GatewayPayload = { op?: number; d?: { channel_id?: string | null; [field: string]: unknown } };

const VOICE_STATE_UPDATE = 4; // 게이트웨이 op. 음성 채널 참가 · 이동 · 나가기
const HOLD_MS = 300; // 붙잡는 시간. 닫힘과 상태 패킷은 보통 몇 ms 차이로 온다

/** creator: 디스코드 쪽 어댑터 생성기(guild.voiceAdapterCreator) */
type Hooks = { holdMs?: number; onRewrite?: (from: string, to: string) => void; onSend?: (channelId: string, rewritten: boolean) => void };

function holdingAdapterCreator(creator: DiscordGatewayAdapterCreator, { holdMs = HOLD_MS, onRewrite, onSend }: Hooks = {}): DiscordGatewayAdapterCreator {
  return (methods) => {
    let pending: { payload: GatewayPayload & { d: { channel_id: string } }; timer: NodeJS.Timeout; rewritten: boolean } | null = null; // 붙잡아 둔 참가 요청
    let current: string | null = null; // 게이트웨이가 마지막으로 알려 준 봇의 채널

    const adapter = creator({
      ...methods,
      onVoiceStateUpdate(data) {
        const to = data.channel_id;
        const moved = Boolean(to) && to !== current;
        current = to ?? null;
        // 채널이 바뀐 알림일 때만 고친다. 음소거 같은 알림(채널 그대로)이 우리가 요청한 이동을 되돌리지 않게
        if (pending && to && moved && to !== pending.payload.d.channel_id) {
          onRewrite?.(pending.payload.d.channel_id, to);
          pending.payload = { ...pending.payload, d: { ...pending.payload.d, channel_id: to } };
          pending.rewritten = true;
        }
        methods.onVoiceStateUpdate(data);
      },
    });

    const flush = () => {
      if (!pending) return;
      const { payload, timer, rewritten } = pending;
      clearTimeout(timer);
      pending = null;
      onSend?.(payload.d.channel_id, rewritten);
      // 붙잡는 동안 라이브러리에는 보냈다고 답했다. 못 보낸 것은 여기서만 안다
      if (!adapter.sendPayload(payload)) log.debug(`음성 채널 ${payload.d.channel_id} 참가 요청을 게이트웨이로 보내지 못했습니다(샤드가 준비되지 않았다)`);
    };

    return {
      sendPayload(payload: GatewayPayload) {
        // 나가기(채널 없음)와 다른 요청은 붙잡지 않는다. 붙잡아 둔 참가가 있으면 먼저 보낸다
        if (payload?.op !== VOICE_STATE_UPDATE || !payload.d?.channel_id) {
          flush();
          return adapter.sendPayload(payload);
        }
        // 새 참가 요청이 옛 것을 대신한다
        if (pending) clearTimeout(pending.timer);
        pending = { payload: payload as GatewayPayload & { d: { channel_id: string } }, timer: setTimeout(flush, holdMs), rewritten: false };
        return true;
      },
      destroy() {
        if (pending) clearTimeout(pending.timer);
        pending = null;
        adapter.destroy();
      },
    };
  };
}

export { holdingAdapterCreator, HOLD_MS };
