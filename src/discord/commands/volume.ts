import { SlashCommandBuilder } from "discord.js";
import { answerVolume } from "../interactions/control-answers.ts";
import { VOLUME_MAX } from "../../rules/limits.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "mode", tier: "dj" },
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set the playback volume")
    .setDescriptionLocalizations({ ko: "볼륨을 설정해요" })
    .addIntegerOption((option) =>
      option
        .setName("level")
        .setNameLocalizations({ ko: "볼륨" })
        .setDescription(`Volume level (0 ~ ${VOLUME_MAX})`)
        .setDescriptionLocalizations({ ko: `설정할 볼륨 (0~${VOLUME_MAX})` })
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(VOLUME_MAX),
    ),

  async execute(interaction, bot) {
    await answerVolume(interaction, bot.players.get(interaction.guild.id), interaction.options.getInteger("level", true));
  },
};
export default exported;
