// 재생용 ffmpeg 인자.

import path from "./path.js";
const { capabilities } = path;

// HLS 세그먼트 하나가 실패하면 기본값(0)으로는 재시도 없이 스트림이 죽는다.
const SEG_MAX_RETRY = 5;

/**
 * 재생용 ffmpeg 인자 구성. 출력 대상(`pipe:1`)까지 포함한 완전한 인자를 돌려준다.
 *
 * 입력은 셋 중 하나다.
 *  - `file`: 캐시 파일. `-ss`는 `-i` 앞(seek 가능해 빠름)
 *  - `url`: 받아서 흘릴 수 없는 목록(HLS · DASH). "받아 둔 바이트"가 아니라 "받아 올 주소"를 줘야 열린다
 *  - 둘 다 없으면 `pipe:0`: 그 밖의 모든 스트리밍. `-ss`는 `-i` 뒤여야 한다
 *    (pipe에서 입력측 `-ss`는 출력을 잘라먹는다)
 *
 * URL을 주는 것은 목록에 한한다. 나머지를 URL로 열면 yt-dlp가 준 httpHeaders가 빠지고,
 * 스트리밍 실패 폴백을 건너뛰며, 재생이 ffmpeg 빌드의 네트워크 스택에 의존하게 된다.
 *
 * caps: ffmpeg 능력(주소 갈래만 본다). 생략하면 진짜. hls: 주소가 HLS 재생목록인가(세그먼트 재시도는 HLS 옵션이다)
 * @param {{file?: string|null, url?: string|null, hls?: boolean, seekMs?: number, caps?: object|null}} opts
 */
function buildFfmpegArgs({ file = null, url = null, hls = true, seekMs = 0, caps = null } = {}) {
  const seek = seekMs > 0 ? ["-ss", (Number(seekMs) / 1000).toFixed(3)] : [];
  const output = ["-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"];

  if (url) {
    // 잔끊김은 ffmpeg 안에서 흡수시키고 우리 재시도는 진짜 실패에만 돌게 나눈다.
    // `-reconnect_at_eof`는 켜지 않는다. 라이브에서 EOF는 "방송이 끝났다"인데, 켜면
    // 오류로 보고 무한히 다시 붙는다.
    const reconnect = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1"];
    // HLS 디먹서의 옵션이고 오래된 빌드에는 없다. ffmpeg는 모르는 옵션을 치명적 오류로 보므로 확인하고 붙인다.
    const retry = hls && (caps ?? capabilities()).segMaxRetry ? ["-seg_max_retry", String(SEG_MAX_RETRY)] : [];
    return [...reconnect, ...retry, "-analyzeduration", "0", "-loglevel", "error", ...seek, "-i", url, ...output];
  }

  return file ? [...seek, "-i", file, "-analyzeduration", "0", "-loglevel", "error", ...output] : ["-analyzeduration", "0", "-loglevel", "error", "-i", "pipe:0", ...seek, ...output];
}

const exported = { buildFfmpegArgs };
export default exported;
export { exported as "module.exports" };
