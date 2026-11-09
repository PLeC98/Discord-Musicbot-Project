// 봇이 플레이어 없이 음성 채널에만 남은 서버(src/player/voice-leave).
// 이전 실행이 남긴 음성 상태는 나가기(op 4 null)만으로는 빠지지 않는 일이 있어, 이 가짜는 넘겨받기 전의 나가기를 늘 무시한다.
// 같은 채널 참가(op 4)를 보내면 넘겨받고(takeOver), 넘겨받은 뒤의 나가기는 먹힌다(gatewayLeaves).
// atDiscord: 디스코드가 아는 봇의 채널(null 은 음성에 없음, Error 는 조회 실패), cached: 캐시의 봇 채널

import { EventEmitter } from "node:events";
import { Status, type Guild } from "discord.js";
import { fake } from "./fake.ts";

type Lingering = { cached?: string | null; ready?: boolean; takeOver?: boolean; gatewayLeaves?: boolean; restError?: Error | null; atDiscord?: string | null | Error };

const UNKNOWN_VOICE_STATE = Object.assign(new Error("Unknown Voice State"), { code: 10065 });

function lingeringGuild({ cached = "vc1", ready = true, takeOver = true, gatewayLeaves = true, restError = null, atDiscord = "vc1" }: Lingering = {}) {
  const client = Object.assign(new EventEmitter(), { user: { id: "bot" } });
  const sent: Array<{ op: number; d: { channel_id: string | null; [field: string]: unknown } }> = [];
  const order: string[] = [];
  let rest = 0;
  let mine = false; // 이 접속이 음성 상태를 넘겨받았나
  // 다른 서버, 다른 사람의 알림은 봇의 이 서버 알림으로 보지 않는다. 요청마다 늘 온다(봇의 알림이 오지 않을 때도)
  const noise = (channelId: string | null) => {
    setImmediate(() => client.emit("voiceStateUpdate", {}, { guild: { id: "다른 서버" }, id: "bot", channelId }));
    setImmediate(() => client.emit("voiceStateUpdate", {}, { guild: { id: "g9" }, id: "사람", channelId }));
  };
  const emit = (channelId: string | null) => setImmediate(() => client.emit("voiceStateUpdate", {}, { guild: { id: "g9" }, id: "bot", channelId }));
  const guild = fake<Guild>({
    id: "g9",
    name: "서버",
    client,
    voiceStates: {
      fetch: async (id: string, options: { force?: boolean; cache?: boolean }) => {
        order.push(`fetch:${id}:${String(options.force)}:${String(options.cache)}`);
        if (atDiscord instanceof Error) throw atDiscord;
        if (atDiscord === null) throw UNKNOWN_VOICE_STATE;
        return { channelId: atDiscord };
      },
    },
    shard: {
      status: ready ? Status.Ready : Status.Disconnected,
      send: (payload: (typeof sent)[number]) => {
        const to = payload.d.channel_id;
        order.push(`op4:${String(to)}`);
        sent.push(payload);
        noise(to);
        if (to && takeOver) {
          mine = true;
          emit(to);
        } else if (!to && mine && gatewayLeaves) emit(null);
      },
    },
    members: {
      me: {
        voice: {
          channel: cached ? { id: cached } : null,
          channelId: cached,
          selfDeaf: true,
          selfMute: false,
          disconnect: async () => {
            order.push("rest");
            rest++;
            if (restError) throw restError;
          },
        },
      },
    },
  });
  return { guild, client, sent, order, rests: () => rest };
}

export { lingeringGuild };
