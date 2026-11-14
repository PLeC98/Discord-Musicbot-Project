import { SlashCommandBuilder } from "discord.js";
import * as normalize from "../../usecases/normalize.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import * as settingsText from "../../ui/text/ko/settings.ts";
import * as replies from "../../ui/control-replies.ts";
import * as screens from "../../ui/settings-screens.ts";
import { reply } from "../../ui/frame.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, noticeSelf, toAll, toSelf } from "../../ui/delivery.ts";

// 볼륨 정규화: 서버의 설정이라 봇이 음성 채널에 없어도 바꿀 수 있다. 동작을 비우면 지금 상태를 본인에게만 보여 준다(누구나)
const exported: GuildCommand = {
  help: { section: "mode", tier: "dj" },
  data: new SlashCommandBuilder()
    .setName("normalize")
    .setDescription("볼륨 정규화를 켜거나 꺼요")
    .addStringOption((option) => option.setName("action").setNameLocalizations({ ko: "동작" }).setDescription("켜기 또는 끄기 (비우면 지금 상태 표시)").addChoices({ name: "켜기", value: "on" }, { name: "끄기", value: "off" }).setRequired(false)),

  async execute(interaction) {
    const { guild, member } = interaction;
    const action = interaction.options.getString("action");
    if (!action) return toSelf(interaction, reply(screens.shown(settingsText.normalizeNow(normalize.normalizeOn(guild.id)))), LIFETIME.glance);
    const r = await normalize.setNormalize({ guild, member }, action === "on");
    if (!r.ok) return noticeSelf(interaction, errors.notice(r.code));
    return toAll(interaction, replies.normalizeSet(r.on, r.already, member), LIFETIME.result);
  },
};
export default exported;
