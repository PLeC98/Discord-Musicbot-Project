import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { formatDuration } from "../src/ui/format.ts";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as controlText from "../src/ui/text/controls.ts";
import * as labels from "../src/ui/text/labels.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { colorOf } from "../src/ui/colors.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("leave").setDescription("Leave the voice channel and save the current queue for later").setDescriptionLocalizations({ ko: "음성 채널에서 나가고 현재 대기열을 저장합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.leave(guild, { member }, client.players);
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

    // 플레이어는 없었지만 봇이 음성 채널에 남아 있었다(음악이 끝난 뒤 자동 퇴장 타이머가 아직 안 돌았다)
    if (r.left === "voice-only") return interaction.reply({ content: controlText.leftVoiceOnly(), flags: MessageFlags.Ephemeral });

    const t = controlText.left();
    const embed = new EmbedBuilder()
      .setTitle(t.title)
      .setColor(colorOf("brand"))
      .setTimestamp()
      .addFields({ name: t.by, value: `${member}`, inline: true });

    if (r.track) {
      embed.setDescription(`**[${r.track.title}](${r.track.pageUrl})**`).addFields({ name: t.position, value: `\`${formatDuration(r.saved.positionSec)}\``, inline: true }, { name: t.queue, value: labels.trackCount(r.saved.queue), inline: true });
    }

    embed.setFooter({ text: t.footer });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
export default exported;
