// 화면에 보내는 플레이어 모양(contract/player)

import type { Request } from "express";
import { QUEUE_PAGE, QUEUE_WINDOW_MAX, type PlayerState, type PlayingView, type QueueTrackView } from "./contract/player.ts";
import type { Player } from "../player/player.ts";
import type { QueuedTrack } from "../player/track.ts";
// 라벨은 임베드와 같은 표에서 나온다. 화면이 따로 들지 않게 서버가 실어 보낸다
import { labelOf } from "../rules/platforms.ts";
import * as genreConfig from "../config/genres.ts";
import { playbackStatus, soundAttached } from "../ui/player-status.ts";

function queueTrack(t: QueuedTrack, i: number): QueueTrackView {
  return {
    index: i,
    // 줄 번호. 빼기 · 옮기기는 순번이 아니라 이것으로 가리킨다(그 사이 대기열이 바뀌어도 그 곡)
    entry: t.entry ?? null,
    title: t.title,
    artist: t.artist,
    duration: t.duration,
    thumbnail: t.thumbnail,
    platform: t.platform,
    platformLabel: labelOf(t.platform),
    autoplay: Boolean(t.autoplay), // 자동재생이 미리 선택해 둔 곡. 화면에서 사용자 곡과 구분한다
    requestedBy: t.requestedBy ? { id: t.requestedBy.id } : null,
  };
}

// 요청의 정수. parseInt와 달리 "50junk"·Infinity·소수를 전부 NaN으로 거부
function toInt(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

// 화면이 이미 펼쳐 둔 만큼을 그대로 돌려줘야 조작 직후 목록이 접히지 않는다. 0 이면 대기열 없이(재생 바처럼 대기열을 안 보는 화면)
function queueWindow(req: Request) {
  if (req.query?.queue === "0") return 0;
  const n = toInt(req.query?.queue);
  if (isNaN(n) || n <= 0) return QUEUE_PAGE;
  return Math.min(n, QUEUE_WINDOW_MAX);
}

// 지금 곡
function playingView(player: Player, track: QueuedTrack): PlayingView {
  return {
    // 줄 번호. 넘기기 · 이동이 보던 곡일 때만 하도록 실어 보낸다
    entry: track.entry ?? null,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    thumbnail: track.thumbnail,
    url: track.pageUrl,
    platform: track.platform,
    platformLabel: labelOf(track.platform),
    isLive: Boolean(player.isLive),
    currentTime: Math.floor((player.getCurrentTime?.() || 0) / 1000),
    requestedBy: track.requestedBy ? { id: track.requestedBy.id } : null,
    // SponsorBlock 자동 스킵 구간(초, 카테고리 포함) + 하이라이트 지점. 대시보드 진행바 마커용
    sponsorSegments: (player.sponsor?.skipSegments || []).map((s) => ({ start: s.start, end: s.end, categories: s.categories || [] })),
    highlightAt: player.sponsor?.highlightAt ?? null,
  };
}

// 만든 순서. 화면이 늦게 온 옛 응답으로 새 상태를 덮지 않게 상태를 만들 때마다 오른다. 서버는 단일 스레드로 돌아
// 나중에 만든 상태가 그 전의 변경을 모두 담는다. boot 는 봇을 다시 시작하면 바뀌어 순서가 처음부터임을 알린다
const BOOT = Date.now();
let made = 0;

function playerState(player: Player | null | undefined, queueLimit = QUEUE_PAGE): PlayerState {
  const order = { boot: BOOT, seq: ++made };
  if (!player) return { ...order, playing: false, paused: false, queue: [], queueTotal: 0, currentTrack: null, hasLive: false };
  const status = playbackStatus(player);
  // 재생이 실제로 시작되기 전(곡 해석/스트림 셋업 중)에는 곡을 노출하지 않는다. 그래야
  // 대시보드가 '재생 중 + 진행바'로 유령 재생을 보여주지 않는다.
  const track = soundAttached(player) ? player.currentTrack : null;
  return {
    ...order,
    playing: status.playing,
    paused: status.paused,
    volume: status.volume,
    loop: status.loop,
    currentTrack: track ? playingView(player, track) : null,
    hasPrevious: (player.previousTracks?.length ?? 0) > 0,
    // 대기열이 비어도 자동재생이 켜져 있으면 넘기기가 된다
    autoplay: Boolean(player.autoplay),
    autoplayGenre: player.autoplay || null,
    autoplayGenreLabel: player.autoplay ? genreConfig.labelOf(player.autoplay) : null,
    // 반복 버튼을 끌지 결정한다. 대기열 창 밖의 곡도 봐야 해서 클라이언트가 목록으로 셀 수 없다.
    hasLive: player.hasLiveTrack?.() ?? false,
    queue: (player.queue || []).slice(0, queueLimit).map(queueTrack),
    queueTotal: player.queue?.length ?? 0,
  };
}

export { queueTrack, queueWindow, playerState, toInt };
