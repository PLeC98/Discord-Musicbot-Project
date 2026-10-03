import { SlashCommandBuilder } from "discord.js";
import * as errors from "../src/ui/text/ko/errors.ts";
import { queueView, queueInfoOf } from "../src/ui/queueView.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { LIFETIME, noticeSelf, selfOnly, toSelf } from "../src/ui/delivery.ts";

const exported: GuildCommand = {
  help: { section: "queue", tier: "everyone" },
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the play queue")
    .setDescriptionLocalizations({ ko: "대기열을 보여줘요" })
    .addIntegerOption((option) => option.setName("page").setNameLocalizations({ ko: "페이지" }).setDescription("Page number (default: 1)").setDescriptionLocalizations({ ko: "페이지 번호 (기본값: 1)" }).setRequired(false).setMinValue(1)),

  async execute(interaction, client) {
    const { guild } = interaction;

    const player = client.players.get(guild.id);
    if (!player) {
      return noticeSelf(interaction, errors.notice("no-song"));
    }

    const queueInfo = queueInfoOf(player);

    if (queueInfo.queue.length === 0) {
      return noticeSelf(interaction, errors.notice("queue-empty"));
    }

    await toSelf(interaction, selfOnly(queueView(queueInfo, interaction.options.getInteger("page") ?? 1)), LIFETIME.screen);
  },
};
export default exported;
