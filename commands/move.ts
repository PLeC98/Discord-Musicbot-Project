import { SlashCommandBuilder } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as replies from "../src/ui/controlReplies.ts";
import { noticeReply, reply } from "../src/ui/frame.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  help: { section: "queue", tier: "dj" },
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a track to a different position in the queue")
    .setDescriptionLocalizations({ ko: "대기열에서 곡 순서를 변경합니다" })
    .addIntegerOption((option) => option.setName("from").setNameLocalizations({ ko: "원래번호" }).setDescription("Current position of the track").setDescriptionLocalizations({ ko: "변경할 곡의 현재 위치" }).setRequired(true).setMinValue(1))
    .addIntegerOption((option) => option.setName("to").setNameLocalizations({ ko: "새번호" }).setDescription("New position for the track").setDescriptionLocalizations({ ko: "변경할 위치" }).setRequired(true).setMinValue(1)),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const from = interaction.options.getInteger("from", true);
    const to = interaction.options.getInteger("to", true);
    // 사람은 1부터 센다
    const r = await controls.move(client.players.get(guild.id), { member }, from - 1, to - 1);
    if (!r.ok) return interaction.reply(noticeReply(controlMessage(r)));

    await interaction.reply(reply(replies.moved(r.track, from, to, member)));
  },
};
export default exported;
