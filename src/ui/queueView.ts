// 대기열 화면 한 벌. /queue 와 재생 패널의 대기열 버튼, 넘기기 버튼이 같은 그림을 쓴다.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import config from "../../config.ts";
import { queueDescription } from "./queueDisplay.ts";
import type { QueuedTrack } from "../player/track.ts";

/** 한 쪽에 보이는 곡 수 */
const PAGE_SIZE = 10;
/** 넘기기 버튼의 customId 앞머리. 뒤에 보일 쪽 번호 */
const PAGE_PREFIX = "queue_page:";

type Listed = Pick<QueuedTrack, "title" | "pageUrl" | "autoplay" | "requestedBy">;
/** 플레이어의 대기열(getQueue 에서 읽는 칸) */
type QueueInfo = { current: Listed | null; queue: Listed[] };

/** 이 대기열의 쪽 수(적어도 1) */
const pagesOf = (info: QueueInfo) => Math.max(1, Math.ceil(info.queue.length / PAGE_SIZE));

/**
 * 대기열 한 쪽. 쪽 번호는 1 부터이고 범위를 넘으면 끝 쪽으로 붙인다. 현재 곡은 첫 쪽에만.
 * 쪽이 둘 이상이면 넘기기 버튼(◀ ▶)을 단다. 넘기면 그때의 대기열로 다시 그린다
 */
/** 대기열 화면이 보는 것. 지금 곡과 대기열 */
function queueInfoOf(player: { currentTrack: Listed | null; queue: Listed[] }): QueueInfo {
  return { current: player.currentTrack, queue: player.queue };
}

function queueView(info: QueueInfo, page = 1) {
  const pages = pagesOf(info);
  const shown = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const offset = (shown - 1) * PAGE_SIZE;
  const total = info.queue.length + (info.current ? 1 : 0);

  const embed = new EmbedBuilder()
    .setTitle("📝 재생 대기열")
    .setColor(config.bot.embedColor)
    .setTimestamp()
    .setDescription(queueDescription({ current: shown === 1 ? info.current : null, header: `📋 다음 노래들 (${info.queue.length}개)`, tracks: info.queue.slice(offset, offset + PAGE_SIZE), first: offset + 1 }))
    .setFooter({ text: `총 ${total}개의 노래${pages > 1 ? ` • ${shown}/${pages} 페이지` : ""}` });

  if (pages === 1) return { embeds: [embed], components: [] };
  const button = (label: string, to: number, disabled: boolean) => new ButtonBuilder().setCustomId(`${PAGE_PREFIX}${to}`).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button("◀", shown - 1, shown === 1), button("▶", shown + 1, shown === pages));
  return { embeds: [embed], components: [row] };
}

/** 넘기기 버튼이 보일 쪽. 알아볼 수 없으면 null */
function pageOf(customId: string) {
  if (!customId.startsWith(PAGE_PREFIX)) return null;
  const page = Number(customId.slice(PAGE_PREFIX.length));
  return Number.isSafeInteger(page) && page >= 1 ? page : null;
}

export { PAGE_SIZE, PAGE_PREFIX, queueView, queueInfoOf, pageOf };
export type { QueueInfo };
