// /help의 분류 메뉴와 뒤로 버튼. 본인에게만 보인 화면이라 누른 사람을 따로 보지 않고 그 화면을 고친다. 고칠 때마다 삭제를 다시 센다

import type { ButtonInteraction, StringSelectMenuInteraction } from "discord.js";
import { post } from "../../ui/frame.ts";
import { HELP, customId } from "../../ui/custom-ids.ts";
import { LIFETIME, updateSelf } from "../../ui/delivery.ts";
import { helpAccess } from "../../usecases/help-access.ts";
import { homeView, sectionView } from "../commands/help.ts";
import { route, type Route } from "./route.ts";
import type { BotContext } from "../../app/bot-context.ts";
import { privateText } from "../../ui/language.ts";

async function handleHelpSection(interaction: StringSelectMenuInteraction<"cached">, bot: BotContext) {
  const view = sectionView(privateText(interaction), bot.commands, interaction.values[0] ?? "", interaction.guildId, await helpAccess(interaction.member));
  await updateSelf(interaction, post(view), LIFETIME.screen);
}

async function handleHelpHome(interaction: ButtonInteraction<"cached">, bot: BotContext) {
  await updateSelf(interaction, post(homeView(privateText(interaction), bot.commands, interaction.guildId)), LIFETIME.screen);
}

const routes: Route[] = [route("select", customId(HELP, "section"), handleHelpSection), route("button", customId(HELP, "home"), handleHelpHome)];

export { routes, handleHelpSection, handleHelpHome };
