// /language 패널의 메뉴. 내 언어(language:me)는 누구나, DM에서도. 서버 언어(language:guild)는 서버 관리자만(고를 때 다시 확인한다).
// 고르면 바로 저장하고 패널을 새 개인 언어로 다시 그린다. 서버 언어를 바꾸면 그 서버의 재생 패널은 변경 알림을 받은 쪽이 다시 그린다

import type { StringSelectMenuInteraction } from "discord.js";
import logger from "../../infra/log/logger.ts";
import { isAvailable } from "../../rules/languages.ts";
import * as guildSettings from "../../store/guild-settings.ts";
import * as userSettings from "../../store/user-settings.ts";
import { LANGUAGE, customId } from "../../ui/custom-ids.ts";
import { LIFETIME, noticeSelf, updateSelf } from "../../ui/delivery.ts";
import { post } from "../../ui/frame.ts";
import { languagesNow, privateText } from "../../ui/language.ts";
import { AUTO, FOLLOW_BOT } from "../../ui/language-panel.ts";
import { isServerManager } from "../../usecases/permissions.ts";
import { panelView } from "../commands/language.ts";
import { route, type Route } from "./route.ts";

const log = logger.child({ category: "events" });

/** 고른 값을 저장한다. 받을 수 없는 값이면 "unknown-interaction", 서버 관리자가 아니면 "must-server-manager", 저장하지 못했으면 "settings-save-failed" */
function save(interaction: StringSelectMenuInteraction, which: "me" | "guild") {
  const value = interaction.values[0] ?? "";
  const language = isAvailable(value, languagesNow()) ? value : null;
  if (which === "me") {
    if (value !== AUTO && !language) return "unknown-interaction" as const;
    try {
      userSettings.setLanguage(interaction.user.id, language ?? "auto");
    } catch (error) {
      log.error(`개인 언어 저장 실패: ${interaction.user.id}`, error);
      return "settings-save-failed" as const;
    }
    return null;
  }
  if (!interaction.inCachedGuild()) return "unknown-interaction" as const;
  if (!isServerManager(interaction.member)) return "must-server-manager" as const;
  if (value !== FOLLOW_BOT && !language) return "unknown-interaction" as const;
  try {
    guildSettings.setLanguage(interaction.guildId, language);
  } catch (error) {
    log.error(`서버 언어 저장 실패: ${interaction.guild.name} (${interaction.guildId})`, error);
    return "settings-save-failed" as const;
  }
  return null;
}

const pick = (which: "me" | "guild") => async (interaction: StringSelectMenuInteraction) => {
  const refused = save(interaction, which);
  if (refused) return noticeSelf(interaction, privateText(interaction).errors.notice(refused));
  await updateSelf(interaction, post(panelView(interaction)), LIFETIME.screen);
};

// 서버 안의 메뉴와 DM의 메뉴(dmSelect). 서버 언어 메뉴는 서버에서만 그린다
const routes: Route[] = [route("select", customId(LANGUAGE, "me"), pick("me")), route("dmSelect", customId(LANGUAGE, "me"), pick("me")), route("select", customId(LANGUAGE, "guild"), pick("guild"))];

export { routes };
