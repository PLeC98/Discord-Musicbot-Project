// 로그인 배경의 능동 조절(정함: 계획서 18단계 "고르는 규칙 · 능동 조절", research §11.8). 값은 목업(gallery/adaptive-bg.ts)의 것이고 A8(A32 에서 앱을 자주 오가며)에서 다듬는다.
// 재기: 4초 창마다 영상이 화면에 낸 장면(requestVideoFrameCallback 의 presentedFrames) · 버린 장면을 잰다. 화면 주사율은 보지 않는다(크롬은 영상만 바뀌는 화면이면 주사율을 영상에 맞춰 내린다).
//      성능은 최근 세 창(약 12초)을 합쳐 본다: 낸 장면이 초당 장면 수의 85% 아래거나 버린 장면이 2% 넘으면 나쁨. 한 창에서 버린 장면이 10% 넘으면 바로 내린다.
//      화면 숨김 · 멈춤 · 기다림이 낀 창은 성능으로 치지 않고, 돌아오거나 다시 재생된 뒤 5초는 재지 않으며 그동안의 기다림은 통신으로 치지 않는다.
// 조절: 나쁨이면 한 칸 내리고, 좋음이 60초 이어지면 한 칸 올려 시험한다. 올린 뒤 두 창 안에 나쁨이면 되돌리고 다음 시험까지 두 배로 기다린다(최대 8분).
//      30초 버틴 칸을 기기에 기억해 다음 방문의 시작점으로만 쓴다.
// 통신: VP9 · AV1 목록에는 1080p 아래가 없어 hls.js 가 더 내릴 곳이 없으니, 받아 둔 영상이 바닥난 기다림(되감는 순간 빼고)이 30초에 세 번이고
//      hls.js 의 통신 어림이 지금 단계 2초 최대의 1.3배에 못 미치면 H.264 720p 로 옮긴다

/** 한 창의 잰 값. rate 는 화면에 낸 장면(초당) */
type Window = { rate: number; dropped: number; decoded: number };
type Adapter = {
  /** 받아 둔 영상이 바닥나 기다렸다(waiting · stalled · hls.js 의 버퍼 경고) */
  waited(): void;
  /** 화면 숨김 · 보임, 멈춤 · 다시 재생 */
  hidden(on: boolean): void;
  paused(on: boolean): void;
  stop(): void;
};
type AdapterDeps = {
  /** 지금 영상(정지 그림 칸이면 null) */
  video: () => HTMLVideoElement | null;
  /** 지금 칸 · 칸 수 · H.264 칸(없으면 -1) */
  index: () => number;
  count: number;
  h264At: number;
  /** 그 칸으로 */
  go: (index: number) => void;
  /** 지금 단계의 2초 최대와 hls.js 의 통신 어림(bps, 모르면 0) */
  network: () => { peak: number; bandwidth: number };
  /** 30초 버틴 칸 */
  remember: (index: number) => void;
  /** 영상의 초당 장면 수 */
  fps: number;
};

const SPAN_MS = 4000;
const LIMIT = { rateRatio: 0.85, dropped: 0.02, severe: 0.1 };
const UP = { first: 60_000, max: 480_000, settle: 30_000 };
const NET = { window: 30_000, count: 3, ahead: 0.5, headroom: 1.3 };
const RESUME_GRACE = 5000;
const RECENT = 3;
/** 칸을 바꾼 뒤 재지 않는 시간(새 단계를 받아 처음 그리는 동안) */
const ENTER_GRACE = 2000;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** 다음 장면이 화면에 나올 때의 (시각, 화면에 낸 장면 수). 0.5초 안에 안 나오면 null */
function nextPresented(video: HTMLVideoElement): Promise<{ now: number; presented: number } | null> {
  return new Promise((done) => {
    const timer = setTimeout(() => done(null), 500);
    video.requestVideoFrameCallback((now, meta) => {
      clearTimeout(timer);
      done({ now, presented: meta.presentedFrames });
    });
  });
}

/** SPAN 동안 영상이 화면에 낸 장면 · 버린 장면을 잰다 */
async function sample(video: HTMLVideoElement): Promise<Window> {
  const rvfc = "requestVideoFrameCallback" in video;
  const q0 = video.getVideoPlaybackQuality();
  const t0 = performance.now();
  const first = rvfc ? await nextPresented(video) : null;
  await sleep(SPAN_MS);
  const last = rvfc ? await nextPresented(video) : null;
  const q1 = video.getVideoPlaybackQuality();
  const dropped = q1.droppedVideoFrames - q0.droppedVideoFrames;
  const decoded = q1.totalVideoFrames - q0.totalVideoFrames;
  // requestVideoFrameCallback 이 없으면 푼 장면에서 버린 장면을 뺀 것으로 어림한다
  const rate = rvfc ? (first && last && last.now > first.now ? ((last.presented - first.presented) * 1000) / (last.now - first.now) : 0) : ((decoded - dropped) * 1000) / (performance.now() - t0);
  return { rate, dropped, decoded };
}

