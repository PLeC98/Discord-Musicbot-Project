import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import * as stay from "../../usecases/stay.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import * as replies from "../../ui/control-replies.ts";
import { reply } from "../../ui/frame.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, noticeSelf, toAll, toSelf } from "../../ui/delivery.ts";

// 24/7: 음성 채널에 머물기. 켜고 끄기는 토글이 아니라 고르게 한다(두 사람이 동시에 누르면 토글은 서로 되돌린다). 고르지 않으면 지금 상태
const exported: GuildCommand = {
  help: { section: "channel", tier: "moderator" },
  data: new SlashCommandBuilder()
    .setName("247")
    .setDescription("음성 채널에서 나가지 않고 계속 머물게 해요")
    .addStringOption((option) => option.setName("mode").setNameLocalizations({ ko: "모드" }).setDescription("켜거나 꺼요 (고르지 않으면 지금 상태를 보여 줘요)").setRequired(false).addChoices({ name: "켜기", value: "on" }, { name: "끄기", value: "off" }))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, bot) {
    const { guild, member, channel } = interaction;
    const mode = interaction.options.getString("mode");
    if (!mode) {
      const seat = stay.seatChannelOf(guild.id);
      return toSelf(interaction, reply(seat ? replies.stayOn(seat, true, member) : replies.stayOff(true, member)), LIFETIME.glance);
    }
    if (mode === "on") await interaction.deferReply();
    const r = mode === "on" ? await stay.turnOn(bot, { guild, member, textChannel: channel }) : stay.turnOff(bot, { guild, member });
    if (!r.ok) return noticeSelf(interaction, errors.notice(r.code));
    if (r.kind === "on") return toAll(interaction, replies.stayOn(r.channelId, r.already, member), LIFETIME.result);
    return toAll(interaction, replies.stayOff(r.already, member), LIFETIME.result);
  },
};
export default exported;
