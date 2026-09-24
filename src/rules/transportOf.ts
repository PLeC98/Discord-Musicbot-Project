// 판정: 재생을 어떻게 먹이나. 답: { via: "url" | "pipe" | "file", live, cacheable, list? }.
//   url   ffmpeg 에 주소를 준다. 받아서 흘릴 수 없는 것 전부다. HLS 재생목록과 DASH 조각 목록은 안이
//         상대 경로라 ffmpeg 가 기준 위치를 알아야 하고, 조각도 스스로 받아 와야 한다. list 가 어느 목록인지 적는다
//   file  캐시 파일
//   pipe  한 번의 응답이 곧 음원인 것(yt-dlp 의 http · https, 방식을 모르는 직접 링크). 우리가 받아서 흘려 넣는다
// 라이브는 끝이 없어 캐시하지 않는다. 받기 시작하면 파일이 무한히 분다.

/**
 * yt-dlp 가 알려 주는 전송 방식이 HLS 인가. `m3u8`(우리가 받아 합치는 방식)과
 * `m3u8_native`(ffmpeg 에게 맡기는 방식) 둘 다 재생목록이라 주소로 열어야 한다.
 */
type StreamInfo = { protocol?: string | null; liveStatus?: string | null };

function isHlsStream(streamInfo: StreamInfo | null | undefined): boolean {
  const protocol = streamInfo && typeof streamInfo === "object" ? streamInfo.protocol : null;
  return typeof protocol === "string" && protocol.startsWith("m3u8");
}

/** 받아서 파이프로 흘릴 수 있나. 한 번의 HTTP 응답이 곧 음원인 것만 된다. 방식을 모르면 된다고 본다 */
function pipeable(streamInfo: StreamInfo | null | undefined): boolean {
  const protocol = streamInfo && typeof streamInfo === "object" ? streamInfo.protocol : null;
  return typeof protocol !== "string" || protocol === "https" || protocol === "http";
}

// 주소로 여는 것이 어느 목록인가. ffmpeg 에 붙일 옵션과 필요한 능력이 다르다
function listOf(streamInfo: StreamInfo | null | undefined): "hls" | "dash" | "other" {
  if (isHlsStream(streamInfo)) return "hls";
  // 파이프로 못 넘기는 것(protocol 이 글자)만 여기 온다
  return String(streamInfo?.protocol).startsWith("http_dash_segments") ? "dash" : "other";
}

function transportOf({ file, streamUrl, streamInfo }: { file?: string | null; streamUrl?: string | null; streamInfo?: StreamInfo | null }): { via: "url" | "file" | "pipe"; live: boolean; cacheable: boolean; list?: "hls" | "dash" | "other" } {
  if (!file && typeof streamUrl === "string" && !pipeable(streamInfo)) {
    const live = streamInfo?.liveStatus === "is_live";
    return { via: "url", live, cacheable: !live, list: listOf(streamInfo) };
  }
  return { via: file ? "file" : "pipe", live: false, cacheable: true };
}

export { transportOf, isHlsStream };
