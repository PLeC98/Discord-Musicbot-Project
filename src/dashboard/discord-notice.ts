// 대시보드에서 한 조작의 결과를 패널이 있는 채널에 디스코드 조작과 같은 화면으로 보낸다. 푸터는 "요청한 사람 @사람 (대시보드)".
// 알리지 못해도 조작의 HTTP 응답은 그대로다(남기기만 한다). 다시 시작 공지(restartNotices)는 종료 절차가 기다린다

import type { ContainerBuilder } from "discord.js";
import type { Request } from "express";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { bestEffort } from "../infra/best-effort.ts";
import { canSend } from "../ui/channels.ts";
import { LIFETIME } from "../ui/delivery.ts";
import { EmbedBuilder } from "discord.js";
import { post } from "../ui/frame.ts";
import { icon } from "../ui/icons.ts";
import { ANNOUNCE_STYLE, type AnnounceKind } from "./contract/admin.ts";
import { playState } from "../ui/player-status.ts";
import { messageOf } from "../rules/error-kind.ts";
import { scheduleDelete } from "../ui/transient-messages.ts";
import type { Player } from "../player/player.ts";
import type { DrawAdded, NowPlayingPanel, Responder } from "../ui/now-playing-panel.ts";
import type { BotContext } from "../app/bot-context.ts";
import { signedIn } from "./middleware/require-auth.ts";
import { publicText } from "../ui/language.ts";
import type { BotText } from "../ui/text/index.ts";
import type { SharedText } from "../ui/text/shared.ts";

type Channel = Awaited<ReturnType<NowPlayingPanel["panelChannel"]>> | null;

/** 푸터에 적는 사람. 대시보드에 로그인한 사람(봇 운영자도 디스코드 계정이다). T는 알릴 서버의 문구표 */
const dashboardActor = (req: Request, T: BotText) => T.controls.viaDashboard(`<@${signedIn(req).id}>`);

// 패널 채널을 찾는다. 못 찾으면 null(알리지 않는다)
function channelOf({ panels }: Pick<BotContext, "panels">, player: Player | null | undefined): Promise<Channel> {
  if (!player) return Promise.resolve(null);
  return panels.panelChannel(player).catch((error: unknown) => {
    log.warn("대시보드 조작 알림 전송 실패(패널 채널을 찾지 못함):", error);
    return null;
  });
}

async function sendTo(channel: Promise<Channel>, view: ContainerBuilder, ms: number) {
  const target = await channel;
  if (!canSend(target)) return;
  scheduleDelete(await target.send(post(view)), ms);
}

/** 이 플레이어의 패널 채널에 알리는 함수. 채널은 지금 찾아 둔다(정지는 조작 뒤에 플레이어가 없다) */
function announcer(bot: Pick<BotContext, "panels">, player: Player | null | undefined) {
  const channel = channelOf(bot, player);
  return (view: ContainerBuilder, ms: number = LIFETIME.result) => {
    bestEffort(log, sendTo(channel, view, ms), "대시보드 조작 안내", "warn");
  };
}

/** 곡 넣기. 담은 안내를 패널 채널에 보낸다. 플레이어의 텍스트 채널은 코어가 곡을 넣으며 정하므로 보낼 때 찾는다 */
function dashboardResponder(bot: Pick<BotContext, "players" | "panels">, guildId: string): Responder {
  return {
    async notifyQueued(draw: DrawAdded) {
      await sendTo(channelOf(bot, bot.players.get(guildId)), draw(publicText(guildId)), LIFETIME.glance).catch((error: unknown) => log.warn("대시보드 곡 추가 알림 전송 실패:", error));
    },
    async dismissPlaceholder() {
      /* 대시보드는 자리표시자 메시지를 보내지 않아 지울 것이 없다 */
    },
  };
}

/** 봇 운영자의 공지 임베드(서버 관리의 공지 보내기와 다시 시작 공지가 같이 쓴다): 종류의 아이콘, 색, 제목(주지 않으면 종류의 제목), 본문, 보낸 때, 바닥글(보낸 사람) */
function announceEmbed(T: SharedText, kind: AnnounceKind, body: string, title: string = T.announce.titles[kind]) {
  const style = ANNOUNCE_STYLE[kind];
  return new EmbedBuilder()
    .setTitle(`${icon(style.icon)} ${title}`)
    .setDescription(body)
    .setColor(style.color)
    .setTimestamp()
    .setFooter({ text: T.announce.footer });
}

/**
 * 다시 시작 공지: 재생 중인 서버(봇 상태 탭의 "재생 중"과 같은 판정)마다 패널 채널에 점검 공지 모양의 안내를 보내기 시작하고 그 끝을 돌려준다.
 * 보냈으면 true, 보낼 채널이 없거나 실패하면 false(거절하지 않는다). 지우지 않는다(지우는 타이머는 프로세스와 함께 사라진다)
 */
function restartNotices(bot: Pick<BotContext, "players" | "panels">): Promise<boolean>[] {
  return [...bot.players.values()]
    .filter((player) => playState(player) === "playing")
    .map(async (player) => {
      try {
        const channel = await bot.panels.panelChannel(player);
        if (!canSend(channel)) return false;
        // 문구는 서버마다 그 서버의 언어로 그린다
        const T = publicText(player.guild?.id);
        const { title, body } = T.announce.restarting();
        await channel.send({ embeds: [announceEmbed(T, "maintenance", body, title)] });
        return true;
      } catch (error) {
        log.warn(`다시 시작 공지 전송 실패(${player.guild.name}): ${messageOf(error)}`);
        return false;
      }
    });
}

export { dashboardActor, announcer, dashboardResponder, announceEmbed, restartNotices };
