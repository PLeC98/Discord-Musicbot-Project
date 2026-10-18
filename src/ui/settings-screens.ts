// 서버 설정 화면(/setchannel · /setdjrole · /sponsorblock · /setplaylistlimit)과 그 결과. 응답 템플릿(ui/frame)로 그린다.
// 서버 설정을 바꿔 저장한 결과는 완료 색, 설정 화면 · 취소 · 지금 값은 기본 색

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder, StringSelectMenuBuilder } from "discord.js";
import { frame } from "./frame.ts";
import * as settingsText from "./text/ko/settings.ts";
import { DJ_ROLE_MAX } from "../rules/limits.ts";

/** 헤더 줄과 본문 */
type Card = { title: string; description: string };

/** 설정을 바꿔 저장했다 */
const saved = ({ title, description }: Card) => frame({ title, body: description, color: "done" });
/** 설정 화면을 닫았다 · 지금 값을 보인다 */
const shown = ({ title, description }: Card) => frame({ title, body: description });

/** 전용 채널을 정했다. channel 은 채널 멘션 */
function channelSet(channel: string) {
  const t = settingsText.channelSet(channel);
  return saved({ title: t.title, description: `${t.description}\n\n**${t.inputs}**\n${t.inputsValue}` });
}

// 저장 · 취소 버튼의 라벨. custom_id 는 받는 처리기의 것이라 화면마다 문자열 그대로 적는다(경로 테스트가 읽는다)
const { save, cancel } = settingsText.buttons();

/** DJ 역할 선택 화면. roleIds 는 지금 DJ 역할(서버에 남아 있는 것), 메뉴의 기본값이 된다. 받는 쪽은 src/discord/interactions/dj-role-config-handler */
function djRoleMenu(roleIds: string[]) {
  const t = settingsText.djRoleMenu(roleIds);
  const select = new RoleSelectMenuBuilder().setCustomId("djrole:select").setPlaceholder(t.placeholder).setMinValues(0).setMaxValues(DJ_ROLE_MAX);
  if (roleIds.length) select.setDefaultRoles(roleIds);
  return shown(t)
    .addActionRowComponents(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("djrole:save").setLabel(save).setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId("djrole:cancel").setLabel(cancel).setStyle(ButtonStyle.Secondary)));
}

/** SponsorBlock 설정 화면. options 는 선택할 구간 종류(라벨 · 선택했는지). 받는 쪽은 src/discord/interactions/sponsor-config-handler */
function sponsorMenu({ enabled, options }: { enabled: boolean; options: Array<{ label: string; value: string; default: boolean }> }) {
  const t = settingsText.sponsorMenu(enabled);
  const select = new StringSelectMenuBuilder().setCustomId("sb:cats").setPlaceholder(t.placeholder).setMinValues(0).setMaxValues(options.length).addOptions(options);
  const toggle = new ButtonBuilder()
    .setCustomId("sb:toggle")
    .setLabel(t.toggle)
    .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
  return shown(t)
    .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(toggle, new ButtonBuilder().setCustomId("sb:save").setLabel(save).setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId("sb:cancel").setLabel(cancel).setStyle(ButtonStyle.Secondary)));
}

export { saved, shown, channelSet, djRoleMenu, sponsorMenu };
