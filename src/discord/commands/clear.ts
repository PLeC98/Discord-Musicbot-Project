import { SlashCommandBuilder } from "discord.js";
import * as controls from "../../usecases/controls.ts";
import { controlMessage } from "../../ui/control-messages.ts";
import * as replies from "../../ui/control-replies.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, noticeSelf, toAll } from "../../ui/delivery.ts";

const exported: GuildCommand = {
  help: { section: "queue", tier: "dj" },
  data: new SlashCommandBuilder().setName("clear").setDescription("Clear the queue").setDescriptionLocalizations({ ko: "대기열을 비워요" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.clear(client.players.get(guild.id), { member });
    if (!r.ok) return noticeSelf(interaction, controlMessage(r));

    await toAll(interaction, replies.cleared(r.count, member), LIFETIME.result);
  },
};
export default exported;
