// /invite: 봇 초대 링크와 웹사이트(운영자가 적었으면). 운영 조절값 INVITE_COMMAND_ENABLED 로 끄면 등록에서 빠진다

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from "discord.js";
import config from "../../config/index.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { frame, reply } from "../../ui/frame.ts";
import { buttonEmoji } from "../../ui/icons.ts";
import { LIFETIME, toSelf } from "../../ui/delivery.ts";
import * as inviteText from "../../ui/text/ko/invite.ts";

/** 초대 화면. website 가 없으면 초대 버튼 하나 */
function inviteView({ invite, website }: { invite: string; website: string | null }) {
  const t = inviteText.invite();
  const container = frame({ icon: "invite", title: t.title, body: t.body });
  const buttons = [new ButtonBuilder().setLabel(t.buttons.invite).setEmoji(buttonEmoji("invite")).setURL(invite).setStyle(ButtonStyle.Link)];
  if (website) buttons.push(new ButtonBuilder().setLabel(t.buttons.website).setEmoji(buttonEmoji("web")).setURL(website).setStyle(ButtonStyle.Link));
  return container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons));
}

const exported: GuildCommand = {
  help: { section: "info", tier: "everyone" },
  enabled: () => config.bot.inviteCommand,
  data: new SlashCommandBuilder().setName("invite").setDescription("봇 초대 링크를 보여줘요"),

  async execute(interaction) {
    await toSelf(interaction, reply(inviteView({ invite: config.bot.invite, website: config.bot.website })), LIFETIME.screen);
  },
};
export default exported;
export { inviteView };
