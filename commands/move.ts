import { SlashCommandBuilder } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as replies from "../src/ui/controlReplies.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { LIFETIME, noticeSelf, toAll } from "../src/ui/delivery.ts";

const exported: GuildCommand = {
  help: { section: "queue", tier: "dj" },
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a track to a different position in the queue")
    .setDescriptionLocalizations({ ko: "대기열에서 곡의 순번을 옮겨요" })
    .addIntegerOption((option) => option.setName("from").setNameLocalizations({ ko: "옮길곡" }).setDescription("Current position of the track").setDescriptionLocalizations({ ko: "순서를 옮기고 싶은 곡" }).setRequired(true).setMinValue(1))
    .addIntegerOption((option) => option.setName("to").setNameLocalizations({ ko: "옮길위치" }).setDescription("New position for the track").setDescriptionLocalizations({ ko: "그 곡을 옮겨 넣을 위치" }).setRequired(true).setMinValue(1)),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const from = interaction.options.getInteger("from", true);
    const to = interaction.options.getInteger("to", true);
    // 사람은 1부터 센다
    const r = await controls.move(client.players.get(guild.id), { member }, from - 1, to - 1);
    if (!r.ok) return noticeSelf(interaction, controlMessage(r));

    await toAll(interaction, replies.moved(r.track, from, to, member), LIFETIME.result);
  },
};
export default exported;
