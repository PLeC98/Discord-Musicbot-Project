// 재생목록 "더 넣기" 화면: 머리 줄 아래 곡 수 메뉴, 곡 수를 적는 모달, 가져오는 동안의 화면.
// 무엇을 고를 수 있는지(선택지 · custom_id)는 usecases/playlist-more 가 정하고 여기서는 그린다

import { ActionRowBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { frame } from "./frame.ts";
import * as moreText from "./text/ko/more.ts";

/** 곡 수 메뉴. steps 는 묶음 선택지, cap 은 가장 큰 선택지(all: 남은 곡 전부 · perClick: 출처의 한 번 상한에 걸렸다), remaining 은 남은 곡 수 */
type MoreMenu = { customId: string; remaining: number; steps: number[]; cap: number; all: boolean; perClick: boolean };

/** 머리 줄과, 더 넣을 수 있으면 곡 수 메뉴 */
function moreView(head: string, menu: MoreMenu | null) {
  const container = frame({ body: head });
  if (!menu) return container;
  const t = moreText.menu(menu.remaining);
  const select = new StringSelectMenuBuilder()
    .setCustomId(menu.customId)
    .setPlaceholder(t.placeholder)
    .addOptions(...menu.steps.map((n) => ({ label: moreText.step(n), value: String(n) })), { label: moreText.capLabel(menu.cap, { all: menu.all, perClick: menu.perClick }), value: String(menu.cap) }, { label: t.custom, value: "custom" }, { label: t.stop, value: "stop" });
  return container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
}

/** 가져오는 동안. done · want 를 주면 몇 곡째인지 */
const fetchingView = (progress?: { done: number; want: number }) => frame({ body: progress ? moreText.fetchingCount(progress.done, progress.want) : moreText.fetching() });

/** 곡 수를 적는 모달. max 는 적을 수 있는 가장 큰 수, suggested 는 미리 적어 둘 수 */
function countModal({ customId, max, suggested }: { customId: string; max: number; suggested: number }) {
  const t = moreText.countModal(max);
  const input = new TextInputBuilder().setCustomId("count").setLabel(t.label).setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(5).setPlaceholder(String(suggested)).setRequired(true);
  return new ModalBuilder().setCustomId(customId).setTitle(t.title).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export { moreView, fetchingView, countModal };
export type { MoreMenu };
