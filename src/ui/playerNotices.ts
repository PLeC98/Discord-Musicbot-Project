// 플레이어가 알린 일(notice)을 그 서버의 글자 채널에 문장으로 보낸다. 플레이어는 무슨 일인지 코드로만 알린다.

import { errorMessage } from "./errorMessages.ts";
import { formatDuration } from "./format.ts";
import * as notices from "./text/notices.ts";
import { scheduleDelete } from "./transientMessages.ts";
import type { Player } from "../player/Player.ts";
import type { Notices, NoticeCode } from "../player/events.ts";

// 코드 → 문장
const TEXT: { [C in NoticeCode]: (detail: Notices[C]) => string } = {
  // 장르 목록이 바뀌기 전에 저장된 세션 등
  "autoplay-unknown-genre": ({ genre }) => notices.autoplayUnknownGenre(genre),
  "autoplay-gave-up": ({ genre }) => notices.autoplayGaveUp(genre),
  // 곡을 못 틀어 다음 곡으로 넘긴다
  "skipped-after-error": ({ error }) => errorMessage(error),
  // 곡이 연달아 실패해 넘기기를 그만뒀다. 대기열은 남아 있다
  "failed-in-row": ({ count, left }) => notices.failedInRow(count, left),
  restored: ({ title, atSec, paused }) => notices.restored(title, formatDuration(atSec), paused),
};

// 잠깐 보이고 지우는 알림
const SHORT_LIVED = new Set(["restored"]);

async function sendNotice<C extends NoticeCode>(player: Pick<Player, "textChannel">, code: C, detail: Notices[C]) {
  const text = TEXT[code]?.(detail);
  if (!text || typeof player.textChannel?.send !== "function") return;
  const sent = await player.textChannel.send(SHORT_LIVED.has(code) ? { content: text } : text);
  if (SHORT_LIVED.has(code)) scheduleDelete(sent);
}

export { sendNotice, TEXT as NOTICE_TEXT };
