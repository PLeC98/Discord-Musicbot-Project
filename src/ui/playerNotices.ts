// 플레이어가 알린 일(notice)을 그 서버의 글자 채널에 응답 틀(ui/frame)로 보낸다. 플레이어는 무슨 일인지 코드로만 알린다.

import type { ContainerBuilder } from "discord.js";
import { errorMessage } from "./errorMessages.ts";
import { formatDuration } from "./format.ts";
import { frame, noticeFrame, post } from "./frame.ts";
import * as notices from "./text/notices.ts";
import { scheduleDelete } from "./transientMessages.ts";
import type { Player } from "../player/Player.ts";
import type { Notices, NoticeCode } from "../player/events.ts";

// 코드 → 화면
const VIEW: { [C in NoticeCode]: (detail: Notices[C]) => ContainerBuilder } = {
  // 장르 목록이 바뀌기 전에 저장된 세션 등
  "autoplay-unknown-genre": ({ genre }) => noticeFrame(notices.autoplayUnknownGenre(genre)),
  "autoplay-gave-up": ({ genre }) => noticeFrame(notices.autoplayGaveUp(genre)),
  // 곡을 못 틀어 다음 곡으로 넘긴다
  "skipped-after-error": ({ error }) => noticeFrame(errorMessage(error)),
  // 곡이 연달아 실패해 넘기기를 그만뒀다. 대기열은 남아 있다
  "failed-in-row": ({ count, left }) => noticeFrame(notices.failedInRow(count, left)),
  restored: ({ title, atSec, paused }) => frame({ body: notices.restored(title, formatDuration(atSec), paused) }),
};

// 잠깐 보이고 지우는 알림
const SHORT_LIVED = new Set(["restored"]);

async function sendNotice<C extends NoticeCode>(player: Pick<Player, "textChannel">, code: C, detail: Notices[C]) {
  const view = VIEW[code]?.(detail);
  if (!view || typeof player.textChannel?.send !== "function") return;
  const sent = await player.textChannel.send(post(view));
  if (SHORT_LIVED.has(code)) scheduleDelete(sent);
}

export { sendNotice };
