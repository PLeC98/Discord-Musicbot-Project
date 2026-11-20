// /invite: 봇 초대 링크와 웹사이트(운영자가 적었으면). 운영 설정값 INVITE_COMMAND_ENABLED로 끄면 등록에서 빠진다

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from "discord.js";
import config from "../../config/index.ts";
import { appIdOf } from "../../infra/app-id.ts";
import { inviteUrl } from "../../rules/invite-url.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { frame, reply } from "../../ui/frame.ts";
import { buttonEmoji } from "../../ui/icons.ts";
import { LIFETIME, toSelf } from "../../ui/delivery.ts";
import type { BotText } from "../../ui/text/index.ts";
import { privateText } from "../../ui/language.ts";

/** 초대 화면. website가 없으면 초대 버튼 하나 */
function inviteView(T: BotText, { invite, website }: { invite: string; website: string | null }) {
  const t = T.invite.invite();
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
    await toSelf(interaction, reply(inviteView(privateText(interaction), { invite: inviteUrl(appIdOf()), website: config.bot.website })), LIFETIME.screen);
  },
};
export default exported;
export { inviteView };
