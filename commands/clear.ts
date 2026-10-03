import { SlashCommandBuilder } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as replies from "../src/ui/controlReplies.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { LIFETIME, noticeSelf, toAll } from "../src/ui/delivery.ts";

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
