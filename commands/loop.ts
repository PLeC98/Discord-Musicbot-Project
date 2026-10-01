import { SlashCommandBuilder } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { answerLoop } from "../interactions/controlAnswers.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set loop mode")
    .setDescriptionLocalizations({ ko: "반복 모드를 설정합니다" })
    .addStringOption((option) => option.setName("mode").setDescription("Loop mode (omit to cycle: off → track → queue → off)").setDescriptionLocalizations({ ko: "반복 모드 (생략하면 off → track → queue 순으로 순환)" }).setRequired(false).addChoices({ name: "Off", value: "off" }, { name: "Track (repeat current)", value: "track" }, { name: "Queue (repeat all)", value: "queue" })),

  async execute(interaction, client) {
    const player = client.players.get(interaction.guild.id);
    const option = interaction.options.getString("mode");
    // 모드를 안 고르면 반복 버튼처럼 다음 모드로
    const mode = option ? (option === "off" ? false : option) : controls.nextLoopMode(player?.loop ?? false);
    await answerLoop(interaction, player, mode);
  },
};
export default exported;
