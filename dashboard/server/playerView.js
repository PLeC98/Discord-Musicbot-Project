// 화면에 보내는 플레이어 모양

import platforms from "../../src/ui/platforms.ts";
const { labelOf } = platforms; // 이름표는 임베드와 같은 표에서 나온다. 브라우저는 src/ 를 못 읽는다
import guildAccess from "./guildAccess.js";
const { toInt } = guildAccess;

// 대기열은 앞에서부터 이만큼만 실어 보낸다. 화면이 더 필요하면 ?queue=n으로 늘려 요청한다.
const QUEUE_PAGE = 100;
const QUEUE_WINDOW_MAX = 1000;

function queueTrack(t, i) {
  return {
    index: i,
    title: t.title,
    artist: t.artist,
    duration: t.duration,
    thumbnail: t.thumbnail,
    platform: t.platform,
    platformLabel: labelOf(t.platform),
    autoplay: Boolean(t.autoplay), // 자동재생이 미리 뽑아 둔 곡. 화면에서 사용자 곡과 가른다
    requestedBy: t.requestedBy ? { id: t.requestedBy.id } : null,
  };
}

// 화면이 이미 펼쳐 둔 만큼을 그대로 돌려줘야 조작 직후 목록이 접히지 않는다.
function queueWindow(req) {
  const n = toInt(req.query?.queue);
  if (isNaN(n) || n <= 0) return QUEUE_PAGE;
  return Math.min(n, QUEUE_WINDOW_MAX);
}

function playerState(player, queueLimit = QUEUE_PAGE) {
  if (!player) return { playing: false, paused: false, queue: [], queueTotal: 0, currentTrack: null, hasLive: false };
  const status = player.getStatus();
  // 재생이 실제로 시작되기 전(곡 해석/스트림 셋업 중)에는 곡을 노출하지 않는다. 그래야
  // 대시보드가 '재생 중 + 진행바'로 유령 재생을 보여주지 않는다. isPlaybackActive: 리소스가 물린 상태.
  const track = player.isPlaybackActive() ? player.currentTrack : null;
  return {
    playing: status.playing,
    paused: status.paused,
    volume: status.volume,
    loop: status.loop,
    currentTrack: track
      ? {
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
        }
      : null,
    hasPrevious: (player.previousTracks?.length ?? 0) > 0,
    // 대기열이 비어도 자동재생이 켜져 있으면 넘기기가 된다
    autoplay: Boolean(player.autoplay),
    // 반복 버튼을 끌지 결정한다. 대기열 창 밖의 곡도 봐야 해서 클라이언트가 목록으로 셀 수 없다.
    hasLive: player.hasLiveTrack?.() ?? false,
    queue: (player.queue || []).slice(0, queueLimit).map(queueTrack),
    queueTotal: player.queue?.length ?? 0,
  };
}

const exported = { QUEUE_PAGE, QUEUE_WINDOW_MAX, queueTrack, queueWindow, playerState };
export default exported;
export { exported as "module.exports" };
