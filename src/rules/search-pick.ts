// 검색에서 고른 곡을 가리키는 값. 자동완성 선택지의 값이다(`yt:<영상 id>`, 자동재생 요청 키와 같은 모양).
// 자동완성 값은 사용자가 손으로 칠 수도 있어 모양이 맞을 때만 곡으로 읽고, 아니면 검색어로 둔다

import { youtubeWatchUrl } from "./links.ts";

type SearchPick = { platform: "youtube"; id: string };

const YOUTUBE = /^yt:([\w-]{11})$/;

function pickValue(pick: SearchPick): string {
  return `yt:${pick.id}`;
}

/** 값이 고른 곡의 모양이면 그 곡, 아니면 null */
function readPick(value: string): SearchPick | null {
  const youtube = YOUTUBE.exec(value.trim());
  return youtube ? { platform: "youtube", id: youtube[1] } : null;
}

/** 곡 넣기 코어에 넘길 주소 */
function pickUrl(pick: SearchPick): string {
  return youtubeWatchUrl(pick.id);
}

export { pickValue, readPick, pickUrl };
export type { SearchPick };
