"use strict";

const { MessageFlags } = require("discord.js");
const log = require("./logger").child({ category: "player" });

/**
 * 곡 추가 결과를 사용자에게 알리는 매체별 어댑터.
 *
 * 코어(_processMusic)는 아래 두 메서드만 호출하고 매체를 모른다. 이 경계가 없으면 코어가
 * 표현할 수 있는 출력은 "상호작용 응답" 아니면 "텍스트 채널"뿐이라, "디스코드에 아무것도
 * 보내지 않음"(대시보드)을 표현할 수 없다.
 *
 *   notifyQueued(text)     대기열 추가 안내를 표시한다
 *   dismissPlaceholder()   진입점이 띄운 "검색 중…" 자리표시자를 정리한다 (멱등)
 *
 * 두 메서드 모두 던지지 않는다 — 안내 실패가 재생을 망가뜨리면 안 된다.
 * 실패 경로에서는 코어가 dismissPlaceholder를 부르지 않는다. 진입점이 자리표시자에
 * 오류를 덮어쓸 수 있어야 하기 때문이며, 필요하면 진입점이 직접 부른다.
 */

const AUTO_DELETE_MS = 10000;

// 안내 메시지는 채널에 쌓이지 않게 잠시 뒤 지운다. 이미 지워졌을 수 있으므로 실패는 무시.
function scheduleDelete(message, ms = AUTO_DELETE_MS) {
  if (!message || typeof message.delete !== "function") return;
  setTimeout(() => {
    Promise.resolve(message.delete()).catch(() => {});
  }, ms);
}

// 두 번 불려도 한 번만 실행되는 정리 함수 — 코어와 진입점이 모두 부를 수 있다.
function onceDismiss(fn) {
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    try {
      if (fn) await fn();
    } catch {
      /* 이미 만료/삭제됐을 수 있음 */
    }
  };
}

/**
 * 슬래시 명령 — 자리표시자가 상호작용 응답 그 자체다.
 * 초기 응답이 CV2 컨테이너라 `content`로는 수정할 수 없어(디스코드가 거부) 컨테이너로 보낸다.
 */
function interactionResponder(interaction, embedManager) {
  const dismiss = onceDismiss(async () => {
    if (interaction.deferred || interaction.replied) {
      await interaction.deleteReply();
    } else {
      // 아직 응답하지 않은 상호작용은 조용히 확인만 하고 제거
      await interaction.reply({ content: "▶️", flags: MessageFlags.Ephemeral });
      await interaction.deleteReply();
    }
  });

  return {
    // 자리표시자를 안내 문구로 덮어쓴다 — 별도 메시지를 만들지 않으므로 dismiss가 필요 없다
    async notifyQueued(text) {
      try {
        if (interaction.deferred || interaction.replied) {
          scheduleDelete(
            await interaction.editReply({
              components: [embedManager.createSearchingContainer(text)],
              flags: MessageFlags.IsComponentsV2,
            }),
          );
        } else {
          scheduleDelete(await interaction.reply({ content: text, flags: MessageFlags.Ephemeral }));
        }
      } catch (error) {
        log.error("대기열 안내 전송 실패:", error?.message || error);
      }
    },

    dismissPlaceholder: dismiss,
  };
}

/**
 * 텍스트 채널 — 전용 채널과 검색 선택.
 * 자리표시자가 별도 메시지라 안내로 덮어쓸 수 없다 → 안내 전에 먼저 치운다.
 * onDismiss는 진입점이 자기 자리표시자를 지우는 방법을 넘긴다.
 */
function channelResponder(channel, onDismiss = null) {
  const dismiss = onceDismiss(onDismiss);

  return {
    async notifyQueued(text) {
      await dismiss();
      if (!channel || typeof channel.send !== "function") return;
      try {
        scheduleDelete(await channel.send({ content: text }));
      } catch (error) {
        log.error("대기열 안내 전송 실패:", error?.message || error);
      }
    },

    dismissPlaceholder: dismiss,
  };
}

/** 디스코드 응답이 없는 경로(대시보드) — 결과는 호출자가 HTTP 응답으로 전달한다. */
const silentResponder = {
  async notifyQueued() {},
  async dismissPlaceholder() {},
};

module.exports = { interactionResponder, channelResponder, silentResponder, AUTO_DELETE_MS, _internals: { scheduleDelete, onceDismiss } };
