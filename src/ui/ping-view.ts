// /ping 화면(Components V2 텍스트): 값마다 한 줄(속도별 색, 이름, 값)과 무엇과 무엇 사이를 잰 것인지 작은 글씨 줄, 구분선, 다시 재기 버튼.
// 판정은 rules/latency(연결 지연은 대시보드의 핑과 같은 기준)

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, resolveColor } from "discord.js";
import { linkLevel, responseLevel } from "../rules/latency.ts";
import type { Level } from "../rules/status-levels.ts";
import { colorOf } from "./colors.ts";
import { PING, customId } from "./custom-ids.ts";
import { buttonEmoji } from "./icons.ts";
import * as infoText from "./text/ko/info.ts";

type PingValues = {
  responseMs: number;
  restMs: number;
  /** 게이트웨이 하트비트 왕복. 봇이 막 켜져 아직 없으면 null */
  gatewayMs: number | null;
  /** 게이트웨이 기록의 평균. 기록이 없으면 null */
  gatewayAverage: { minutes: number; ms: number } | null;
  /** 이 서버의 음성 게이트웨이 하트비트 왕복. 음성 채널에 없거나 아직 없으면 null 이고 줄을 뺀다 */
  voiceMs: number | null;
  /** 다시 재기 버튼을 단다(서버 밖의 버튼은 받지 않으므로 서버 안에서만) */
  again: boolean;
};

const MARK: Record<Level, string> = { ok: "🟢", warn: "🟡", bad: "🔴" };
const ms = (value: number) => `\`${value}ms\``;

function pingView(v: PingValues) {
  const t = infoText.ping();
  const line = (mark: string, name: string, value: string, note: string) => `${mark} **${name}** ${value}\n-# ${note}`;
  const average = v.gatewayAverage ? ` · ${t.average(v.gatewayAverage.minutes)} ${ms(v.gatewayAverage.ms)}` : "";
  const lines = [line(MARK[responseLevel(v.responseMs)], t.response.name, ms(v.responseMs), t.response.note), line(MARK[linkLevel(v.restMs)], t.rest.name, ms(v.restMs), t.rest.note), v.gatewayMs === null ? line("⚪", t.gateway.name, `\`${t.measuring}\``, t.gateway.note) : line(MARK[linkLevel(v.gatewayMs)], t.gateway.name, ms(v.gatewayMs) + average, t.gateway.note), v.voiceMs === null ? null : line(MARK[linkLevel(v.voiceMs)], t.voice.name, ms(v.voiceMs), t.voice.note)].filter(
    (one): one is string => one !== null,
  );
  const box = new ContainerBuilder().setAccentColor(resolveColor(colorOf("brand")));
  box.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${t.title}`));
  box.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));
  if (v.again) {
    box.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(customId(PING, "again")).setLabel(t.again).setEmoji(buttonEmoji("refresh")).setStyle(ButtonStyle.Secondary)));
  }
  return box;
}

export { pingView };
export type { PingValues };
