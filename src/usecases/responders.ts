import { MessageFlags } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import { scheduleDelete } from "../ui/transient-messages.ts";
import { messageOf } from "../rules/error-kind.ts";
import type { ContainerBuilder, GuildTextBasedChannel, RepliableInteraction } from "discord.js";
import type { Responder } from "../ui/now-playing-panel.ts";
import { post } from "../ui/frame.ts";
import { icon } from "../ui/icons.ts";
import { LIFETIME, postNew, unlessGone } from "../ui/delivery.ts";

/**
 * 곡 추가 결과를 사용자에게 알리는 매체별 어댑터.
 *
 * 코어는 아래 두 메서드만 부르고 매체를 모른다. 이 경계가 없으면 "디스코드에 아무것도 보내지 않음"
 * (대시보드)을 표현할 수 없다.
 *
 *   notifyQueued(view)     담은 안내(ui/added-notice 의 화면)를 표시한다
 *   dismissPlaceholder()   진입점이 표시한 "검색 중…" 자리표시자를 정리한다 (멱등)
 *
 * 둘 다 던지지 않는다. 안내 실패가 재생을 망가뜨리면 안 된다.
 * 실패 경로에서는 코어가 dismissPlaceholder를 부르지 않는다. 진입점이 자리표시자에 오류를 덮어쓸 수 있게.
 */

// 두 번 불려도 한 번만 실행되는 정리 함수. 코어와 진입점이 모두 부를 수 있다.
function onceDismiss(fn: (() => unknown) | null | undefined) {
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    try {
      if (fn) await fn();
    } catch (error) {
      unlessGone(log, "자리표시자 정리")(error);
    }
  };
}

/**
 * 슬래시 명령. 자리표시자("검색 중")는 본인에게만 보이는 응답이라 채널에 남지 않는다. 담은 안내는 모두에게 새로 보내고
 * (채널에 쓸 수 없으면 공개 후속 메시지), 자리표시자는 명령이 끝낼 때 치운다(더 넣기 메뉴로 고치거나 삭제한다).
 * 자리표시자 없이 부른 명령(/dashboard)은 조용히 확인만 하고 삭제한다
 */
function interactionResponder(interaction: RepliableInteraction): Responder {
  const dismiss = onceDismiss(async () => {
    if (interaction.deferred || interaction.replied) return;
    await interaction.reply({ content: icon("play"), flags: MessageFlags.Ephemeral });
    await interaction.deleteReply();
  });

  return {
    async notifyQueued(view: ContainerBuilder) {
      try {
        await postNew(interaction, view, LIFETIME.glance);
      } catch (error) {
        log.error("대기열 안내 전송 실패:", messageOf(error));
      }
    },

    dismissPlaceholder: dismiss,
  };
}

/**
 * 텍스트 채널. 전용 채널과 검색 선택.
 * 자리표시자가 별도 메시지라 안내로 덮어쓸 수 없다 → 안내 전에 먼저 치운다.
 * onDismiss는 진입점이 자기 자리표시자를 삭제하는 방법을 넘긴다.
 */
function channelResponder(channel: GuildTextBasedChannel | null | undefined, onDismiss: (() => unknown) | null = null): Responder {
  const dismiss = onceDismiss(onDismiss);

  return {
    async notifyQueued(view: ContainerBuilder) {
      await dismiss();
      if (!channel || typeof channel.send !== "function") return;
      try {
        scheduleDelete(await channel.send(post(view)));
      } catch (error) {
        log.error("대기열 안내 전송 실패:", messageOf(error));
      }
    },

    dismissPlaceholder: dismiss,
  };
}

/** 디스코드 응답이 없는 경로(대시보드). 결과는 호출자가 HTTP 응답으로 전달한다. */
const silentResponder: Responder = {
  async notifyQueued() {
    /* 알릴 곳이 없다. 결과는 호출자가 HTTP 응답으로 */
  },
  async dismissPlaceholder() {
    /* 자리표시자를 표시하지 않았다 */
  },
};

export { interactionResponder, channelResponder, silentResponder };
export const _internals = { onceDismiss };