/** 최근 창들을 합쳐 좋음인지 */
function goodOf(recent: Window[], fps: number): boolean {
  const dropped = recent.reduce((sum, one) => sum + one.dropped, 0);
  const decoded = recent.reduce((sum, one) => sum + one.decoded, 0);
  const rate = recent.reduce((sum, one) => sum + one.rate, 0) / Math.max(1, recent.length);
  return rate >= fps * LIMIT.rateRatio && (decoded === 0 || dropped / decoded <= LIMIT.dropped);
}

/** 재생 위치 앞에 받아 둔 영상(초) */
function bufferedAhead(video: HTMLVideoElement) {
  const t = video.currentTime;
  for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= t + 0.1 && t < video.buffered.end(i)) return video.buffered.end(i) - t;
  return 0;
}

function startAdapter(deps: AdapterDeps): Adapter {
  let running = true;
  const interrupts = { hidden: 0, paused: 0, waits: 0 };
  let resumedAt = performance.now();
  let waitTimes: number[] = [];
  let enteredAt = performance.now();
  let lastIndex = deps.index();
  let goodSince = performance.now();
  let probation = 0;
  let upWait = UP.first;
  let recent: Window[] = [];
  let remembered = -1;

  const go = (index: number) => {
    deps.go(index);
    enteredAt = performance.now();
    goodSince = enteredAt;
  };
  // 통신이 못 따라가면 H.264 720p 로. 올려 시험하던 중이면 되돌림으로 치고 다음 시험을 미룬다
  const network = () => {
    const now = performance.now();
    waitTimes = waitTimes.filter((t) => now - t < NET.window);
    if (waitTimes.length < NET.count || deps.h264At < 0 || deps.index() >= deps.h264At) return false;
    const { peak, bandwidth } = deps.network();
    waitTimes = [];
    // 통신 어림이 넉넉하면 통신 탓이 아니다(어림이 아직 없으면 0 이라 옮긴다)
    if (peak && bandwidth >= peak * NET.headroom) return false;
    if (probation > 0) {
      upWait = Math.min(upWait * 2, UP.max);
      probation = 0;
    }
    go(deps.h264At);
    return true;
  };

  /** 잰 창 하나로 정한다. 칸을 옮겼으면 참 */
  const decide = (at: number, got: Window) => {
    const now = performance.now();
    recent = [...recent.slice(-(RECENT - 1)), got];
    const good = goodOf(recent, deps.fps);
    const severe = got.decoded > 0 && got.dropped / got.decoded > LIMIT.severe;
    if (!good) goodSince = now;
    const last = deps.count - 1;
    // 올려 시험하는 중에 나쁨이면 되돌리고 다음 시험을 미룬다
    if (probation > 0) {
      probation--;
      if (!good && recent.length >= 2) {
        upWait = Math.min(upWait * 2, UP.max);
        probation = 0;
        go(Math.min(at + 1, last));
        return true;
      }
    }
    if ((severe || (!good && recent.length >= RECENT)) && at < last) {
      go(at + 1);
      return true;
    }
    if (good && at > 0 && now - goodSince >= upWait) {
      go(at - 1);
      probation = RECENT;
      return true;
    }
    if (now - enteredAt >= UP.settle && remembered !== at) {
      remembered = at;
      deps.remember(at);
    }
    return false;
  };
  /** 지금은 재지 않는다(정지 그림 · 숨김 · 멈춤 · 칸을 바꾼 직후 · 돌아온 직후) */
  const resting = (video: HTMLVideoElement | null): video is null => {
    const now = performance.now();
    return !video || document.hidden || video.paused || now - enteredAt < ENTER_GRACE || now - resumedAt < RESUME_GRACE;
  };

  void (async () => {
    while (running) {
      const video = deps.video();
      if (deps.index() !== lastIndex) {
        lastIndex = deps.index();
        recent = [];
      }
      if (resting(video)) {
        await sleep(250);
        continue;
      }
      if (network()) continue;
      const at = deps.index();
      const before = { ...interrupts };
      const got = await sample(video);
      if (!running) return;
      if (at !== deps.index() || network()) continue;
      // 화면 숨김 · 멈춤 · 기다림이 낀 창은 성능으로 치지 않는다
      if (before.hidden !== interrupts.hidden || before.paused !== interrupts.paused || before.waits !== interrupts.waits) continue;
      decide(at, got);
    }
  })();

  return {
    waited() {
      interrupts.waits++;
      const video = deps.video();
      const now = performance.now();
      if (video && video.currentTime > 0.3 && now - resumedAt > RESUME_GRACE && bufferedAhead(video) < NET.ahead) waitTimes.push(now);
    },
    hidden(on) {
      interrupts.hidden++;
      resumedAt = on ? Infinity : performance.now();
    },
    paused(on) {
      interrupts.paused++;
      resumedAt = on ? Infinity : performance.now();
    },
    stop() {
      running = false;
    },
  };
}

export { goodOf, startAdapter };
export type { Adapter, AdapterDeps, Window };
