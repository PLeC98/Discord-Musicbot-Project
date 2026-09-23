"use strict";

// 판정: 이 곡을 대기열에 넣어도 되나. 넣을 수 없으면 까닭의 이름, 넣을 수 있으면 null.
//   live-upcoming   예정된 라이브. 아직 소리가 없어 열어 봐야 받을 것이 없다
//   live-no-ffmpeg  라이브를 틀 ffmpeg 능력이 없다
// ffmpegReady 는 부르는 쪽이 넘긴다(라이브 곡일 때만 부른다. 처음 한 번은 ffmpeg 를 실제로 띄워 본다).

function liveBlockReason(track, { ffmpegReady }) {
  if (!track?.isLive) return null;
  if (track.liveStatus !== "is_live") return "live-upcoming";
  return ffmpegReady() ? null : "live-no-ffmpeg";
}

module.exports = { liveBlockReason };
