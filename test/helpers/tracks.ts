// 테스트용 트랙. 소스가 만드는 모양 그대로 링크 칸 셋(pageUrl · requestKey · audioUrl)을 채운다.
// 스포티파이는 영상을 찾기 전이라 audioUrl 이 없다.

import type { QueuedTrack } from "../../src/player/track.ts";

const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

const youtube = (id: string, extra: Partial<QueuedTrack> = {}): QueuedTrack & { audioUrl: string } => ({ id, title: `곡 ${id}`, artist: "가수", pageUrl: watch(id), requestKey: watch(id), audioUrl: watch(id), platform: "youtube", duration: 180, ...extra });

function spotify(id: string, extra: Partial<QueuedTrack> = {}): QueuedTrack {
  const url = `https://open.spotify.com/track/${id}`;
  return { id, title: "스포티파이 곡", artist: "가수", pageUrl: url, requestKey: url, platform: "spotify", duration: 200, ...extra };
}

const direct = (url: string, extra: Partial<QueuedTrack> = {}): QueuedTrack & { audioUrl: string } => ({ id: url, title: "직접", artist: "직접 링크", pageUrl: url, requestKey: url, audioUrl: url, platform: "direct", duration: 0, ...extra });

export { watch, youtube, spotify, direct };
