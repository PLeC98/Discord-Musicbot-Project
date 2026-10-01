// 재생 조작의 입구: 슬래시 명령과 재생 패널 버튼이 같은 절차(조작 → 응답)를 쓴다.
// 권한 · 재적 · 계층 검사와 조작은 usecases/controls, 응답 화면은 ui/controlReplies 가 한다

import type { RepliableInteraction } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as replies from "../src/ui/controlReplies.ts";
import { noticeFrame, noticeReply, post, reply } from "../src/ui/frame.ts";
import { showFailureWith } from "../src/ui/failureNotice.ts";
import type { Player } from "../src/player/Player.ts";
import type { Refusal } from "../src/ui/text/errors.ts";

/** 서버 안의 명령 · 버튼 */
type Asked = RepliableInteraction<"cached">;
/** 이 서버의 플레이어. 없을 수 있다 */
type MaybePlayer = Player | null | undefined;

const refuse = (interaction: Asked, r: Refusal) => interaction.reply(noticeReply(controlMessage(r)));

async function answerPause(interaction: Asked, player: MaybePlayer) {
  const r = await controls.pause(player, { member: interaction.member });
  if (!r.ok) return refuse(interaction, r);
  return interaction.reply(reply(replies.paused(r.paused, r.track, interaction.member)));
}

async function answerSkip(interaction: Asked, player: MaybePlayer) {
  const r = await controls.skip(player, { member: interaction.member });
  if (!r.ok) return refuse(interaction, r);
  return interaction.reply(reply(replies.skipped(r.restarted, r.track, interaction.member)));
}

async function answerPrevious(interaction: Asked, player: MaybePlayer) {
  const r = await controls.previous(player, { member: interaction.member });
  if (!r.ok) return refuse(interaction, r);
  return interaction.reply(reply(replies.previous(r.restarted)));
}

async function answerStop(interaction: Asked, player: MaybePlayer) {
  const r = await controls.stop(player, { member: interaction.member });
  if (!r.ok) return refuse(interaction, r);
  return interaction.reply(reply(replies.stopped(r.track, r.cleared, interaction.member)));
}

async function answerShuffle(interaction: Asked, player: MaybePlayer) {
  const r = await controls.shuffle(player, { member: interaction.member });
  if (!r.ok) return refuse(interaction, r);
  return interaction.reply(reply(replies.shuffled(r.count, interaction.member)));
}

/** 반복 모드. mode 는 명령이 고른 값이거나 버튼의 다음 모드(맞는 값인지는 controls 가 본다) */
async function answerLoop(interaction: Asked, player: MaybePlayer, mode: unknown) {
  const r = await controls.loop(player, { member: interaction.member }, mode);
  if (!r.ok) return refuse(interaction, r);
  return interaction.reply(reply(replies.loopSet(r.mode, r.track, interaction.member)));
}

/**
 * 하이라이트로. 옮기는 데 시간이 걸려 받아들인 즉시 "옮기는 중" 을 Components V2 로 보내고 결과로 고친다
 * (미뤄 둔 응답은 나중에 Components V2 로 바꿀 수 없다). 그 뒤에 던지면 그 자리를 오류로 바꾼다.
 * onNone: 하이라이트가 없을 때 거절 대신 할 일. 패널 버튼은 하이라이트가 없으면 꺼져 있어, 곡이 바뀌기 직전의 늦은 클릭이라 조용히 넘긴다
 */
async function answerHighlight(interaction: Asked, player: MaybePlayer, { onNone }: { onNone?: () => unknown } = {}) {
  const accept = async () => {
    await interaction.reply(reply(replies.highlighting()));
    showFailureWith(interaction, (notice) => interaction.editReply(post(noticeFrame(notice))));
  };
  const r = await controls.highlight(player, { member: interaction.member }, { onAccepted: accept });
  if (!r.ok && r.code === "no-highlight" && onNone) return onNone();
  if (!r.ok) return refuse(interaction, r);
  return interaction.editReply(post(replies.highlighted(r.track, r.ms)));
}

export { answerPause, answerSkip, answerPrevious, answerStop, answerShuffle, answerLoop, answerHighlight };
