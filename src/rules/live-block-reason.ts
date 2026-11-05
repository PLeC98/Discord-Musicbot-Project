// 판정: 이 곡을 대기열에 넣어도 되나. 넣을 수 없으면 까닭의 이름, 넣을 수 있으면 null.
// 시작 전 라이브(예정된 방송, 최초 공개)는 막지 않는다. 틀 차례에 아직 시작 전이면 그때 알리고 넘긴다(live-upcoming)
//   live-no-ffmpeg  라이브를 틀 ffmpeg 능력(https, HLS)이 없다. ffmpeg 에 주소를 주는 라이브(유튜브)만 확인한다.
//                   직접 링크의 라이브(인터넷 라디오, HLS)는 우리가 받아 파이프로 넣어 그 능력이 없어도 튼다
// ffmpegReady 는 부르는 쪽이 넘긴다(확인이 필요할 때만 부른다. 처음 한 번은 ffmpeg 를 실제로 실행해 본다).

import { inputKind } from "./input-kind.ts";

function liveBlockReason(track: { isLive?: boolean; liveStatus?: string | null; audioUrl?: string | null } | null | undefined, { ffmpegReady }: { ffmpegReady: () => boolean }): "live-no-ffmpeg" | null {
  if (!track?.isLive) return null;
  if (inputKind(track.audioUrl) === "direct") return null;
  return ffmpegReady() ? null : "live-no-ffmpeg";
}

export { liveBlockReason };
