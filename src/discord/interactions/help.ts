// /help 의 분류 메뉴와 뒤로 버튼. 본인에게만 보인 화면이라 누른 사람을 따로 보지 않고 그 화면을 고친다

import type { ButtonInteraction, StringSelectMenuInteraction } from "discord.js";
import { post } from "../../ui/frame.ts";
import { HELP, customId } from "../../ui/custom-ids.ts";
import { homeView, sectionView } from "../commands/help.ts";
import { route, type Route } from "./route.ts";
import type { BotContext } from "../../app/bot-context.ts";

async function handleHelpSection(interaction: StringSelectMenuInteraction<"cached">, bot: BotContext) {
  await interaction.update(post(sectionView(bot.commands, interaction.values[0] ?? "", interaction.guildId)));
}

async function handleHelpHome(interaction: ButtonInteraction<"cached">, bot: BotContext) {
  await interaction.update(post(homeView(bot.commands, interaction.guildId)));
}

const routes: Route[] = [route("select", customId(HELP, "section"), handleHelpSection), route("button", customId(HELP, "home"), handleHelpHome)];

export { routes, handleHelpSection, handleHelpHome };
