import { SlashCommandBuilder } from "discord.js";
import * as controls from "../../usecases/controls.ts";
import { controlMessage } from "../../ui/control-messages.ts";
import * as replies from "../../ui/control-replies.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, noticeSelf, toAll } from "../../ui/delivery.ts";
import { privateText, publicText } from "../../ui/language.ts";

const exported: GuildCommand = {
  help: { section: "queue", tier: "dj" },
  name: "move",
  data: (C) =>
    new SlashCommandBuilder()
      .setName("move")
      .setDescription(C.move.description)
      .addIntegerOption((option) => option.setName("from").setDescription(C.move.options.from.description).setRequired(true).setMinValue(1))
      .addIntegerOption((option) => option.setName("to").setDescription(C.move.options.to.description).setRequired(true).setMinValue(1)),

  async execute(interaction, bot) {
    const { guild, member } = interaction;
    const from = interaction.options.getInteger("from", true);
    const to = interaction.options.getInteger("to", true);
    // 사람은 1부터 센다
    const r = await controls.move(bot.players.get(guild.id), { member }, from - 1, to - 1);
    if (!r.ok) return noticeSelf(interaction, controlMessage(privateText(interaction), r));

    await toAll(interaction, replies.moved(publicText(interaction.guildId), r.track, from, to, member), LIFETIME.result);
  },
};
export default exported;
