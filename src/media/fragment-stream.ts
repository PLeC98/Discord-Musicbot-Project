// 조각으로만 주는 소리를 차례로 받아 흘리는 읽기 스트림.
//
// 무엇을 받을지는 출처(FragmentSource)가 정하고, 여기는 받아 흘리는 일만 한다: 다음 조각을 미리 받아 두고, 멈추거나 5xx · 네트워크 오류면
// 조금 기다렸다 다시 받고, 끝내 못 받거나 4xx 면 오류로 끝난다(재생 쪽이 캐시로 갈아타거나 그 위치부터 다시 연다).
//   유튜브 조각   방송이 끝나고 다시보기를 다 만들기 전(post_live)에 소리를 조각(약 2초)으로만 준다. 조각 주소는 포맷 주소 뒤에 `&sq=번호`이고
//                조각마다 `ftyp` · `moov` 가 붙어 있어 하나씩 풀린다. ffmpeg 는 이어 붙인 것을 파이프로 읽는다(겹친 moov 는 건너뛴다)
//   그 밖        출처가 만든다(직접 링크의 HLS 는 sources/hls)
// 위치 이동은 그 위치가 든 조각부터 받는다. 조각 안의 나머지는 ffmpeg 의 -ss 가 맞춘다(startedAtMs).

import { Readable } from "stream";
import { messageOf } from "../rules/error-kind.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });

const RETRY_DELAYS_MS = [500, 1000, 2000];
const STALL_MS = 10_000; // 조각 하나를 받는 데 이보다 오래 걸리면 끊고 다시 받는다

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 흘릴 조각들. 조각이 무엇인지(F)는 출처만 안다.
 * next 는 차례대로 부른다고 보지 않는다(미리 받기가 앞 조각을 받는 중에 부른다). 출처가 순서를 지킨다
 */
type FragmentSource<F> = {
  /** 다음 조각. 끝이면 null(끝난 뒤에도 null). 라이브는 목록에 새 조각이 나올 때까지 기다린다 */
  next(): Promise<F | null>;
  /** 조각 하나의 바이트. signal 이 끊으면 그만둔다. 다시 받아도 같은 실패면 permanent 를 단 오류 */
  fetch(fragment: F, signal: AbortSignal): Promise<Buffer>;
  /** 곡 안의 어느 위치(ms)부터 흘리나. 받는 첫 조각의 시작 */
  startedAtMs: number;
  /** 지금 상태 한 줄. sent 는 흘린 조각 수 */
  describe(sent: number): string;
  /** 스트림이 닫혔다(라이브 목록 다시 받기를 멈춘다) */
  close?(): void;
};
type StreamOptions = { retryDelaysMs?: number[]; stallMs?: number };
type FragmentStream = Readable & {
  /** 이 스트림이 곡의 어느 위치(ms)부터 흘리나. 받는 첫 조각의 시작 */
  startedAtMs: number;
  /** 입력 상태 한 줄(끊겼을 때 남긴다) */
  describe(): string;
};

/** 다시 받아도 결과가 같은 실패. 4xx(만료 · 차단 · 없는 조각) */
const permanent = (status: number) => Object.assign(new Error(`조각 요청 실패: HTTP ${status}`), { status, permanent: status < 500 });

