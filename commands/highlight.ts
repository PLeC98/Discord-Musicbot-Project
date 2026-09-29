import { formatMs } from "../src/ui/format.ts";
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { colorOf } from "../src/ui/colors.ts";

// SponsorBlock poi_highlight(커뮤니티 하이라이트 지점)로 점프. 핵심만 듣고 /skip 하는 용도.
const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("highlight").setDescription("Jump to the community highlight of the current track").setDescriptionLocalizations({ ko: "현재 곡의 하이라이트 지점으로 이동합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.highlight(client.players.get(guild.id), { member }, { onAccepted: () => interaction.deferReply({ flags: MessageFlags.Ephemeral }) });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

    const embed = new EmbedBuilder()
      .setTitle("✨ 하이라이트로 이동")
      .setDescription(`**[${r.track.title}](${r.track.pageUrl})**`)
      .setColor(colorOf("brand"))
      .setTimestamp()
      .addFields({ name: "⏱️ 위치", value: `\`${formatMs(r.ms)}\``, inline: true });

    await interaction.editReply({ embeds: [embed] });
  },
};
export default exported;
