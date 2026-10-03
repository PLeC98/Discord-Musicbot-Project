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
    .setDescription("Remove a specific track from the queue")
    .setDescriptionLocalizations({ ko: "대기열에서 선택한 곡을 빼요" })
    .addIntegerOption((option) => option.setName("position").setNameLocalizations({ ko: "번호" }).setDescription("Position in queue (e.g. 1 = next song)").setDescriptionLocalizations({ ko: "대기열 순번 (1 = 다음 곡)" }).setRequired(true).setMinValue(1)),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    // 사람은 1부터 센다
    const r = await controls.remove(client.players.get(guild.id), { member }, interaction.options.getInteger("position", true) - 1);
    if (!r.ok) return noticeSelf(interaction, controlMessage(r));

    await toAll(interaction, replies.removed(r.left, member), LIFETIME.result);
  },
};
export default exported;
