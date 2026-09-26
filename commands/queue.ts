import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../config.ts";
import * as S from "../src/ui/strings.ts";
import { queueDescription } from "../src/ui/queueDisplay.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const PAGE_SIZE = 10;

const exported: GuildCommand = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the play queue")
    .setDescriptionLocalizations({ ko: "대기열을 표시합니다" })
    .addIntegerOption((option) => option.setName("page").setDescription("Page number (default: 1)").setDescriptionLocalizations({ ko: "페이지 번호 (기본값: 1)" }).setRequired(false).setMinValue(1)),

  async execute(interaction, client) {
    const { guild } = interaction;

    const player = client.players.get(guild.id);
    if (!player) {
      return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });
    }

    const queueInfo = player.getQueue();

    if (!queueInfo.current && queueInfo.queue.length === 0) {
      return interaction.reply({ content: S.ERR_NO_SONGS_IN_QUEUE, flags: [1 << 6] });
    }

    const totalQueueTracks = queueInfo.queue.length;
    const totalPages = Math.max(1, Math.ceil(totalQueueTracks / PAGE_SIZE));
    const page = Math.min(interaction.options.getInteger("page") ?? 1, totalPages);
    const offset = (page - 1) * PAGE_SIZE;

    const embed = new EmbedBuilder().setTitle("📝 재생 대기열").setColor(config.bot.embedColor).setTimestamp();

    embed.setDescription(queueDescription({ current: page === 1 ? queueInfo.current : null, header: `📋 다음 노래들 (${totalQueueTracks}개)`, tracks: queueInfo.queue.slice(offset, offset + PAGE_SIZE), first: offset + 1 }));

    embed.setFooter({
      text: `총 ${totalQueueTracks + (queueInfo.current ? 1 : 0)}개의 노래${totalPages > 1 ? ` • ${page}/${totalPages} 페이지` : ""}`,
    });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};
export default exported;
