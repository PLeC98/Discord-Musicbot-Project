// 자동재생 진입점: /autoplay 와 패널의 자동재생 버튼이 같은 절차(answerAutoplay)를 쓰고, 장르 메뉴에서 선택한 것을 받는다.
// 켜기 · 끄기 · 권한 · 플레이어 만들기는 usecases/controls 의 autoplay 가 한다

import { type ButtonInteraction, type RepliableInteraction, type StringSelectMenuInteraction } from "discord.js";
import * as errors from "../../ui/text/ko/errors.ts";
import * as controls from "../../usecases/controls.ts";
import { ensurePlayer, resolveFallbackTextChannel } from "../../usecases/add-tracks.ts";
import { checkPanelChannel } from "../../usecases/permissions.ts";
import { canPost } from "../../ui/channels.ts";
import { controlMessage } from "../../ui/control-messages.ts";
import { buildGenreMenu, buildAutoplayOffMenu, autoplayOn } from "../../ui/genre-menu.ts";
import { PANEL, AUTOPLAY, IDLE_SESSION, customId, partsOf } from "../../ui/custom-ids.ts";
import { route, type Route } from "./route.ts";
import type { BotContext } from "../../app/bot-context.ts";
import type { Player } from "../../player/player.ts";
import { LIFETIME, noticeSelf, toAll, toSelf } from "../../ui/delivery.ts";

/**
 * 켜져 있으면 끄고 메뉴가 떠 있는 동안 장르를 다시 선택할 기회를 준다(선택하면 변경, 두면 종료).
 * 꺼져 있으면 장르 메뉴를 표시한다. 플레이어가 없어도 표시한다(선택한 뒤에 만든다)
 */
async function answerAutoplay(interaction: RepliableInteraction<"cached">, player: Player | undefined) {
  const actor = { member: interaction.member };
  if (player?.autoplay) {
    const r = await controls.autoplay(player, actor, false, { onAccepted: () => toSelf(interaction, buildAutoplayOffMenu(), LIFETIME.menu) });
    if (!r.ok) return noticeSelf(interaction, controlMessage(r));
    return;
  }
  const blocked = await controls.autoplayBlocked(actor);
  if (blocked) return noticeSelf(interaction, controlMessage(blocked));
  // 켜면 플레이어를 만들어 패널을 올린다. /play 와 같은 검사
  const panelErr = await checkPanelChannel(interaction.guild, interaction, player?.textChannel);
  if (panelErr) return noticeSelf(interaction, errors.notice(panelErr));
  return toSelf(interaction, buildGenreMenu(), LIFETIME.menu);
}

// 끝난 패널 · 재생 중 패널 양쪽에서 온다. 재생 중 패널의 버튼은 다른 패널 버튼처럼 패널의 세션이 지금 세션이어야 한다.
// 끝난 패널의 버튼(idle)은 세션이 없어 어느 플레이어에도 통한다(/join 뒤 · 대기열이 끝나 기다리는 동안에도 플레이어가 있다). /autoplay 와 같다
async function handleAutoplayButton(interaction: ButtonInteraction<"cached">, { players }: BotContext) {
  const player = players.get(interaction.guild.id);
  const sessionId = partsOf(interaction.customId).rest[0];
  if (player && sessionId && sessionId !== IDLE_SESSION && player.sessionId && sessionId !== player.sessionId) return noticeSelf(interaction, errors.notice("stale-session"));
  return answerAutoplay(interaction, player);
}

// 장르 메뉴에서 선택했다. 메뉴(본인)를 삭제하고 켠 결과는 모두에게
async function handleAutoplayGenre(interaction: StringSelectMenuInteraction<"cached">, bot: BotContext) {
  const { guild, member } = interaction;
  const genre = interaction.values[0];
  // 친 채널에 글을 올릴 수 없으면 전용 채널
  const textChannel = canPost(interaction.channel) ? interaction.channel : await resolveFallbackTextChannel(guild);
  const create = () => ensurePlayer(bot, { guild, textChannel, voiceChannel: member.voice?.channel ?? null });
  const r = await controls.autoplay(bot.players.get(guild.id), { member }, genre, {
    create,
    onAccepted: async () => {
      await interaction.deferUpdate();
      await toAll(interaction, autoplayOn(genre, member), LIFETIME.result);
    },
  });
  if (!r.ok) return noticeSelf(interaction, controlMessage(r));
}

// 접두사가 재생 패널 버튼(panel:)보다 좁아 자동재생 버튼은 여기로 온다
const routes: Route[] = [route("button", customId(PANEL, "autoplay", ""), handleAutoplayButton), route("select", customId(AUTOPLAY, "genre"), handleAutoplayGenre)];

export { routes, answerAutoplay, handleAutoplayButton, handleAutoplayGenre };
