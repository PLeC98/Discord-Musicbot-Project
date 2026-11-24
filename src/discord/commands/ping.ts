// /ping: 잴 수 있는 지연을 본인에게만. 응답 시간(명령과 응답 메시지의 디스코드 시각 차라 봇 PC의 시계와 상관없다), REST 왕복(응답을 보내고 답을 받기까지),
// 게이트웨이 하트비트 왕복과 그 기록의 평균(대시보드의 핑과 같은 값), 이 서버의 음성 게이트웨이 하트비트 왕복(봇이 음성 채널에 있을 때).
// 음성의 UDP 왕복은 @discordjs/voice가 더 이상 재지 않아 없다. 다시 재기 버튼은 같은 메시지를 고쳐 다시 잰다

import { SlashCommandBuilder, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { getVoiceConnection } from "@discordjs/voice";
import type { AnywhereCommand } from "../../app/command-loader.ts";
import { statusHistory } from "../../dashboard/status/history.ts";
import { averageOf, historyMinutes } from "../../rules/latency.ts";
import { LIFETIME, expireSelf, keepSelf } from "../../ui/delivery.ts";
import { frame, post, reply } from "../../ui/frame.ts";
import { pingView, type PingValues } from "../../ui/ping-view.ts";
import { privateText } from "../../ui/language.ts";
import type { BotText } from "../../ui/text/index.ts";

/** 재는 동안의 화면 */
const measuring = (T: BotText) => frame({ title: T.info.ping().title, body: T.info.pinging() });

/** 현재 값. responseMs, restMs는 부른 쪽이 잰 것 */
function measured(interaction: ChatInputCommandInteraction | ButtonInteraction, responseMs: number, restMs: number): PingValues {
  const gateway = Math.round(interaction.client.ws.ping);
  const { stepMs, ping } = statusHistory();
  const voice = interaction.guildId ? getVoiceConnection(interaction.guildId)?.ping.ws : undefined;
  return {
    responseMs: Math.max(0, responseMs),
    restMs,
    gatewayMs: gateway >= 0 ? gateway : null,
    gatewayAverage: ping.length ? { minutes: historyMinutes(stepMs, ping.length), ms: averageOf(ping) } : null,
    voiceMs: voice === undefined ? null : Math.round(voice),
    again: interaction.inCachedGuild(),
  };
}

/** 다시 재기: 같은 메시지를 측정 중 화면으로 고친 시각으로 응답 시간을 잰다 */
async function pingAgain(interaction: ButtonInteraction) {
  const startedAt = performance.now();
  const { resource } = await interaction.update({ ...post(measuring(privateText(interaction))), withResponse: true });
  const restMs = Math.round(performance.now() - startedAt);
  const answeredAt = resource?.message?.editedTimestamp ?? Date.now();
  await interaction.editReply(post(pingView(privateText(interaction), measured(interaction, answeredAt - interaction.createdTimestamp, restMs))));
  keepSelf(interaction, LIFETIME.screen);
}

const exported: AnywhereCommand = {
  help: { section: "info", tier: "everyone" },
  anywhere: true,
  name: "ping",
  data: (C) => new SlashCommandBuilder().setName("ping").setDescription(C.ping.description),

  async execute(interaction) {
    const startedAt = performance.now();
    const { resource } = await interaction.reply({ ...reply(measuring(privateText(interaction))), withResponse: true });
    const restMs = Math.round(performance.now() - startedAt);
    // 보낸 응답의 디스코드 시각. 응답에 메시지가 포함되어 오지 않으면 현재 시각으로 본다
    const answeredAt = resource?.message?.createdTimestamp ?? Date.now();
    await interaction.editReply(post(pingView(privateText(interaction), measured(interaction, answeredAt - interaction.createdTimestamp, restMs))));
    expireSelf(interaction, LIFETIME.screen);
  },
};
export default exported;
export { pingAgain };
