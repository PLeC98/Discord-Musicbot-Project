import { PermissionFlagsBits, type ButtonInteraction, type Guild, type RoleSelectMenuInteraction, type StringSelectMenuInteraction } from "discord.js";
import * as GuildSettingsManager from "../../store/guild-settings.ts";
import { SKIP_CATEGORIES, categoryLabel } from "../../rules/sponsor-categories.ts";
import { ageContentOn } from "../../config/age-content.ts";
import config from "../../config/index.ts";
import { route, type Route } from "./route.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { post } from "../../ui/frame.ts";
import * as screens from "../../ui/settings-screens.ts";
import { noticeInstead, noticeSelf } from "../../ui/delivery.ts";
import type { AgePlace } from "../../rules/age-place.ts";

// /setting 한 화면(DJ 역할 · SponsorBlock · 연령 제한 콘텐츠) 처리. 고르거나 누르면 바로 저장하고 화면을 지금 값으로 다시 그린다.
// 저장 전의 고른 것을 들고 있지 않는다(저장 버튼이 없다). 본인에게만 보인 화면이라 호출자만 조작한다.
// 봇 전체에서 SponsorBlock · 연령 제한 콘텐츠를 껐으면 그 부분이 없다. 화면을 띄운 뒤에 껐으면 누른 것은 저장하지 않고 다시 그린다

/** 지금 값으로 그릴 것. 서버에 없는 역할은 뺀다 */
async function panelView(guild: Guild): Promise<screens.PanelView> {
  const djRoleIds = (await GuildSettingsManager.getDjRoles(guild.id)).filter((id) => guild.roles.cache.has(id));
  const sb = GuildSettingsManager.resolveSponsorBlock(guild.id);
  const chosen = new Set(sb.categories);
  const sponsor = config.sponsorblock.enabled ? { enabled: sb.enabled, options: SKIP_CATEGORIES.map((id) => ({ label: categoryLabel(id), value: id, default: chosen.has(id) })) } : null;
  return { djRoleIds, sponsor, agePlace: ageContentOn() ? GuildSettingsManager.resolveAgePlace(guild.id) : null };
}

const panel = async (guild: Guild) => screens.settingsPanel(await panelView(guild));

// 역할 메뉴(setting:dj). 비우면 DJ 역할을 푼다(모두가 조작). 고른 사이에 지운 역할은 뺀다
async function saveDjRoles(interaction: RoleSelectMenuInteraction<"cached">) {
  const guild = interaction.guild;
  const roleIds = interaction.values.filter((id) => guild.roles.cache.has(id));
  if (!roleIds.length) await GuildSettingsManager.clearDjRoles(guild.id);
  else if (!(await GuildSettingsManager.setDjRoles(guild.id, roleIds))) return noticeInstead(interaction, errors.notice("dj-role-save-failed"));
  return interaction.update(post(await panel(guild)));
}

// 구간 메뉴(setting:sb-cats). 켜고 끄기는 그대로 둔다. 모르는 구간은 뺀다
async function saveSponsorCategories(interaction: StringSelectMenuInteraction<"cached">) {
  const guild = interaction.guild;
  if (config.sponsorblock.enabled) {
    const valid = new Set(SKIP_CATEGORIES);
    await GuildSettingsManager.setSponsorBlock(guild.id, { categories: [...new Set(interaction.values.filter((c) => valid.has(c)))] });
  }
  return interaction.update(post(await panel(guild)));
}

const AGE_BUTTONS: Record<string, AgePlace> = { "setting:age-channel": "channel", "setting:age-all": "all" };

// 버튼: SponsorBlock 켜기 · 끄기(setting:sb-toggle), 연령 제한 콘텐츠를 틀 곳(setting:age-*), 닫기(setting:close)
async function pressButton(interaction: ButtonInteraction<"cached">) {
  const guild = interaction.guild;
  // 닫기: 본인에게만 보인 화면을 바로 지운다
  if (interaction.customId === "setting:close") {
    await interaction.deferUpdate();
    return interaction.deleteReply();
  }
  if (interaction.customId === "setting:sb-toggle" && config.sponsorblock.enabled) {
    await GuildSettingsManager.setSponsorBlock(guild.id, { enabled: !GuildSettingsManager.resolveSponsorBlock(guild.id).enabled });
  }
  const place = AGE_BUTTONS[interaction.customId];
  if (place && ageContentOn()) await GuildSettingsManager.setAgePlace(guild.id, place);
  return interaction.update(post(await panel(guild)));
}

// 명령 진입과 같은 기준을 다시 본다(서버 관리 권한)
function moderatorOnly<I extends RoleSelectMenuInteraction<"cached"> | StringSelectMenuInteraction<"cached"> | ButtonInteraction<"cached">>(handle: (interaction: I) => unknown) {
  return (interaction: I) => (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ? handle(interaction) : noticeSelf(interaction, errors.notice("must-moderator")));
}

const routes: Route[] = [route("roleSelect", "setting:dj", moderatorOnly(saveDjRoles)), route("select", "setting:sb-cats", moderatorOnly(saveSponsorCategories)), route("button", "setting:", moderatorOnly(pressButton))];

export { routes, panel };
