import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import { noticeReply } from "../src/ui/frame.ts";
import * as controlText from "../src/ui/text/controls.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { colorOf } from "../src/ui/colors.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a track to a different position in the queue")
    .setDescriptionLocalizations({ ko: "대기열에서 곡 순서를 변경합니다" })
    .addIntegerOption((option) => option.setName("from").setDescription("Current position of the track").setDescriptionLocalizations({ ko: "변경할 곡의 현재 위치" }).setRequired(true).setMinValue(1))
    .addIntegerOption((option) => option.setName("to").setDescription("New position for the track").setDescriptionLocalizations({ ko: "변경할 위치" }).setRequired(true).setMinValue(1)),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const from = interaction.options.getInteger("from", true);
    const to = interaction.options.getInteger("to", true);
    // 사람은 1부터 센다
    const r = await controls.move(client.players.get(guild.id), { member }, from - 1, to - 1);
    if (!r.ok) return interaction.reply(noticeReply(controlMessage(r)));

    const t = controlText.moved(r.track, from, to);
    const embed = new EmbedBuilder()
      .setTitle(t.title)
      .setDescription(t.description)
      .setColor(colorOf("brand"))
      .setTimestamp()
      .addFields({ name: t.from, value: t.fromValue, inline: true }, { name: t.to, value: t.toValue, inline: true }, { name: t.by, value: `${member}`, inline: true });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
export default exported;
