import { SlashCommandBuilder } from "discord.js";
import { answerSkip } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { checkSkip } from "../../usecases/permissions.ts";

const exported: GuildCommand = {
  // 지금 곡을 넣은 사람도 된다(실행과 같은 checkSkip)
  help: { section: "play", tier: "dj-or-requester", gate: (member, { player }) => checkSkip(member, player) },
  data: new SlashCommandBuilder().setName("skip").setDescription("현재 재생 중인 곡을 건너뛰어요"),

  async execute(interaction, bot) {
    await answerSkip(interaction, bot.players.get(interaction.guild.id));
  },
};
export default exported;
