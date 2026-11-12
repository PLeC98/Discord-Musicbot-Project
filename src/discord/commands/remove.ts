import { SlashCommandBuilder } from "discord.js";
import * as controls from "../../usecases/controls.ts";
import { controlMessage } from "../../ui/control-messages.ts";
import * as replies from "../../ui/control-replies.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, noticeSelf, toAll } from "../../ui/delivery.ts";

const exported: GuildCommand = {
  help: { section: "queue", tier: "dj-or-requester" },
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("대기열에서 곡이나 구간을 빼요")
    .addIntegerOption((option) => option.setName("position").setNameLocalizations({ ko: "번호" }).setDescription("대기열 순번 (1 = 다음 곡)").setRequired(true).setMinValue(1))
    .addIntegerOption((option) => option.setName("end").setNameLocalizations({ ko: "끝번호" }).setDescription("여기까지 함께 빼요 (비우면 한 곡)").setMinValue(1)),

  async execute(interaction, bot) {
    const { guild, member } = interaction;
    // 사람은 1부터 센다
    const position = interaction.options.getInteger("position", true) - 1;
    const end = interaction.options.getInteger("end");
    const r = await controls.remove(bot.players.get(guild.id), { member }, position, end === null ? position : end - 1);
    if (!r.ok) return noticeSelf(interaction, controlMessage(r));

    await toAll(interaction, replies.removed(r.removed.length, r.left, member), LIFETIME.result);
  },
};
export default exported;
