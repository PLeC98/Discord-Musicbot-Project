import { SlashCommandBuilder } from "discord.js";
import { nextLoopMode } from "../../rules/loop-cycle.ts";
import { answerLoop } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "mode", tier: "dj" },
  name: "loop",
  data: (C) =>
    new SlashCommandBuilder()
      .setName("loop")
      .setDescription(C.loop.description)
      .addStringOption((option) => option.setName("mode").setDescription(C.loop.options.mode.description).setRequired(false).addChoices({ name: C.loop.options.mode.choices.off, value: "off" }, { name: C.loop.options.mode.choices.track, value: "track" }, { name: C.loop.options.mode.choices.queue, value: "queue" })),

  async execute(interaction, bot) {
    const player = bot.players.get(interaction.guild.id);
    const option = interaction.options.getString("mode");
    // 모드를 선택하지 않으면 반복 버튼처럼 다음 모드로
    const mode = option ? (option === "off" ? false : option) : nextLoopMode(player?.loop ?? false);
    await answerLoop(interaction, player, mode);
  },
};
export default exported;
