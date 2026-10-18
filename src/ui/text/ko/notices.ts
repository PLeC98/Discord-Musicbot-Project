// 플레이어가 알린 일(player/events 의 notice)을 글자 채널에 보낼 안내. 세부(detail)는 알린 쪽이 준 것

import { noticeOf } from "../notice.ts";
import { escapeMd } from "../../mentions.ts";
import { josa } from "../../../rules/josa.ts";
import { songTitle } from "./labels.ts";

// 저장된 세션의 장르가 장르 목록에서 없어졌다
const autoplayUnknownGenre = (genre: string) => noticeOf("warning", "autoplay", "알 수 없는 장르예요!", `장르 목록이 변경되어 \`${genre}\`${josa(genre, "이")} 없어져서 자동재생을 껐어요. 장르를 다시 선택해 주세요.`);
// 장르의 소스가 모두 키가 없어 못 쓴다
const autoplayGenreUnusable = (genre: string, keys: string) => noticeOf("warning", "autoplay", "지금은 쓸 수 없는 장르예요!", `\`${genre}\` 장르가 쓰는 소스(${keys})의 키가 없어 자동재생을 껐어요. 봇 운영자에게 알려 주세요.`);
const autoplayGaveUp = (genre: string) => noticeOf("warning", "autoplay", `\`${genre}\` 장르에서 틀 곡을 찾지 못해 자동재생을 종료했어요.`);
/** 곡이 연달아 실패해 넘기기를 그만뒀다. left 는 대기열에 남은 곡 수 */
const failedInRow = (count: number, left: number) => noticeOf("error", "failed", `곡 ${count}개 재생에 연달아 실패해서 재생을 중단했어요.`, left > 0 ? `남은 ${left}곡은 대기열에 그대로 있고, 곡을 넣으면 이어서 틀어요.` : undefined);
/** 봇을 다시 켜 저장한 세션을 복원했다 { title, body }. at 은 이어 튼 자리를 말로 적은 것 */
const restored = (title: string | null | undefined, at: string, paused: boolean) => {
  const line = `• **${escapeMd(songTitle(title))}** (${at})`;
  return paused ? { title: "⏸️ 봇이 복구됐어요", body: `마지막 일시정지 상태를 유지할게요.\n${line}` } : { title: "▶️ 봇이 복구됐어요", body: `기록된 마지막 재생 상태를 이어갈게요.\n${line}` };
};

export { autoplayUnknownGenre, autoplayGenreUnusable, autoplayGaveUp, failedInRow, restored };
