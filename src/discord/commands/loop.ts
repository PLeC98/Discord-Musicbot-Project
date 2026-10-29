import { SlashCommandBuilder } from "discord.js";
import { nextLoopMode } from "../../rules/loop-cycle.ts";
import { answerLoop } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "mode", tier: "dj" },
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("반복 모드를 설정해요")
    .addStringOption((option) => option.setName("mode").setNameLocalizations({ ko: "모드" }).setDescription("반복 모드 (모드를 정하지 않으면 순서대로 순환해요: 끔 → 한 곡 반복 → 대기열 반복)").setRequired(false).addChoices({ name: "끔", value: "off" }, { name: "한 곡 반복", value: "track" }, { name: "대기열 반복", value: "queue" })),

  async execute(interaction, bot) {
    const player = bot.players.get(interaction.guild.id);
    const option = interaction.options.getString("mode");
    // 모드를 선택하지 않으면 반복 버튼처럼 다음 모드로
    const mode = option ? (option === "off" ? false : option) : nextLoopMode(player?.loop ?? false);
    await answerLoop(interaction, player, mode);
  },
};
export default exported;
