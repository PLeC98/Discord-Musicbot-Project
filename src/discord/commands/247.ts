import { SlashCommandBuilder, MessageFlags } from "discord.js";
import * as stay from "../../usecases/stay.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import * as replies from "../../ui/control-replies.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, noticeSelf, toAll } from "../../ui/delivery.ts";

// 상주 모드(24/7): 음성 채널에 머물기. 켜져 있으면 끄고, 꺼져 있으면 켠다. 지금 상태는 재생 패널의 상태 줄, 끝난 패널이 보인다
const exported: GuildCommand = {
  help: { section: "channel", tier: "dj" },
  data: new SlashCommandBuilder().setName("247").setDescription("상주 모드를 켜거나 꺼요. 켜면 음성 채널에서 나가지 않고 계속 머물러요"),

  async execute(interaction, bot) {
    const { guild, member, channel } = interaction;
    const on = stay.seatChannelOf(guild.id) === null;
    // 켜기는 음성 채널에 연결할 수 있어 몇 초 걸린다. 응답 유예(defer)는 본인에게만 보이게 한다(거절은 그 자리에 안내하고, 켬은 채널에 새로 보낸다)
    if (on) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const r = on ? await stay.turnOn(bot, { guild, member, textChannel: channel }) : await stay.turnOff(bot, { guild, member });
    if (!r.ok) return noticeSelf(interaction, errors.notice(r.code));
    if (r.kind === "on") return toAll(interaction, replies.stayOn(r.channelId, r.already, member), LIFETIME.result);
    return toAll(interaction, replies.stayOff(r.already, member), LIFETIME.result);
  },
};
export default exported;
