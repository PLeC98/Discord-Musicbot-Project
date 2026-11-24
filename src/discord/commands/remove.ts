import { SlashCommandBuilder } from "discord.js";
import * as controls from "../../usecases/controls.ts";
import { controlMessage } from "../../ui/control-messages.ts";
import * as replies from "../../ui/control-replies.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, noticeSelf, toAll } from "../../ui/delivery.ts";
import { privateText, publicText } from "../../ui/language.ts";

const exported: GuildCommand = {
  help: { section: "queue", tier: "dj-or-requester" },
  name: "remove",
  data: (C) =>
    new SlashCommandBuilder()
      .setName("remove")
      .setDescription(C.remove.description)
      .addIntegerOption((option) => option.setName("position").setDescription(C.remove.options.position.description).setRequired(true).setMinValue(1))
      .addIntegerOption((option) => option.setName("end").setDescription(C.remove.options.end.description).setMinValue(1)),

  async execute(interaction, bot) {
    const { guild, member } = interaction;
    // 사람은 1부터 센다
    const position = interaction.options.getInteger("position", true) - 1;
    const end = interaction.options.getInteger("end");
    const r = await controls.remove(bot.players.get(guild.id), { member }, position, end === null ? position : end - 1);
    if (!r.ok) return noticeSelf(interaction, controlMessage(privateText(interaction), r));

    await toAll(interaction, replies.removed(publicText(interaction.guildId), r.removed.length, r.left, member), LIFETIME.result);
  },
};
export default exported;
