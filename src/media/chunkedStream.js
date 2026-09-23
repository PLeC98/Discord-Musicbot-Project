// Range 요청으로 나눠 받는 읽기 스트림.
//
// googlevideo는 순차 GET을 재생 속도의 약 2배로 조이고(Range는 우회한다), 재생 속도 이하로 읽히는
// 연결은 수십 초 안에 리셋한다. 그래서 청크 본문은 최대 속도로 받아 두고 공급만 소비 속도에 맞춘다.
// 끊기면 onInterrupt에 먼저 묻고(호출부가 캐시로 넘겨받을 수 있다), 아니면 받은 위치부터 이어받는다.

import { Readable } from "stream";

const RETRY_DELAYS_MS = [500, 1000, 2000];
const STALL_MS = 10_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 다시 요청해도 결과가 같은 실패. 4xx(만료·차단)와 구간 어긋남
function permanent(message) {
  return Object.assign(new Error(message), { permanent: true });
}

function httpError(status) {
  const message = `Range 요청 실패: HTTP ${status}`;
  return status >= 500 ? Object.assign(new Error(message), { status }) : Object.assign(permanent(message), { status });
}

/**
 * @param {string}   url          받을 주소 (서명된 미디어 URL)
 * @param {object}   headers      yt-dlp가 준 요청 헤더
 * @param {number}   totalBytes   전체 길이. googlevideo는 URL의 clen 파라미터로 준다
 * @param {number}   chunkSize    요청 하나의 크기 = 미리 받아 두는 양의 단위
 * @param {(err: Error) => boolean} [onInterrupt]
 *   재생이 시작된 뒤 끊겼을 때 한 번 부른다. true면 호출부가 넘겨받은 것. 이어받지 않고 받아 둔 데까지 내보낸 뒤 끝낸다.
 * @param {(info: {attempts: number, downtimeMs: number, starvedMs: number}) => void} [onResumed]
 *   끊긴 뒤 다시 받기 시작했을 때. starvedMs는 그동안 내보낼 것이 없어 소비자가 기다린 시간이다.
 * @param {Function} fetchImpl    테스트 주입용. 기본은 전역 fetch
 * @returns {Readable}
 */
