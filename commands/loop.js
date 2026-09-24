import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../config.ts";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";

const LOOP_TEXT = {
  track: ["🔂", "반복 모드가 **트랙 반복**으로 설정되었습니다. 현재 곡이 계속 재생됩니다."],
  queue: ["🔁", "반복 모드가 **대기열 반복**으로 설정되었습니다. 대기열이 끝나면 다시 시작됩니다."],
  false: ["➡️", "반복 모드가 이제 **꺼졌습니다**"],
};

const exported = {
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
    const mode = option ? (option === "off" ? false : option) : controls.nextLoopMode(player?.loop);
    const r = await controls.loop(player, { member }, mode);
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const [modeEmoji, modeMessage] = LOOP_TEXT[String(r.mode)];
    const embed = new EmbedBuilder()
      .setTitle(`${modeEmoji} 🔁 반복 모드 변경됨`)
      .setDescription(modeMessage)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 변경한 사람", value: `${member}`, inline: true });

    if (r.track?.thumbnail) embed.setThumbnail(r.track.thumbnail);

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};
export default exported;
export { exported as "module.exports" };
