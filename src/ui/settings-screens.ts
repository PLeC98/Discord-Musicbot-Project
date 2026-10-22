// 서버 설정 화면(/setting · /setchannel · /setplaylistlimit)과 그 결과. 응답 템플릿(ui/frame)로 그린다.
// 서버 설정을 바꿔 저장한 결과는 완료 색, 설정 화면 · 취소 · 지금 값은 기본 색

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder } from "discord.js";
import { frame } from "./frame.ts";
import type { IconKey } from "./icons.ts";
import * as settingsText from "./text/ko/settings.ts";
import { DJ_ROLE_MAX } from "../rules/limits.ts";
import type { AgePlace } from "../rules/age-place.ts";

/** 헤더 줄(아이콘 키 + 제목)과 본문 */
type Card = { icon?: IconKey; title: string; description: string };

/** 설정을 바꿔 저장했다 */
const saved = ({ icon, title, description }: Card) => frame({ icon, title, body: description, color: "done" });
/** 설정 화면을 닫았다 · 지금 값을 보인다 */
const shown = ({ icon, title, description }: Card) => frame({ icon, title, body: description });

/** 전용 채널을 정했다. channel 은 채널 멘션 */
function channelSet(channel: string) {
  const t = settingsText.channelSet(channel);
  return saved({ icon: t.icon, title: t.title, description: `${t.description}\n\n**${t.inputs}**\n${t.inputsValue}` });
}

/** 선택지 하나. default 면 선택한 채로 */
type Option = { label: string; value: string; default: boolean };
/** /setting 에 그릴 것. sponsor · agePlace 가 null 이면 그 부분이 없다(봇 전체에서 SponsorBlock · 연령 제한 콘텐츠를 껐다) */
type PanelView = { djRoleIds: string[]; sponsor: { enabled: boolean; options: Option[] } | null; agePlace: AgePlace | null };

/**
 * /setting 한 화면. 박스 하나에 부분마다 구분선으로 나눈다: DJ 역할(역할 메뉴) · SponsorBlock(켜기 버튼 · 구간 메뉴) · 연령 제한 콘텐츠(틀 곳 버튼 둘), 맨 아래 닫기.
 * 고르면 바로 저장하고 이 화면을 다시 그린다. 받는 쪽은 src/discord/interactions/settings-panel-handler
 */
function settingsPanel({ djRoleIds, sponsor, agePlace }: PanelView) {
  const t = settingsText.panel;
  const container = frame({ icon: t.icon, title: t.title, body: t.description });
  const divide = () => container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const text = (content: string) => new TextDisplayBuilder().setContent(content);

  divide();
  container.addTextDisplayComponents(text(t.dj(djRoleIds)));
  const roles = new RoleSelectMenuBuilder().setCustomId("setting:dj").setPlaceholder(t.djPlaceholder).setMinValues(0).setMaxValues(DJ_ROLE_MAX);
  if (djRoleIds.length) roles.setDefaultRoles(djRoleIds);
  container.addActionRowComponents(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roles));

  if (sponsor) {
    divide();
    const toggle = new ButtonBuilder()
      .setCustomId("setting:sb-toggle")
      .setLabel(t.sponsorToggle(sponsor.enabled))
      .setStyle(sponsor.enabled ? ButtonStyle.Secondary : ButtonStyle.Success);
    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(t.sponsor(sponsor.enabled))).setButtonAccessory(toggle));
    // 끄면 구간은 고를 수 없다(고른 것은 남는다)
    const categories = new StringSelectMenuBuilder().setCustomId("setting:sb-cats").setPlaceholder(t.sponsorPlaceholder).setMinValues(0).setMaxValues(sponsor.options.length).addOptions(sponsor.options).setDisabled(!sponsor.enabled);
    container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(categories));
  }

  if (agePlace) {
    divide();
    container.addTextDisplayComponents(text(t.age()));
    // 고른 쪽이 색 버튼
    const pick = (place: AgePlace, label: string) =>
      new ButtonBuilder()
        .setCustomId(`setting:age-${place}`)
        .setLabel(label)
        .setStyle(agePlace === place ? ButtonStyle.Primary : ButtonStyle.Secondary);
    container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(pick("channel", t.ageChannel), pick("all", t.ageAll)));
    if (agePlace === "all") container.addTextDisplayComponents(text(t.ageAllWarning));
  }

  divide();
  container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("setting:close").setLabel(t.close).setStyle(ButtonStyle.Secondary)));
  return container;
}

export { saved, shown, channelSet, settingsPanel };
export type { PanelView };
