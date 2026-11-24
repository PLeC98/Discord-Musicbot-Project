import { SlashCommandBuilder } from "discord.js";
import * as normalize from "../../usecases/normalize.ts";
import * as replies from "../../ui/control-replies.ts";
import * as screens from "../../ui/settings-screens.ts";
import { reply } from "../../ui/frame.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, noticeSelf, toAll, toSelf } from "../../ui/delivery.ts";
import { privateText, publicText } from "../../ui/language.ts";

// 볼륨 정규화: 서버의 설정이라 봇이 음성 채널에 없어도 바꿀 수 있다. 동작을 비우면 지금 상태를 본인에게만 보여 준다(누구나)
const exported: GuildCommand = {
  help: { section: "mode", tier: "dj" },
  name: "normalize",
  data: (C) =>
    new SlashCommandBuilder()
      .setName("normalize")
      .setDescription(C.normalize.description)
      .addStringOption((option) => option.setName("action").setDescription(C.normalize.options.action.description).addChoices({ name: C.normalize.options.action.choices.on, value: "on" }, { name: C.normalize.options.action.choices.off, value: "off" }).setRequired(false)),

  async execute(interaction) {
    const { guild, member } = interaction;
    const action = interaction.options.getString("action");
    if (!action) return toSelf(interaction, reply(screens.shown(privateText(interaction).settings.normalizeNow(normalize.normalizeOn(guild.id)))), LIFETIME.glance);
    const r = await normalize.setNormalize({ guild, member }, action === "on");
    if (!r.ok) return noticeSelf(interaction, privateText(interaction).errors.notice(r.code));
    return toAll(interaction, replies.normalizeSet(publicText(interaction.guildId), r.on, r.already, member), LIFETIME.result);
  },
};
export default exported;
