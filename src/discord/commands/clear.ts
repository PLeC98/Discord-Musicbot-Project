import { SlashCommandBuilder } from "discord.js";
import * as controls from "../../usecases/controls.ts";
import { controlMessage } from "../../ui/control-messages.ts";
import * as replies from "../../ui/control-replies.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, noticeSelf, toAll } from "../../ui/delivery.ts";
import { privateText, publicText } from "../../ui/language.ts";

const exported: GuildCommand = {
  help: { section: "queue", tier: "dj" },
  name: "clear",
  data: (C) => new SlashCommandBuilder().setName("clear").setDescription(C.clear.description),

  async execute(interaction, bot) {
    const { guild, member } = interaction;
    const r = await controls.clear(bot.players.get(guild.id), { member });
    if (!r.ok) return noticeSelf(interaction, controlMessage(privateText(interaction), r));

    await toAll(interaction, replies.cleared(publicText(interaction.guildId), r.count, member), LIFETIME.result);
  },
};
export default exported;