function createChunkedStream({ url, headers = {}, totalBytes, chunkSize, onInterrupt = null, onResumed = null, fetchImpl = fetch, retryDelaysMs = RETRY_DELAYS_MS, stallMs = STALL_MS }) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) throw new TypeError(`totalBytes가 올바르지 않습니다: ${totalBytes}`);
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) throw new TypeError(`chunkSize가 올바르지 않습니다: ${chunkSize}`);

  // 남은 양이 이 아래로 떨어지면 다음 청크를 받는다
  const lowWater = Math.max(1, Math.floor(chunkSize / 4));

  let pos = 0; // 받은 바이트 = 다음 요청의 시작 위치
  let target = 0; // 지금 받는 청크의 끝(미포함)
  const queue = [];
  let queued = 0;
  let wanting = false;
  let fetching = false;
  let ended = false;
  let handedOff = false;
  let aborter = null;
  let stallTimer = null;
  let wakeRoom = null;

  let primed = false;
  let settleReady = null;
  let ready = null;

  let failures = 0; // 연속 실패. 바이트를 받으면 0
  let interruptedAt = 0;
  let starvedSince = 0;

  let requests = 0;
  let chunkStart = 0;
  let openedAt = 0;
  let lastReadAt = 0;

  const stream = new Readable({
    read() {
      wanting = true;
      drain();
    },
    destroy(err, cb) {
      clearTimeout(stallTimer);
      aborter?.abort();
      wakeRoom?.();
      cb(err);
    },
  });

  function drain() {
    while (wanting && queue.length > 0 && !stream.destroyed) {
      const chunk = queue.shift();
      queued -= chunk.length;
      wanting = stream.push(chunk);
    }
    if (wakeRoom && queued < chunkSize) {
      wakeRoom();
      wakeRoom = null;
    }
    if (stream.destroyed || ended) return;
    if (queue.length === 0 && !fetching && (handedOff || pos >= totalBytes)) {
      ended = true;
      stream.push(null);
      return;
    }
    if (wanting && queue.length === 0 && interruptedAt && !starvedSince) starvedSince = Date.now();
    if (!fetching && !handedOff && pos < totalBytes && queued < lowWater) fill();
  }

  // Content-Range: "bytes <start>-<end>/<total>". 프록시가 엉뚱한 구간을 주면 여기서 잡는다.
  function assertRangeStart(res, expected) {
    const cr = res.headers.get?.("content-range");
    if (!cr) return;
    const start = Number(/bytes\s+(\d+)-/i.exec(cr)?.[1]);
    if (Number.isFinite(start) && start !== expected) {
      throw permanent(`Range 응답이 어긋납니다: ${expected}을 요청했는데 ${cr}`);
    }
  }

  function armStall() {
    clearTimeout(stallTimer);
    const request = aborter;
    stallTimer = setTimeout(() => request?.abort(Object.assign(new Error(`${stallMs / 1000}초 동안 받은 데이터가 없습니다`), { code: "STREAM_STALL" })), stallMs);
    stallTimer.unref?.();
  }

  function resumed(attempts) {
    const now = Date.now();
    const info = { attempts, downtimeMs: now - interruptedAt, starvedMs: starvedSince ? now - starvedSince : 0 };
    interruptedAt = 0;
    starvedSince = 0;
    onResumed?.(info);
  }

  async function receive() {
    aborter = new AbortController();
    requests++;
    chunkStart = pos;
    openedAt = lastReadAt = Date.now();
    armStall();
    try {
      const res = await fetchImpl(url, { headers: { ...headers, Range: `bytes=${pos}-${target - 1}` }, signal: aborter.signal });

      if (res.status === 206) {
        assertRangeStart(res, pos);
      } else if (res.status === 200 && pos === 0) {
        // Range를 무시했다. 첫 요청이면 본문이 곧 전체 파일이다(조임은 못 피해도 재생은 된다)
        target = totalBytes;
      } else {
        throw httpError(res.status);
      }
      if (!res.body) throw permanent("응답 본문이 없습니다");

      if (!primed) {
        primed = true;
        settleReady?.(null);
      }

      const reader = res.body.getReader();
      while (pos < target) {
        if (queued >= chunkSize + lowWater) {
          // Range를 무시한 200 응답에서만 걸린다. 파일 전체를 메모리에 올리지 않도록
          clearTimeout(stallTimer);
          await new Promise((resolve) => (wakeRoom = resolve));
          if (stream.destroyed) return;
          armStall();
        }
        const { done, value } = await reader.read();
        if (done) break;
        queue.push(Buffer.from(value));
        queued += value.length;
        pos += value.length;
        lastReadAt = Date.now();
        armStall();
        if (interruptedAt) resumed(failures);
        failures = 0;
        drain();
      }
      if (pos < target) throw new Error(`응답이 일찍 끝났습니다 (${pos}/${target}B)`);
    } catch (err) {
      aborter?.abort(); // 버린 요청이 열린 채 남지 않게
      throw err;
    } finally {
      clearTimeout(stallTimer);
      aborter = null;
    }
  }

  async function fill() {
    fetching = true;
    target = Math.min(pos + chunkSize, totalBytes);
    try {
      for (;;) {
        try {
          await receive();
          return;
        } catch (err) {
          if (stream.destroyed) return;
          if (primed && !interruptedAt) {
            interruptedAt = Date.now();
            if (onInterrupt?.(err)) {
              handedOff = true;
              return;
            }
          }
          if (err.permanent || failures >= retryDelaysMs.length) throw err;
          await sleep(retryDelaysMs[failures++]);
          if (stream.destroyed) return;
        }
      }
    } catch (err) {
      settleReady?.(err);
      stream.destroy(err);
    } finally {
      fetching = false;
      drain();
    }
  }

  // 첫 요청을 미리 걸고 성패를 기다린다. 호출부가 기존 fetch와 같은 자리에서 실패를 잡도록.
  stream.prime = () => {
    if (!ready) {
      ready = new Promise((resolve, reject) => {
        settleReady = (err) => {
          settleReady = null;
          if (err) reject(err);
          else resolve();
        };
      });
      if (primed) settleReady(null);
      else if (!fetching) fill();
    }
    return ready;
  };

  const expire = Number(new URL(url, "http://_").searchParams.get("expire"));
  stream.stats = () => {
    const now = Date.now();
    return {
      requests,
      received: pos,
      totalBytes,
      queued,
      chunkStart,
      chunkReceived: pos - chunkStart,
      sinceOpenMs: openedAt ? now - openedAt : null,
      idleMs: lastReadAt ? now - lastReadAt : null,
      expiresInS: expire > 0 ? expire - Math.floor(now / 1000) : null,
    };
  };
  return stream;
}

/**
 * createChunkedStream + 첫 요청 대기. 실패하면 여기서 던지므로 호출부의 폴백이 그대로 동작한다.
 */
async function openChunkedStream(opts) {
  const stream = createChunkedStream(opts);
  // 오류는 prime()의 거부로도 전달된다. 듣는 사람 없는 error 이벤트가 uncaughtException이 되는 것만 막는다.
  // 호출부는 여전히 자기 on("error")를 붙여야 한다.
  stream.on("error", () => {});
  try {
    await stream.prime();
  } catch (err) {
    stream.destroy();
    throw err;
  }
  return stream;
}

// googlevideo URL은 전체 길이를 clen 파라미터로 들고 있다. 값이 없으면(라이브 스트림 등) null.
function contentLengthFromUrl(url) {
  try {
    const clen = Number(new URL(url).searchParams.get("clen"));
    return Number.isFinite(clen) && clen > 0 ? clen : null;
  } catch {
    return null;
  }
}

// undici fetch는 소켓 오류를 "terminated"로 감싸고 진짜 사유는 cause에 둔다
function describeStreamError(err) {
  const parts = [];
  for (let e = err, depth = 0; e != null && depth < 4; e = e.cause, depth++) {
    if (typeof e !== "object") {
      parts.push(String(e));
      break;
    }
    const msg = e.message || String(e);
    parts.push(e.code && !msg.includes(e.code) ? `${e.code} ${msg}` : msg);
  }
  return parts.join(" ← ");
}

const exported = { createChunkedStream, openChunkedStream, contentLengthFromUrl, describeStreamError };
export default exported;
export { exported as "module.exports" };
