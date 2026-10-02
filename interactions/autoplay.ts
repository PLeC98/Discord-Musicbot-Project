// 자동재생 입구: /autoplay 와 패널의 자동재생 버튼이 같은 절차(answerAutoplay)를 쓰고, 장르 메뉴에서 고른 것을 받는다.
// 켜기 · 끄기 · 권한 · 플레이어 만들기는 usecases/controls 의 autoplay 가 한다

import { type ButtonInteraction, type RepliableInteraction, type StringSelectMenuInteraction } from "discord.js";
import * as errors from "../src/ui/text/ko/errors.ts";
import { noticeReply } from "../src/ui/frame.ts";
import * as controls from "../src/usecases/controls.ts";
import { ensurePlayer } from "../src/usecases/addTracks.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import { buildGenreMenu, buildAutoplayOffMenu, autoplayOn, OFF_MENU_MS } from "../src/ui/genreMenu.ts";
import { keepReply, expireReply } from "../src/ui/replyLifetime.ts";
import { PANEL, AUTOPLAY, IDLE_SESSION, customId, partsOf } from "../src/ui/customIds.ts";
import { route, type Route } from "./route.ts";
import type { Player } from "../src/player/Player.ts";

/**
 * 켜져 있으면 끄고 30초 동안 장르를 다시 고를 기회를 준다(고르면 변경, 두면 종료).
 * 꺼져 있으면 장르 메뉴를 띄운다. 고르는 동안 떠 있어야 한다. 플레이어가 없어도 띄운다(고른 뒤에 만든다)
 */
async function answerAutoplay(interaction: RepliableInteraction<"cached">, player: Player | undefined) {
  const actor = { member: interaction.member };
  if (player?.autoplay) {
    expireReply(interaction, OFF_MENU_MS);
    const r = await controls.autoplay(player, actor, false, { onAccepted: () => interaction.reply(buildAutoplayOffMenu()) });
    if (!r.ok) return interaction.reply(noticeReply(controlMessage(r)));
    return;
  }
  const blocked = await controls.autoplayBlocked(actor);
  if (blocked) return interaction.reply(noticeReply(controlMessage(blocked)));
  keepReply(interaction);
  return interaction.reply(buildGenreMenu());
}

// 끝난 패널 · 재생 중 패널 양쪽에서 온다. 재생 중 패널의 버튼은 다른 패널 버튼처럼 패널의 세션이 지금 세션이어야 한다.
// 끝난 패널의 버튼(idle)은 세션이 없어 어느 플레이어에도 통한다(/join 뒤 · 대기열이 끝나 기다리는 동안에도 플레이어가 있다). /autoplay 와 같다
async function handleAutoplayButton(interaction: ButtonInteraction<"cached">) {
  const player = interaction.client.players.get(interaction.guild.id);
  const sessionId = partsOf(interaction.customId).rest[0];
  if (player && sessionId && sessionId !== IDLE_SESSION && player.sessionId && sessionId !== player.sessionId) return interaction.reply(noticeReply(errors.staleSession()));
  return answerAutoplay(interaction, player);
}

// 장르 메뉴에서 골랐다. 메뉴를 결과로 덮는다. reply 로 새 메시지를 만들면 고른 뒤에도 선택 화면이 남는다.
// update 는 ephemeral 을 기록하지 않아 정리에서 빠지므로, 지우라고 선언해 둔다
async function handleAutoplayGenre(interaction: StringSelectMenuInteraction<"cached">) {
  const { guild, member, client } = interaction;
  const genre = interaction.values[0];
  const create = () => ensurePlayer(client, { guild, textChannel: interaction.channel, voiceChannel: member.voice?.channel ?? null });
  const r = await controls.autoplay(client.players.get(guild.id), { member }, genre, {
    create,
    onAccepted: () => {
      expireReply(interaction);
      return interaction.update(autoplayOn(genre, member));
    },
  });
  if (!r.ok) return interaction.reply(noticeReply(controlMessage(r)));
}

// 앞머리가 재생 패널 버튼(panel:)보다 좁아 자동재생 버튼은 여기로 온다
const routes: Route[] = [route("button", customId(PANEL, "autoplay", ""), handleAutoplayButton), route("select", customId(AUTOPLAY, "genre"), handleAutoplayGenre)];

export { routes, answerAutoplay, handleAutoplayButton, handleAutoplayGenre };
