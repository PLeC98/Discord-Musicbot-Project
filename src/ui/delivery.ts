// 상호작용 응답을 누구에게 보이고 얼마 뒤 삭제할지. 수명은 LIFETIME 한 곳에서 정한다.
//   본인(ephemeral): 상호작용 토큰으로 삭제한다. 토큰이 15분이라 그보다 긴 수명은 두지 않는다(사용자가 닫거나 디스코드를 다시 시작하면 사라진다)
//   모두: 공개 응답 · 채널 메시지. transientMessages.scheduleDelete 로 삭제해 패널이 묻혔는지 셀 때 빠진다
// "하는 중"(자리표시자 · 메뉴 · 설정 화면)은 본인에게, 결과는 모두에게. 본인 자리표시자 뒤의 결과는 자리표시자를 삭제하고 채널에 새로 보낸다

import { MessageFlags, type ContainerBuilder, type InteractionReplyOptions, type RepliableInteraction } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "events" });
import { messageOf } from "../rules/error-kind.ts";
import type { Code } from "../rules/problems.ts";
import type { Notice } from "./text/notice.ts";
import { canSend } from "./channels.ts";
import { noticeReply, post, type Attachment } from "./frame.ts";
import { scheduleDelete } from "./transient-messages.ts";

/** 응답의 수명(ms). null 은 삭제하지 않는다 */
const LIFETIME = {
  warning: 10_000, // 사용자가 고칠 수 있거나 지금 상태라 못 한 것
  error: 15_000, // 봇 쪽 문제. 운영자에게 알릴 수도 있어 조금 더 둔다
  result: 15_000, // 조작 결과
  farewell: 30_000, // 정지 · 나가기
  glance: 10_000, // 잠깐 보는 것(곡 담은 안내 · 지금 값 보기 · 취소 · 이미 들어와 있음)
  menu: 60_000, // 선택 화면(더 넣기 · 검색 결과 · 자동재생 장르)
  screen: 600_000, // 읽는 화면 · 설정 화면
} as const;

// 수준과 다르게 두는 안내. 연결 오류는 대개 일시적이고, 곡 전환 실패는 운영자에게 알려 달라고 한다
const BY_CODE: Partial<Record<Code, number>> = { "network-error": LIFETIME.warning, "switch-failed": LIFETIME.error };

const noticeMs = (notice: Notice) => (notice.code !== undefined ? BY_CODE[notice.code] : undefined) ?? LIFETIME[notice.severity];

// 상호작용 토큰은 15분 뒤 죽는다. 그보다 긴 수명은 삭제할 수 없다
const TOKEN_MS = 15 * 60_000;

// 테스트가 예약된 수명을 읽는 위치. 상호작용마다 예약한 순서대로
const scheduled = new WeakMap<object, Array<number | null>>();
const lifetimesOf = (interaction: object) => scheduled.get(interaction) ?? [];
const record = (interaction: object, ms: number | null) => scheduled.set(interaction, [...lifetimesOf(interaction), ms]);

/** 본인 응답을 ms 뒤 삭제한다. messageId 가 있으면 그 후속 메시지, 없으면 첫 응답 */
function expireSelf(interaction: RepliableInteraction, ms: number | null, messageId?: string) {
  record(interaction, ms);
  if (ms === null || ms >= TOKEN_MS) return;
  const timer = setTimeout(() => {
    Promise.resolve()
      .then(() => (messageId ? interaction.deleteReply(messageId) : interaction.deleteReply()))
      .catch(() => {
        /* 이미 닫았거나 삭제했다 */
      });
  }, ms);
  timer.unref?.();
}

type SelfPayload = InteractionReplyOptions & { flags: unknown };

/** 본인에게만. 아직 답하지 않았으면 응답으로, 답했으면 후속 메시지로 보내고 ms 뒤 삭제한다. payload 는 본인 표시(Ephemeral)를 단 것 */
async function toSelf(interaction: RepliableInteraction, payload: SelfPayload, ms: number | null) {
  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply(payload);
    return expireSelf(interaction, ms);
  }
  const message = await interaction.followUp(payload);
  expireSelf(interaction, ms, message.id);
}

