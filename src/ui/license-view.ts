// /license 화면: 봇의 라이선스와 저작권 고지, 서드파티 고지가 있는 파일, 링크 버튼(운영 소스 코드, 고친 버전이면 원본 프로젝트, AGPL-3.0 전문)

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, resolveColor } from "discord.js";
import { AGPL_URL, PROJECT_COPYRIGHT, PROJECT_LICENSE, isModifiedSource } from "../rules/project-source.ts";
import { colorOf } from "./colors.ts";
import { buttonEmoji } from "./icons.ts";
import type { BotText } from "./text/index.ts";

/** sourceRepo: 운영 소스 코드(SOURCE_REPO_URL, 없으면 본 저장소), projectRepo: 본 저장소 */
function licenseView(T: BotText, { sourceRepo, projectRepo }: { sourceRepo: string; projectRepo: string }) {
  const t = T.info.license();
  const modified = isModifiedSource(sourceRepo, projectRepo);
  const link = (label: string, url: string) => new ButtonBuilder().setLabel(label).setEmoji(buttonEmoji("web")).setURL(url).setStyle(ButtonStyle.Link);
  const box = new ContainerBuilder().setAccentColor(resolveColor(colorOf("brand")));
  box.addTextDisplayComponents(new TextDisplayBuilder().setContent([`### ${t.title}`, t.body, "", `**${t.thisBot}** \`${PROJECT_LICENSE}\``, `-# ${PROJECT_COPYRIGHT}`].join("\n")));
  box.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  box.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${t.thirdParty}`));
  const original = modified ? [link(t.originalProject, projectRepo)] : [];
  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(link(t.runningSource, sourceRepo), ...original, link(t.fullText, AGPL_URL)));
  return box;
}

export { licenseView };