function streamFragments<F>(source: FragmentSource<F>, { retryDelaysMs = RETRY_DELAYS_MS, stallMs = STALL_MS }: StreamOptions = {}): FragmentStream {
  let sent = 0; // 흘린 조각
  let retries = 0; // 지금까지 다시 받은 횟수(모든 조각)
  let ahead: Promise<Buffer | null> | null = null; // 미리 받는 다음 조각
  let closed = false;

  // 조각 하나. 멈추거나 5xx · 네트워크 오류면 다시 받는다. 4xx 는 곧바로 실패
  async function fetchOne(fragment: F): Promise<Buffer> {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`조각이 ${stallMs / 1000}초 안에 오지 않음`)), stallMs);
      try {
        return await source.fetch(fragment, controller.signal);
      } catch (error) {
        if ((error as { permanent?: boolean }).permanent || attempt >= retryDelaysMs.length || closed) throw error;
        log.trace(`조각 받기 실패(다시 받기 ${attempt + 1}/${retryDelaysMs.length}): ${messageOf(error)}`);
        retries++;
        await sleep(retryDelaysMs[attempt]);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  // 다음 조각을 골라 받는다. 끝이면 null
  async function take(): Promise<Buffer | null> {
    const fragment = await source.next();
    return fragment === null ? null : fetchOne(fragment);
  }

  const stream = new Readable({
    // 소비자가 더 달라고 할 때 한 조각씩 흘린다. 흘리는 동안 다음 조각을 미리 받아 둔다
    read() {
      const current = ahead ?? take();
      ahead = take();
      ahead.catch(() => {
        /* 미리 받는 조각의 실패는 그 조각을 흘릴 차례에 받는다 */
      });
      current.then(
        (chunk) => {
          if (closed) return;
          if (chunk === null) {
            this.push(null);
            return;
          }
          sent++;
          this.push(chunk);
        },
        (error: unknown) => {
          if (!closed) this.destroy(error instanceof Error ? error : new Error(String(error)));
        },
      );
    },
    destroy(error, callback) {
      closed = true;
      source.close?.();
      callback(error);
    },
  });

  return Object.assign(stream, {
    startedAtMs: source.startedAtMs,
    describe: () => `${source.describe(sent)}${retries ? ` · 다시 받음 ${retries}회` : ""}`,
  });
}

// ── 유튜브 조각(&sq=번호) ──

// 요청 함수에서 여기서 부르고 읽는 필드만. 기본은 전역 fetch
type FragmentResponse = { ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> };
type FragmentFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<FragmentResponse>;
/** 조각 목록. 조각 번호의 주소는 base 뒤에 `&sq=번호` */
type Fragments = { base: string; count: number };
type FragmentOptions = StreamOptions & {
  fragments: Fragments;
  /** 곡 전체 길이(ms). 조각 하나의 길이를 어림한다 */
  durationMs: number;
  /** 곡 안의 시작 위치 */
  startMs: number;
  headers?: Record<string, string>;
  fetchImpl?: FragmentFetch;
};

/** 조각 하나의 길이(ms). 전체 길이를 조각 수로 나눈다. 조각마다의 길이는 yt-dlp 도 주지 않는다 */
const fragmentMsOf = ({ count }: Fragments, durationMs: number) => durationMs / count;

/** 이 위치가 든 조각 번호와 그 조각의 시작(ms) */
function startOf(fragments: Fragments, durationMs: number, startMs: number) {
  const each = fragmentMsOf(fragments, durationMs);
  const index = Math.min(fragments.count - 1, Math.max(0, Math.floor(startMs / each)));
  return { index, atMs: Math.round(index * each) };
}

/** 유튜브 조각 목록의 출처. 위치가 든 조각부터 번호 차례로 */
function numberedFragments({ fragments, durationMs, startMs, headers = {}, fetchImpl = fetch as unknown as FragmentFetch }: FragmentOptions): FragmentSource<number> {
  if (!Number.isInteger(fragments.count) || fragments.count <= 0) throw new TypeError(`조각 수가 올바르지 않습니다: ${fragments.count}`);
  const start = startOf(fragments, durationMs, startMs);
  let index = start.index;
  return {
    next: async () => (index < fragments.count ? index++ : null),
    async fetch(sq, signal) {
      const res = await fetchImpl(`${fragments.base}&sq=${sq}`, { headers, signal });
      if (!res.ok) throw permanent(res.status);
      return Buffer.from(await res.arrayBuffer());
    },
    startedAtMs: start.atMs,
    describe: (sent) => `조각 ${start.index + sent}/${fragments.count}(시작 ${start.index})`,
  };
}

/** 유튜브 조각 목록을 흘리는 스트림 */
function createFragmentStream(options: FragmentOptions): FragmentStream {
  return streamFragments(numberedFragments(options), options);
}

export { createFragmentStream, streamFragments, permanent, startOf, fragmentMsOf };
export type { Fragments, FragmentOptions, FragmentSource, FragmentStream, FragmentFetch };
