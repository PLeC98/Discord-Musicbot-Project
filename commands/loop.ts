import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as controlText from "../src/ui/text/controls.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { colorOf } from "../src/ui/colors.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set loop mode")
    .setDescriptionLocalizations({ ko: "반복 모드를 설정합니다" })
    .addStringOption((option) => option.setName("mode").setDescription("Loop mode (omit to cycle: off → track → queue → off)").setDescriptionLocalizations({ ko: "반복 모드 (생략하면 off → track → queue 순으로 순환)" }).setRequired(false).addChoices({ name: "Off", value: "off" }, { name: "Track (repeat current)", value: "track" }, { name: "Queue (repeat all)", value: "queue" })),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const player = client.players.get(guild.id);
    const option = interaction.options.getString("mode");
    // 모드를 안 고르면 반복 버튼처럼 다음 모드로
    const mode = option ? (option === "off" ? false : option) : controls.nextLoopMode(player?.loop ?? false);
    const r = await controls.loop(player, { member }, mode);
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

    const t = controlText.loopSet(r.mode);
    const embed = new EmbedBuilder()
      .setTitle(t.title)
      .setDescription(t.description)
      .setColor(colorOf("brand"))
      .setTimestamp()
      .addFields({ name: t.by, value: `${member}`, inline: true });

    if (r.track?.thumbnail) embed.setThumbnail(r.track.thumbnail);

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
export default exported;
