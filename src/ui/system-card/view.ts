// /system 메시지: 제목 섹션(봇 프로필 이미지 옆에 제목과 버전 줄), 이미지 두 장(카드 그리드, 최근 기록), 구분선, 갱신 일시,
// 새로고침 버튼과 운영자 패널의 봇 상태 탭으로 가는 링크(자세한 값은 그쪽에 있다. 대시보드 주소가 이 기기에서만 열리면 없다).
// 이미지는 첨부 파일(attachment://)로 단다. 그리는 동안과 그리지 못했을 때는 이미지 자리에 한 줄

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder, resolveColor } from "discord.js";
import { colorOf } from "../colors.ts";
import { SYSTEM, customId } from "../custom-ids.ts";
import { adminStatusButton } from "../dashboard-link.ts";
import type { Attachment } from "../frame.ts";
import { buttonEmoji, icon } from "../icons.ts";
import type { BotText } from "../text/index.ts";

/** 첨부 파일 이름 */
const FILES = { cards: "system.png", history: "history.png" } as const;

type SystemView = {
  /** 봇 프로필 이미지 주소. 없으면 제목만 */
  avatar: string | null;
  versions: { bot: string; ytdlp: string | null; bgutil: string | null };
  /** 갱신 일시(초, 디스코드 타임스탬프로 보는 사람의 시간대에 맞춘다) */
  updatedAt: number;
  /** 이미지 두 장(PNG). drawing이면 그리는 중, failed면 그리지 못함 */
  images: { top: Buffer; bottom: Buffer } | "drawing" | "failed";
};

/** 메시지의 컨테이너와 첨부 파일 */
/** T는 보는 사람의 문구표(본인에게만 보이는 화면) */
function systemView(T: BotText, v: SystemView): { view: ContainerBuilder; files: Attachment[] } {
  const box = new ContainerBuilder().setAccentColor(resolveColor(colorOf("brand")));
  const head = new TextDisplayBuilder().setContent([`### ${icon("system")} ${T.systemCard.title}`, `-# ${T.systemCard.versions(v.versions.bot, v.versions.ytdlp, v.versions.bgutil)}`].join("\n"));
  if (v.avatar) box.addSectionComponents(new SectionBuilder().addTextDisplayComponents(head).setThumbnailAccessory(new ThumbnailBuilder().setURL(v.avatar)));
  else box.addTextDisplayComponents(head);
  const files: Attachment[] = [];
  if (typeof v.images === "string") box.addTextDisplayComponents(new TextDisplayBuilder().setContent(v.images === "drawing" ? T.systemCard.drawing : T.systemCard.drawFailed));
  else {
    files.push({ attachment: v.images.top, name: FILES.cards }, { attachment: v.images.bottom, name: FILES.history });
    box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${FILES.cards}`).setDescription(T.systemCard.cardAlt)));
    box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${FILES.history}`).setDescription(T.systemCard.historyAlt)));
  }
  box.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  box.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${T.systemCard.updated(`<t:${v.updatedAt}:f>`)}`));
  const refresh = new ButtonBuilder()
    .setCustomId(customId(SYSTEM, "refresh"))
    .setLabel(T.info.refresh())
    .setEmoji(buttonEmoji("refresh"))
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(v.images === "drawing");
  const panel = adminStatusButton(T.systemCard.panelLink);
  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(panel ? [refresh, panel] : [refresh]));
  return { view: box, files };
}

export { systemView, FILES };
export type { SystemView };
