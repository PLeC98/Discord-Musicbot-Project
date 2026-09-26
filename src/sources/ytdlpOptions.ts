// yt-dlp 의 공통 옵션. 어느 출처에나 붙는 것만 둔다. 출처 전용(유튜브의 JS 런타임 · POToken 플러그인 · 쿠키)은 그 출처가 얹는다.

import type { YtDlpFlags as Flags } from "./ytdlpSpawn.ts";

// yt-dlp 에 줄 ffmpeg 경로. 재생과 같은 바이너리를 쓰게 조립(app/main)이 넘긴다(useFfmpeg). 안 넘기면 yt-dlp 가 PATH 에서 찾는다
let ffmpegLocation: () => string | null = () => null;

/** locate: ffmpeg 경로를 돌려주는 함수(media/ffmpeg/path 의 ffmpegPath) */
function useFfmpeg(locate: () => string | null) {
  ffmpegLocation = locate;
}

/**
 * 공통 옵션 위에 extra 를 얹는다(extra 가 이긴다).
 * noWarnings 를 켜지 않는다. yt-dlp 의 경고에는 봐야 할 것이 섞여 있다(유튜브의 POToken 요구 · 사운드클라우드의 지역 제한 등). ERROR 는 이 옵션과 무관하다.
 */
function baseOptions(extra: Flags = {}): Flags {
  const ffmpeg = ffmpegLocation();
  return {
    retries: 3,
    fragmentRetries: 3,
    // 재생과 같은 ffmpeg 를 쓰게 한다. 지정하지 않으면 yt-dlp 가 PATH 에서 제멋대로 찾아
    // 재생(ffmpegPath 해석기)과 캐시 변환이 서로 다른 바이너리를 쓰게 된다.
    ...(ffmpeg ? { ffmpegLocation: ffmpeg } : {}),
    ...extra,
  };
}

export { useFfmpeg, baseOptions };
