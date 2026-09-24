// 플레이어가 알린 일(notice)을 그 서버의 글자 채널에 문장으로 보낸다. 플레이어는 무슨 일인지 코드로만 알린다.

import { ErrorHandler } from "./errorMessages.ts";
import { formatDuration } from "./format.ts";
import { escapeMd } from "./mentions.ts";
import { scheduleDelete } from "./transientMessages.ts";
import type { MusicPlayer } from "../player/Player.ts";
import type { Notices, NoticeCode } from "../player/events.ts";

// 코드 → 문장. 세부(detail)는 알린 쪽이 준 것
const TEXT: { [C in NoticeCode]: (detail: Notices[C]) => string } = {
  // 장르 목록이 바뀌기 전에 저장된 세션 등
  "autoplay-unknown-genre": ({ genre }) => `❌ 자동재생 장르 \`${genre}\`(을)를 찾을 수 없어 자동재생을 껐습니다. \`/autoplay\`로 다시 설정해 주세요.`,
  "autoplay-gave-up": ({ genre }) => `⏹️ \`${genre}\` 장르에서 틀 만한 곡을 찾지 못해 자동재생을 껐습니다.`,
  // 곡을 못 틀어 다음 곡으로 넘긴다
  "skipped-after-error": ({ error }) => ErrorHandler.getMessage(error),
  restored: ({ title, atSec, paused }) => {
    const shown = escapeMd(title || "Unknown");
    const at = formatDuration(atSec);
    return paused ? `⏸️ 일시정지 상태로 복원됨 • **${shown}** (${at})` : `▶️ 음악 재개됨 • **${shown}** (${at})`;
  },
};

// 잠깐 보이고 지우는 알림
const SHORT_LIVED = new Set(["restored"]);

async function sendNotice<C extends NoticeCode>(player: Pick<MusicPlayer, "textChannel">, code: C, detail: Notices[C]) {
  const text = TEXT[code]?.(detail);
  if (!text || typeof player.textChannel?.send !== "function") return;
  const sent = await player.textChannel.send(SHORT_LIVED.has(code) ? { content: text } : text);
  if (SHORT_LIVED.has(code)) scheduleDelete(sent);
}

export { sendNotice, TEXT as NOTICE_TEXT };
