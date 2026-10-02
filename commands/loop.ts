import { SlashCommandBuilder } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { answerLoop } from "../interactions/controlAnswers.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set loop mode")
    .setDescriptionLocalizations({ ko: "반복 모드를 설정해요" })
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Loop mode (omit to cycle: off → track → queue → off)")
        .setDescriptionLocalizations({ ko: "반복 모드 (모드를 정하지 않으면 차례로 순환해요: 끔 → 한 곡 반복 → 대기열 반복)" })
        .setRequired(false)
        .addChoices({ name: "Off", name_localizations: { ko: "끔" }, value: "off" }, { name: "Track (repeat current)", name_localizations: { ko: "한 곡 반복" }, value: "track" }, { name: "Queue (repeat all)", name_localizations: { ko: "대기열 반복" }, value: "queue" }),
    ),

  async execute(interaction, client) {
    const player = client.players.get(interaction.guild.id);
    const option = interaction.options.getString("mode");
    // 모드를 안 고르면 반복 버튼처럼 다음 모드로
    const mode = option ? (option === "off" ? false : option) : controls.nextLoopMode(player?.loop ?? false);
    await answerLoop(interaction, player, mode);
  },
};
export default exported;