/** 본인에게 표시한 자리표시자(Components V2)를 고치고 ms 뒤 삭제한다 */
async function replaceSelf(interaction: RepliableInteraction, view: ContainerBuilder, ms: number | null) {
  await interaction.editReply(post(view));
  expireSelf(interaction, ms);
}

/**
 * 답한 응답을 안내로 고칠 수 없을 때(미뤄 둔 응답 · 임베드 · 텍스트 메시지는 Components V2 로 바꿀 수 없다) 그 응답을 삭제하고 본인에게만 새로 보낸다.
 * 버튼 · 메뉴가 아직 답하지 않았으면 먼저 받아 두어 그 버튼이 달린 메시지를 삭제한다. 이미 삭제됐어도 안내는 보낸다
 */
async function noticeInstead(interaction: RepliableInteraction, notice: Notice) {
  if (!interaction.deferred && !interaction.replied && interaction.isMessageComponent()) await interaction.deferUpdate();
  await interaction.deleteReply().catch(() => {
    /* 이미 삭제됐다 */
  });
  const message = await interaction.followUp(noticeReply(notice));
  expireSelf(interaction, noticeMs(notice), message.id);
}

/** 거절 · 오류 안내를 본인에게. 미뤄 둔 명령은 그 응답을 삭제하고 새로 보낸다 */
function noticeSelf(interaction: RepliableInteraction, notice: Notice) {
  if (interaction.isChatInputCommand() && interaction.deferred && !interaction.replied) return noticeInstead(interaction, notice);
  return toSelf(interaction, noticeReply(notice), noticeMs(notice));
}

/**
 * 모두에게. 아직 답하지 않았으면 공개 응답으로, 본인 자리표시자를 표시했으면 그것을 삭제하고 채널에 새로 보낸다
 * (채널에 쓸 수 없으면 공개 후속 메시지). ms 뒤 삭제한다. files: 화면이 attachment:// 로 건 첨부
 */
async function toAll(interaction: RepliableInteraction, view: ContainerBuilder, ms: number | null, files?: Attachment[]) {
  record(interaction, ms);
  if (!interaction.replied && !interaction.deferred) {
    const { resource } = await interaction.reply({ ...post(view, files), withResponse: true });
    const id = resource?.message?.id;
    if (id && ms !== null) scheduleDelete({ id, delete: () => interaction.deleteReply() }, ms);
    return;
  }
  await interaction.deleteReply().catch(() => {
    /* 자리표시자가 이미 삭제됐다 */
  });
  return postNew(interaction, view, ms, files);
}

/**
 * 모두에게 새 메시지로 보내고 ms 뒤 삭제한다. 채널에 쓸 수 없으면(권한 없음 등) 공개 후속 메시지로.
 * 상호작용 응답은 채널 권한이 없어도 되므로 봇이 글을 못 쓰는 채널에서도 결과는 보인다
 */
async function postNew(interaction: RepliableInteraction, view: ContainerBuilder, ms: number | null, files?: Attachment[]) {
  if (canSend(interaction.channel)) {
    try {
      const message = await interaction.channel.send(post(view, files));
      if (ms !== null) scheduleDelete(message, ms);
      return;
    } catch (error) {
      log.debug(`채널에 보내지 못해 후속 메시지로 보냅니다: ${messageOf(error)}`);
    }
  }
  const message = await interaction.followUp(post(view, files));
  if (ms !== null) scheduleDelete({ id: message.id, delete: () => interaction.deleteReply(message.id) }, ms);
}

/** 본인 표시를 단 응답(임베드 · 텍스트 화면) */
const selfOnly = <P extends object>(payload: P) => ({ ...payload, flags: MessageFlags.Ephemeral }) as P & { flags: MessageFlags.Ephemeral };

export { LIFETIME, TOKEN_MS, noticeMs, expireSelf, toSelf, replaceSelf, noticeInstead, noticeSelf, toAll, postNew, selfOnly, lifetimesOf };
