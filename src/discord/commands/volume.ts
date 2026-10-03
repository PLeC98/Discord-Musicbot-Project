import { SlashCommandBuilder } from "discord.js";
import { answerVolume } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "mode", tier: "dj" },
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set the playback volume")
    .setDescriptionLocalizations({ ko: "볼륨을 설정해요" })
    .addIntegerOption((option) => option.setName("level").setNameLocalizations({ ko: "볼륨" }).setDescription("Volume level (0 ~ 100)").setDescriptionLocalizations({ ko: "설정할 볼륨 (0~100)" }).setRequired(true).setMinValue(0).setMaxValue(100)),

  async execute(interaction, bot) {
    await answerVolume(interaction, bot.players.get(interaction.guild.id), interaction.options.getInteger("level", true));
  },
};
export default exported;
