// 플레이어가 알린 일(player/events 의 notice)을 글자 채널에 보낼 안내. 세부(detail)는 알린 쪽이 준 것

import { noticeOf } from "../frame.ts";
import { escapeMd } from "../mentions.ts";

const autoplayUnknownGenre = (genre: string) => noticeOf("warning", "autoplay", `자동재생 장르 \`${genre}\`(을)를 찾을 수 없어 자동재생을 껐습니다. \`/autoplay\`로 다시 설정해 주세요.`);
const autoplayGaveUp = (genre: string) => noticeOf("warning", "autoplay", `\`${genre}\` 장르에서 틀 만한 곡을 찾지 못해 자동재생을 껐습니다.`);
/** 곡이 연달아 실패해 넘기기를 그만뒀다. left 는 대기열에 남은 곡 수 */
const failedInRow = (count: number, left: number) => noticeOf("error", "failed", `곡 ${count}개를 연달아 틀지 못해 재생을 멈췄습니다.`, left > 0 ? `남은 ${left}곡은 대기열에 그대로 있고, 곡을 추가하면 이어서 틉니다.` : undefined);
/** 저장한 세션을 되살렸다. at 은 이어 튼 자리를 말로 적은 것 */
const restored = (title: string | undefined, at: string, paused: boolean) => {
  const shown = escapeMd(title || "Unknown");
  return paused ? `⏸️ 일시정지 상태로 복원됨 • **${shown}** (${at})` : `▶️ 음악 재개됨 • **${shown}** (${at})`;
};

export { autoplayUnknownGenre, autoplayGaveUp, failedInRow, restored };
