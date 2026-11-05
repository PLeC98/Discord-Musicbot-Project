// 검색에서 선택한 곡을 가리키는 값. 자동완성 선택지의 값이다(`yt:<영상 id>`, `sp:<곡 id>`, 자동재생 요청 키와 같은 모양).
// 자동완성 값은 사용자가 직접 입력할 수도 있어 모양이 맞을 때만 곡으로 읽고, 아니면 검색어로 둔다

import { youtubeWatchUrl } from "./links.ts";

type SearchPick = { platform: "youtube" | "spotify"; id: string };

const YOUTUBE = /^yt:([\w-]{11})$/;
const SPOTIFY = /^sp:([A-Za-z0-9]{22})$/;

function pickValue(pick: SearchPick): string {
  return `${pick.platform === "spotify" ? "sp" : "yt"}:${pick.id}`;
}

/** 값이 선택한 곡의 모양이면 그 곡, 아니면 null */
function readPick(value: string): SearchPick | null {
  const trimmed = value.trim();
  const youtube = YOUTUBE.exec(trimmed);
  if (youtube) return { platform: "youtube", id: youtube[1] };
  const spotify = SPOTIFY.exec(trimmed);
  return spotify ? { platform: "spotify", id: spotify[1] } : null;
}

/** 곡 넣기 코어에 넘길 주소(스포티파이 곡은 곡 넣기가 유튜브 영상을 찾아 맞춘다) */
function pickUrl(pick: SearchPick): string {
  return pick.platform === "spotify" ? `https://open.spotify.com/track/${pick.id}` : youtubeWatchUrl(pick.id);
}

export { pickValue, readPick, pickUrl };
export type { SearchPick };
