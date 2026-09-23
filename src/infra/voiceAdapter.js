// 음성 라이브러리와 디스코드 게이트웨이 사이에 끼우는 어댑터.
//
// @discordjs/voice 는 음성 서버 연결이 닫히면(닫힘 코드 4014 말고) 곧바로 그때의 설정으로 다시 참가한다.
// 봇이 다른 채널로 옮겨질 때 그 닫힘이 새 채널을 알리는 상태 패킷보다 먼저 오면 옛 채널로 참가해,
// 봇이 원래 채널로 끌려갔다가 돌아온다(사람이 봇을 자기 채널로 불러올 때 잘 난다).
// 참가 요청(op 4)을 잠깐 붙잡아, 그사이 게이트웨이가 봇이 다른 채널로 옮겨졌다고 알려 오면 그 채널로 고쳐 보낸다.

const VOICE_STATE_UPDATE = 4; // 게이트웨이 op. 음성 채널 참가 · 이동 · 나가기
const HOLD_MS = 300; // 붙잡는 시간. 닫힘과 상태 패킷은 보통 몇 ms 차이로 온다

/**
 * @param {Function} creator  디스코드 쪽 어댑터 생성기(guild.voiceAdapterCreator)
 * @param {{holdMs?: number, onRewrite?: (from: string, to: string) => void}} [opts]
 */
function holdingAdapterCreator(creator, { holdMs = HOLD_MS, onRewrite } = {}) {
  return (methods) => {
    let pending = null; // 붙잡아 둔 참가 요청 { payload, timer }
    let current = null; // 게이트웨이가 마지막으로 알려 준 봇의 채널

    const adapter = creator({
      ...methods,
      onVoiceStateUpdate(data) {
        const moved = Boolean(data.channel_id) && data.channel_id !== current;
        current = data.channel_id ?? null;
        // 채널이 바뀐 알림일 때만 고친다. 음소거 같은 알림(채널 그대로)이 우리가 요청한 이동을 되돌리지 않게
        if (pending && moved && data.channel_id !== pending.payload.d.channel_id) {
          onRewrite?.(pending.payload.d.channel_id, data.channel_id);
          pending.payload = { ...pending.payload, d: { ...pending.payload.d, channel_id: data.channel_id } };
        }
        methods.onVoiceStateUpdate(data);
      },
    });

    const flush = () => {
      if (!pending) return;
      const { payload, timer } = pending;
      clearTimeout(timer);
      pending = null;
      adapter.sendPayload(payload);
    };

    return {
      sendPayload(payload) {
        // 나가기(채널 없음)와 다른 요청은 붙잡지 않는다. 붙잡아 둔 참가가 있으면 먼저 보낸다
        if (payload?.op !== VOICE_STATE_UPDATE || !payload.d?.channel_id) {
          flush();
          return adapter.sendPayload(payload);
        }
        // 새 참가 요청이 옛 것을 대신한다
        if (pending) clearTimeout(pending.timer);
        pending = { payload, timer: setTimeout(flush, holdMs) };
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

const exported = { holdingAdapterCreator, HOLD_MS };
export default exported;
export { exported as "module.exports" };
