// 대시보드에서 한 조작의 결과를 패널이 있는 채널에 디스코드 조작과 같은 화면으로 보낸다. 바닥 줄은 "요청한 사람 @사람 (대시보드)".
// 알리지 못해도 조작의 HTTP 응답은 그대로다(남기기만 한다)

import type { ContainerBuilder } from "discord.js";
import type { Request } from "express";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { bestEffort } from "../infra/best-effort.ts";
import { canSend } from "../ui/channels.ts";
import { LIFETIME } from "../ui/delivery.ts";
import { post } from "../ui/frame.ts";
import { scheduleDelete } from "../ui/transient-messages.ts";
import * as controlText from "../ui/text/ko/controls.ts";
import { VOLUME_SETTLE_MS } from "../usecases/controls.ts";
import type { Player } from "../player/player.ts";
import type { NowPlayingPanel, Responder } from "../ui/now-playing-panel.ts";
import type { BotContext } from "../app/bot-context.ts";
import { signedIn } from "./middleware/require-auth.ts";

type Channel = Awaited<ReturnType<NowPlayingPanel["panelChannel"]>> | null;

/** 바닥 줄에 적는 사람. 대시보드에 로그인한 사람(봇 운영자도 디스코드 계정이다) */
const dashboardActor = (req: Request) => controlText.viaDashboard(`<@${signedIn(req).id}>`);

// 패널 채널을 찾는다. 못 찾으면 null(알리지 않는다)
function channelOf({ panels }: Pick<BotContext, "panels">, player: Player | null | undefined): Promise<Channel> {
  if (!player) return Promise.resolve(null);
  return panels.panelChannel(player).catch((error: unknown) => {
    log.debug("대시보드 조작 안내: 패널 채널을 찾지 못함:", error);
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
    bestEffort(log, sendTo(channel, view, ms), "대시보드 조작 안내");
  };
}

// 볼륨은 끄는 동안 잇달아 온다. 서버마다 처음 값을 들고 있다가 멈춘 뒤 한 번 알린다
const settling = new Map<string, { before: number; timer: NodeJS.Timeout }>();

/** 볼륨 안내. 멈춘 뒤 처음 값 → 마지막 값으로 show 를 부른다. 처음 값으로 돌아왔으면 알리지 않는다 */
function announceVolume(guildId: string, before: number, level: number, show: (before: number, level: number) => void) {
  const s = settling.get(guildId);
  const from = s?.before ?? before;
  clearTimeout(s?.timer);
  const timer = setTimeout(() => {
    settling.delete(guildId);
    if (from !== level) show(from, level);
  }, VOLUME_SETTLE_MS);
  timer.unref?.();
  settling.set(guildId, { before: from, timer });
}

/** 곡 넣기. 담은 안내를 패널 채널에 보낸다. 플레이어의 글자 채널은 코어가 곡을 넣으며 정하므로 보낼 때 찾는다 */
function dashboardResponder(bot: Pick<BotContext, "players" | "panels">, guildId: string): Responder {
  return {
    async notifyQueued(view: ContainerBuilder) {
      await sendTo(channelOf(bot, bot.players.get(guildId)), view, LIFETIME.glance).catch((error: unknown) => log.warn("대시보드 곡 넣기 안내 실패:", error));
    },
    async dismissPlaceholder() {
      /* 자리표시자를 띄우지 않았다 */
    },
  };
}

export { dashboardActor, announcer, announceVolume, dashboardResponder };
