// /queue: 다음 곡들을 본인에게만 보인다(ui/queue-view). 재생 패널의 대기열 버튼도 같은 화면을 연다(openQueue).
// 보기 화면의 썸네일 모자이크는 칸 이미지를 받아(ui/queue-mosaic/thumbnails) 그리기 워커가 그린다. 기다리는 것은 WAIT 까지이고,
// 늦으면 이미지 없이 보내고 나중에 붙이지 않는다(받은 칸 이미지는 기억해 두어 다음 화면에 쓴다). 첫 응답은 미루면 Components V2로 바꿀 수 없어 기다린 뒤 바로 답한다

import { SlashCommandBuilder, type GuildMember, type RepliableInteraction } from "discord.js";
import type { GuildCommand } from "../../app/command-loader.ts";
import type { Player } from "../../player/player.ts";
import { renderQueueMosaic } from "../../ui/card-render/render.ts";
import { colorOf } from "../../ui/colors.ts";
import { LIFETIME, noticeSelf, toSelf } from "../../ui/delivery.ts";
import { reply } from "../../ui/frame.ts";
import { cellImagesOf } from "../../ui/queue-mosaic/thumbnails.ts";
import { pageTracks, queueInfoOf, queueView, type QueueInfo, type Screen } from "../../ui/queue-view.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import logger from "../../infra/log/logger.ts";
import { isDj } from "../../usecases/permissions.ts";

const log = logger.child({ category: "commands" });

/** 썸네일 모자이크를 기다리는 시간: 첫 응답(3초 안에 답해야 한다), 보던 화면 고치기(미룬 뒤라 여유가 있다) */
const WAIT = { open: 1200, turn: 2500 } as const;

/** 그 페이지의 썸네일 모자이크. 칸 이미지가 하나도 없거나, 그리지 못했거나, waitMs 안에 끝나지 않으면 null */
async function mosaicOf(info: QueueInfo, page: number, waitMs: number): Promise<Buffer | null> {
  const { offset, tracks } = pageTracks(info, page);
  const drawing = cellImagesOf(tracks)
    .then((jpegs) => (jpegs.some(Boolean) ? renderQueueMosaic({ seed: colorOf("brand"), cells: jpegs.map((jpeg, i) => ({ number: offset + i + 1, jpeg })) }) : null))
    .catch(() => null);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>(
    (resolve) =>
      (timer = setTimeout(() => {
        log.debug(`/queue 썸네일 대기 시간 초과(이미지 없이 출력): ${waitMs}ms`);
        resolve(null);
      }, waitMs)),
  );
  try {
    return await Promise.race([drawing, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** 지금 대기열로 그린, member가 볼 화면(역할로 버튼을 고른다). 보기 화면이면 모자이크를 waitMs까지 기다린다. without은 뺄 곡(queueInfoOf) */
async function queueScreen(player: Player, member: GuildMember, screen: Screen, { waitMs = WAIT.turn, without = null }: { waitMs?: number; without?: number | null } = {}) {
  const info = queueInfoOf(player, { without, viewer: { id: member.id, dj: await isDj(member) } });
  const mosaic = screen.mode === "browse" ? await mosaicOf(info, screen.page, waitMs) : null;
  return queueView(info, screen.mode === "browse" ? { ...screen, mosaic } : screen);
}

/** 대기열 보기 화면을 본인에게 연다. 대기열이 비었으면 그렇다고 알린다 */
async function openQueue(interaction: RepliableInteraction<"cached">, player: Player, page = 1) {
  if (player.queue.length === 0) return noticeSelf(interaction, errors.notice("queue-empty"));
  const { view, files } = await queueScreen(player, interaction.member, { mode: "browse", page }, { waitMs: WAIT.open });
  await toSelf(interaction, reply(view, files), LIFETIME.screen);
}

const exported: GuildCommand = {
  help: { section: "queue", tier: "everyone" },
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("대기열을 보여줘요")
    .addIntegerOption((option) => option.setName("page").setNameLocalizations({ ko: "페이지" }).setDescription("페이지 번호 (기본값: 1)").setRequired(false).setMinValue(1)),

  async execute(interaction, bot) {
    const player = bot.players.get(interaction.guild.id);
    if (!player) return noticeSelf(interaction, errors.notice("no-song"));
    await openQueue(interaction, player, interaction.options.getInteger("page") ?? 1);
  },
};
export default exported;
export { queueScreen, openQueue, WAIT };
