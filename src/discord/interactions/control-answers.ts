// 재생 조작의 진입점: 슬래시 명령과 재생 패널 버튼이 같은 절차(조작 → 응답)를 쓴다.
// 권한 · 재적 · 계층 검사와 조작은 usecases/controls, 응답 화면은 ui/control-replies 가 한다

import type { ContainerBuilder, RepliableInteraction } from "discord.js";
import * as controls from "../../usecases/controls.ts";
import { controlMessage } from "../../ui/control-messages.ts";
import * as replies from "../../ui/control-replies.ts";
import { noticeFrame, reply } from "../../ui/frame.ts";
import { LIFETIME, noticeMs, noticeSelf, replaceSelf, toAll } from "../../ui/delivery.ts";
import { showFailureWith } from "../../ui/failure-notice.ts";
import type { Player } from "../../player/player.ts";
import type { Problem } from "../../rules/problems.ts";

/** 서버 안의 명령 · 버튼 */
type Asked = RepliableInteraction<"cached">;
/** 이 서버의 플레이어. 없을 수 있다 */
type MaybePlayer = Player | null | undefined;

const refuse = (interaction: Asked, r: Problem) => noticeSelf(interaction, controlMessage(r));

async function answerPause(interaction: Asked, player: MaybePlayer) {
  const r = await controls.pause(player, { member: interaction.member });
  if (!r.ok) return refuse(interaction, r);
  return toAll(interaction, replies.paused(r.paused, r.track, interaction.member), LIFETIME.result);
}

async function answerSkip(interaction: Asked, player: MaybePlayer) {
  const r = await controls.skip(player, { member: interaction.member });
  if (!r.ok) return refuse(interaction, r);
  return toAll(interaction, replies.skipped(r.restarted, r.track, interaction.member), LIFETIME.result);
}

async function answerPrevious(interaction: Asked, player: MaybePlayer) {
  const r = await controls.previous(player, { member: interaction.member });
  if (!r.ok) return refuse(interaction, r);
  return toAll(interaction, replies.previous(r.restarted, r.track), LIFETIME.result);
}

async function answerStop(interaction: Asked, player: MaybePlayer) {
  const r = await controls.stop(player, { member: interaction.member });
  if (!r.ok) return refuse(interaction, r);
  return toAll(interaction, replies.stopped(r.cleared, interaction.member), LIFETIME.farewell);
}

async function answerShuffle(interaction: Asked, player: MaybePlayer) {
  const r = await controls.shuffle(player, { member: interaction.member });
  if (!r.ok) return refuse(interaction, r);
  return toAll(interaction, replies.shuffled(r.count, interaction.member), LIFETIME.result);
}

/** 볼륨. level 은 명령이 받은 수이거나 입력 창에 입력한 값(맞는 값인지는 controls 가 본다) */
async function answerVolume(interaction: Asked, player: MaybePlayer, level: unknown) {
  const r = await controls.volume(player, { member: interaction.member }, level);
  if (!r.ok) return refuse(interaction, r);
  return toAll(interaction, replies.volumeSet(r.before, r.level, interaction.member), LIFETIME.result);
}

/** 반복 모드. mode 는 명령이 선택한 값이거나 버튼의 다음 모드(맞는 값인지는 controls 가 본다) */
async function answerLoop(interaction: Asked, player: MaybePlayer, mode: unknown) {
  const r = await controls.loop(player, { member: interaction.member }, mode);
  if (!r.ok) return refuse(interaction, r);
  return toAll(interaction, replies.loopSet(r.mode, interaction.member), LIFETIME.result);
}

/**
 * 시간이 걸리는 조작(곡을 다시 연다)을 받아들였다. 곧바로 "하는 중" 을 본인에게 보내고, 결과는 모두에게 새로 보낸다(ui/delivery).
 * 그 뒤에 던지면 "하는 중" 자리표시자를 오류로 바꾼다
 */
const acceptWith = (interaction: Asked, working: ContainerBuilder) => async () => {
  await interaction.reply(reply(working));
  showFailureWith(interaction, (notice) => replaceSelf(interaction, noticeFrame(notice), noticeMs(notice)));
};

/** 처음부터 다시 */
async function answerReplay(interaction: Asked, player: MaybePlayer) {
  const r = await controls.replay(player, { member: interaction.member }, { onAccepted: acceptWith(interaction, replies.replaying()) });
  if (!r.ok) return refuse(interaction, r);
  return toAll(interaction, replies.replayed(r.track, interaction.member), LIFETIME.result);
}

/** 곡 안의 위치로. ms 는 옮길 위치 */
async function answerSeek(interaction: Asked, player: MaybePlayer, ms: number) {
  const r = await controls.seek(player, { member: interaction.member }, ms, { reason: "seek", onAccepted: acceptWith(interaction, replies.seeking()) });
  if (!r.ok) return refuse(interaction, r);
  return toAll(interaction, replies.seeked(r.ms), LIFETIME.result);
}

/**
 * 하이라이트로.
 * onNone: 하이라이트가 없을 때 거절 대신 할 일. 패널 버튼은 하이라이트가 없으면 꺼져 있어, 곡이 바뀌기 직전의 늦은 클릭이라 조용히 넘긴다
 */
async function answerHighlight(interaction: Asked, player: MaybePlayer, { onNone }: { onNone?: () => unknown } = {}) {
  const r = await controls.highlight(player, { member: interaction.member }, { onAccepted: acceptWith(interaction, replies.highlighting()) });
  if (!r.ok && r.code === "no-highlight" && onNone) return onNone();
  if (!r.ok) return refuse(interaction, r);
  return toAll(interaction, replies.highlighted(r.ms), LIFETIME.result);
}

export { answerPause, answerSkip, answerPrevious, answerStop, answerShuffle, answerLoop, answerVolume, answerReplay, answerSeek, answerHighlight };
