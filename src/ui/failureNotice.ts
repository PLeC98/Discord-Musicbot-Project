// 처리가 던졌을 때 안내를 어디에 보일지. 남기기와 안내는 상호작용 입구(events/interactionCreate)가 한다.
// 자리표시자("검색 중" · "처리 중")를 띄운 처리기는 그 자리를 안내로 바꾸는 법을 선언한다. 선언이 없으면 입구의 기본대로

import type { RepliableInteraction } from "discord.js";
import { noticeReply, type Notice } from "./frame.ts";

type Show = (notice: Notice) => Promise<unknown>;

const shows = new WeakMap<object, Show>();

/** 이 상호작용이 던지면 안내를 show 로 보인다 */
function showFailureWith(interaction: object, show: Show) {
  shows.set(interaction, show);
}

/** 선언된 안내 방법. 없으면 null */
function failureShow(interaction: object): Show | null {
  return shows.get(interaction) ?? null;
}

/**
 * 답한 자리를 안내로 고칠 수 없을 때(미뤄 둔 응답 · 임베드 · 글자 메시지는 Components V2 로 바꿀 수 없다) 그 자리를 지우고 본인에게만 새로 보낸다.
 * 버튼 · 메뉴가 아직 답하지 않았으면 먼저 받아 두어 그 버튼이 달린 메시지를 지운다. 이미 지워졌어도 안내는 보낸다
 */
async function noticeInstead(interaction: RepliableInteraction, notice: Notice) {
  if (!interaction.deferred && !interaction.replied && interaction.isMessageComponent()) await interaction.deferUpdate();
  await interaction.deleteReply().catch(() => {
    /* 이미 지워졌다 */
  });
  return interaction.followUp(noticeReply(notice));
}

export { showFailureWith, failureShow, noticeInstead };
