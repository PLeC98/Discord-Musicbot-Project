// 대기열 화면 한 벌. /queue 와 재생 패널의 대기열 버튼, 넘기기 버튼이 같은 그림을 쓴다.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { queueDescription } from "./queue-display.ts";
import type { QueuedTrack } from "../player/track.ts";
import { QUEUE, customId } from "./custom-ids.ts";
import { colorOf } from "./colors.ts";
import { buttonEmoji, type IconKey } from "./icons.ts";
import * as queueText from "./text/ko/queue.ts";

/** 한 페이지에 보이는 곡 수 */
const PAGE_SIZE = 10;
/** 넘기기 버튼의 customId 접두사. 뒤에 보일 페이지 번호 */
const PAGE_PREFIX = customId(QUEUE, "page", "");

type Listed = Pick<QueuedTrack, "title" | "pageUrl" | "autoplay" | "requestedBy">;
/** 대기열 화면이 보는 것. 다음 곡들(지금 곡은 재생 패널이 보인다) */
type QueueInfo = { queue: Listed[] };

/** 이 대기열의 페이지 수(적어도 1) */
const pagesOf = (info: QueueInfo) => Math.max(1, Math.ceil(info.queue.length / PAGE_SIZE));

/** 대기열 화면이 보는 것 */
function queueInfoOf(player: { queue: Listed[] }): QueueInfo {
  return { queue: player.queue };
}

/**
 * 대기열 한 페이지. 페이지 번호는 1 부터이고 범위를 넘으면 끝 페이지로 붙인다.
 * 페이지가 둘 이상이면 넘기기 버튼(이전 · 다음 쪽)을 단다. 넘기면 그때의 대기열로 다시 그린다
 */
function queueView(info: QueueInfo, page = 1) {
  const pages = pagesOf(info);
  const shown = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const offset = (shown - 1) * PAGE_SIZE;
  const t = queueText.view({ count: info.queue.length, page: shown, pages });
  const embed = new EmbedBuilder()
    .setTitle(t.title)
    .setColor(colorOf("brand"))
    .setTimestamp()
    .setDescription(queueDescription({ tracks: info.queue.slice(offset, offset + PAGE_SIZE), first: offset + 1 }))
    .setFooter({ text: t.footer });

  if (pages === 1) return { embeds: [embed], components: [] };
  const button = (key: IconKey, to: number, disabled: boolean) => new ButtonBuilder().setCustomId(`${PAGE_PREFIX}${to}`).setEmoji(buttonEmoji(key)).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button("page_prev", shown - 1, shown === 1), button("page_next", shown + 1, shown === pages));
  return { embeds: [embed], components: [row] };
}

/** 넘기기 버튼이 보일 페이지. 알아볼 수 없으면 null */
function pageOf(customId: string) {
  if (!customId.startsWith(PAGE_PREFIX)) return null;
  const page = Number(customId.slice(PAGE_PREFIX.length));
  return Number.isSafeInteger(page) && page >= 1 ? page : null;
}

export { PAGE_SIZE, PAGE_PREFIX, queueView, queueInfoOf, pageOf };
export type { QueueInfo };
