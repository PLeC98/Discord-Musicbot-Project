// 재생 조작의 입구: 슬래시 명령과 재생 패널 버튼이 같은 절차(조작 → 응답)를 쓴다.
// 권한 · 재적 · 계층 검사와 조작은 usecases/controls, 응답 화면은 ui/controlReplies 가 한다

import type { ContainerBuilder, RepliableInteraction } from "discord.js";
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
  return interaction.reply(reply(replies.previous(r.restarted, r.track)));
}

async function answerStop(interaction: Asked, player: MaybePlayer) {
  const r = await controls.stop(player, { member: interaction.member });
  if (!r.ok) return refuse(interaction, r);
  return interaction.reply(reply(replies.stopped(r.cleared, interaction.member)));
}

async function answerShuffle(interaction: Asked, player: MaybePlayer) {
  const r = await controls.shuffle(player, { member: interaction.member });
  if (!r.ok) return refuse(interaction, r);
  return interaction.reply(reply(replies.shuffled(r.count, interaction.member)));
}

/** 음량. level 은 명령이 받은 수이거나 입력 창에 적은 값(맞는 값인지는 controls 가 본다) */
async function answerVolume(interaction: Asked, player: MaybePlayer, level: unknown) {
  const r = await controls.volume(player, { member: interaction.member }, level);
  if (!r.ok) return refuse(interaction, r);
  return interaction.reply(reply(replies.volumeSet(r.before, r.level, interaction.member)));
}

/** 반복 모드. mode 는 명령이 고른 값이거나 버튼의 다음 모드(맞는 값인지는 controls 가 본다) */
async function answerLoop(interaction: Asked, player: MaybePlayer, mode: unknown) {
  const r = await controls.loop(player, { member: interaction.member }, mode);
  if (!r.ok) return refuse(interaction, r);
  return interaction.reply(reply(replies.loopSet(r.mode, r.track, interaction.member)));
}

/**
 * 시간이 걸리는 조작(곡을 다시 연다)을 받아들였다. 곧바로 "하는 중" 을 Components V2 로 보내고 결과로 고친다
 * (미뤄 둔 응답은 나중에 Components V2 로 바꿀 수 없다). 그 뒤에 던지면 그 자리를 오류로 바꾼다
 */
const acceptWith = (interaction: Asked, working: ContainerBuilder) => async () => {
  await interaction.reply(reply(working));
  showFailureWith(interaction, (notice) => interaction.editReply(post(noticeFrame(notice))));
};

/** 처음부터 다시 */
async function answerReplay(interaction: Asked, player: MaybePlayer) {
  const r = await controls.replay(player, { member: interaction.member }, { onAccepted: acceptWith(interaction, replies.replaying()) });
  if (!r.ok) return refuse(interaction, r);
  return interaction.editReply(post(replies.replayed(r.track, interaction.member)));
}

/** 곡 안의 위치로. ms 는 옮길 위치 */
async function answerSeek(interaction: Asked, player: MaybePlayer, ms: number) {
  const r = await controls.seek(player, { member: interaction.member }, ms, { reason: "seek", onAccepted: acceptWith(interaction, replies.seeking()) });
  if (!r.ok) return refuse(interaction, r);
  return interaction.editReply(post(replies.seeked(r.ms)));
}

/**
 * 하이라이트로.
 * onNone: 하이라이트가 없을 때 거절 대신 할 일. 패널 버튼은 하이라이트가 없으면 꺼져 있어, 곡이 바뀌기 직전의 늦은 클릭이라 조용히 넘긴다
 */
async function answerHighlight(interaction: Asked, player: MaybePlayer, { onNone }: { onNone?: () => unknown } = {}) {
  const r = await controls.highlight(player, { member: interaction.member }, { onAccepted: acceptWith(interaction, replies.highlighting()) });
  if (!r.ok && r.code === "no-highlight" && onNone) return onNone();
  if (!r.ok) return refuse(interaction, r);
  return interaction.editReply(post(replies.highlighted(r.ms)));
}

export { answerPause, answerSkip, answerPrevious, answerStop, answerShuffle, answerLoop, answerVolume, answerReplay, answerSeek, answerHighlight };
