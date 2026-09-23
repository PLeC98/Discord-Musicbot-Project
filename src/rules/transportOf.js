"use strict";

// 판정: 재생을 어떻게 먹이나. 답: { via: "url" | "pipe" | "file", live, cacheable }.
//   url   ffmpeg 에 주소를 준다. HLS 는 파이프로 먹일 수 없다. 재생목록 안이 상대 경로뿐이라
//         ffmpeg 가 기준 위치를 알아야 하고, 세그먼트도 스스로 받아 와야 한다
//   file  캐시 파일
//   pipe  나머지. 우리가 받아서 흘려 넣는다
// 라이브는 끝이 없어 캐시하지 않는다. 받기 시작하면 파일이 무한히 분다.
// 지금은 HLS 만 주소로 준다(DASH 는 따로 정한다).

/**
 * yt-dlp 가 알려 주는 전송 방식이 HLS 인가. `m3u8`(우리가 받아 합치는 방식)과
 * `m3u8_native`(ffmpeg 에게 맡기는 방식) 둘 다 재생목록이라 주소로 열어야 한다.
 */
function isHlsStream(streamInfo) {
  const protocol = streamInfo && typeof streamInfo === "object" ? streamInfo.protocol : null;
  return typeof protocol === "string" && protocol.startsWith("m3u8");
}

function transportOf({ file, streamUrl, streamInfo }) {
  if (!file && typeof streamUrl === "string" && isHlsStream(streamInfo)) {
    const live = streamInfo?.liveStatus === "is_live";
    return { via: "url", live, cacheable: !live };
  }
  return { via: file ? "file" : "pipe", live: false, cacheable: true };
}

module.exports = { transportOf, isHlsStream };
