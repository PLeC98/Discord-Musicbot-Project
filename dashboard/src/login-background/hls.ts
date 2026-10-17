// 로그인 배경의 HLS 재생. 코덱 하나의 목록을 틀고, 해상도는 hls.js 가 화면 크기 × 배율(capLevelToPlayerSize) · 통신으로 고른다. 우리는 짧은 변 상한만 건다.
// 버린 장면으로 내리기는 우리 조절(adapt.ts)이 맡는다(hls.js 의 capLevelOnFPSDrop 은 5초에 20% 넘게 버려야 내리고 그 재생 내내 그대로라 끈다).
// hls.js 는 영상 배경일 때만 불러온다. MSE 가 없고 HLS 를 바로 트는 브라우저는 브라우저에 맡긴다(상한을 걸 수 없다)

/** 지금 단계의 짧은 변 · 통신 어림(bps) */
type HlsInfo = { short: number; bandwidth: number };
/** fatal: 멈추는 오류(목록 · 조각을 못 받음 · 풀지 못함). 받기 오류면 load 가 참(배경이 바뀌었을 수 있다) */
type HlsEvents = { onFatal: (failure: { load: boolean }) => void; onStall: () => void };
type HlsPlayer = { cap(short: number | null): void; destroy(): void; info: HlsInfo };

/** MSE 로 틀 수 있는가(아니면 브라우저가 HLS 를 바로 트는지 본다) */
const hasMse = () => typeof window.MediaSource !== "undefined" || "ManagedMediaSource" in window;
const nativeHls = (video: HTMLVideoElement) => video.canPlayType("application/vnd.apple.mpegurl") !== "";

/** alive: 불러오는 사이 다른 것으로 바뀌었는지(바뀌었으면 붙이지 않는다) */
async function playHls(video: HTMLVideoElement, url: string, cap: number | null, alive: () => boolean, events: HlsEvents): Promise<HlsPlayer> {
  const info: HlsInfo = { short: 0, bandwidth: 0 };
  // 가벼운 판: 자막 · 다른 오디오 · DRM 을 뺀 것(영상만인 fMP4 목록이라 쓰지 않는다)
  const { default: Hls } = await import("hls.js/light");
  if (!alive())
    return {
      info,
      cap() {
        // 붙이지 않았다
      },
      destroy() {
        // 붙이지 않았다
      },
    };
  if (!Hls.isSupported()) {
    video.src = url;
    const onError = () => events.onFatal({ load: true });
    video.addEventListener("error", onError);
    return {
      info,
      cap() {
        // 브라우저가 바로 틀면 상한을 걸 수 없다
      },
      destroy() {
        video.removeEventListener("error", onError);
        video.removeAttribute("src");
        video.load();
      },
    };
  }
  // 작업자(worker)는 쓰지 않는다: 목록이 fMP4 라 바꿀 것이 없고, 쓰면 CSP 에 worker-src blob: 을 열어야 한다
  const hls = new Hls({ capLevelOnFPSDrop: false, capLevelToPlayerSize: true, startLevel: -1, maxBufferLength: 12, enableWorker: false });
  const shortOf = (level: { width: number; height: number }) => Math.min(level.width, level.height);
  /** 짧은 변이 cap 이하인 것 중 가장 높은 단계로 상한을 건다(null 이면 화면 크기에 맡긴다) */
  const setCap = (short: number | null) => {
    if (short === null) {
      hls.autoLevelCapping = -1;
      hls.capLevelToPlayerSize = true;
      return;
    }
    hls.capLevelToPlayerSize = false;
    let best = -1;
    hls.levels.forEach((level, i) => {
      if (shortOf(level) <= short && (best < 0 || shortOf(level) > shortOf(hls.levels[best]))) best = i;
    });
    hls.autoLevelCapping = best;
  };
  hls.on(Hls.Events.MANIFEST_PARSED, () => setCap(cap));
  hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
    const level = hls.levels[data.level];
    info.short = level ? shortOf(level) : 0;
  });
  hls.on(Hls.Events.FRAG_LOADED, () => (info.bandwidth = hls.bandwidthEstimate));
  hls.on(Hls.Events.ERROR, (_event, data) => {
    // 되감는 순간 가끔 내는 버퍼 경고는 재생이 이어진다(기다림으로만 센다)
    if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) events.onStall();
    if (!data.fatal) return;
    events.onFatal({ load: data.type === Hls.ErrorTypes.NETWORK_ERROR });
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  return { info, cap: setCap, destroy: () => hls.destroy() };
}

export { hasMse, nativeHls, playHls };
export type { HlsInfo, HlsPlayer };
