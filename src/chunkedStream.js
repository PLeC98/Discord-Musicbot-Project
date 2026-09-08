"use strict";

// Range 요청으로 나눠 받는 읽기 스트림.
//
// 왜: googlevideo는 순차 GET을 재생시간의 약 2배속(30~33 KB/s)으로 조인다. 실측에서 영상 4개가
// 전부 같았고, Range 요청은 이 페이싱을 우회한다(수백~수천 배). yt-dlp의 --http-chunk-size,
// ytdl-core의 dlChunkSize가 같은 방식이다.
//
// 증상: 오프셋 재생이 "오프셋 ÷ 2"초를 기다린다(SponsorBlock으로 37초를 건너뛰면 버퍼링 17초).
// 건너뛸 구간의 바이트가 도착하기를 기다리는 시간이지, 디코드 비용이 아니다(그건 0.1초다).
//
// ffmpeg에도 같은 목적의 request_size 옵션이 있지만 ffmpeg가 직접 HTTP를 할 때만 먹는다.
// 이 프로젝트는 ffmpeg에 URL을 주지 않으므로(정적 링크 빌드가 주소 해석에서 죽는다) Node가 한다.
//
// 응답 본문을 통째로 메모리에 올리지 않고 조각째 밀어낸다. arrayBuffer()로 받으면 메모리가
// 청크 크기에 비례하지만(1MB 청크에 서버당 5MB), 이렇게 하면 청크 크기와 무관하게 평탄하다.

const { Readable } = require("stream");

/**
 * @param {string}   url         받을 주소 (서명된 미디어 URL)
 * @param {object}   headers     yt-dlp가 준 요청 헤더
 * @param {number}   totalBytes  전체 길이. googlevideo는 URL의 clen 파라미터로 준다
 * @param {number}   chunkSize   요청 하나가 가져올 최대 바이트
 * @param {Function} fetchImpl   테스트 주입용 — 기본은 전역 fetch
 * @returns {Readable} `on("error")` / `destroy()` / `pipe()` 계약을 만족하는 스트림
 */
function createChunkedStream({ url, headers = {}, totalBytes, chunkSize, fetchImpl = fetch }) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) throw new TypeError(`totalBytes가 올바르지 않습니다: ${totalBytes}`);
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) throw new TypeError(`chunkSize가 올바르지 않습니다: ${chunkSize}`);

  let pos = 0;
  let pumping = false;
  let reader = null;
  let aborter = null;
  let requests = 0;

  // 첫 요청의 성패를 밖에서 기다릴 수 있게 한다(openChunkedStream 참조).
  // 이게 없으면 만료된 URL 같은 실패가 호출부의 try/catch를 지나쳐 재생 시작 뒤에야 드러난다.
  let settleReady;
  let ready = null;

  const stream = new Readable({
    read() {
      pump();
    },
    destroy(err, cb) {
      abort();
      cb(err);
    },
  });

  function abort() {
    try {
      aborter?.abort();
    } catch {
      /* 이미 끝난 요청 */
    }
    aborter = null;
    reader = null;
  }

  // Content-Range: "bytes <start>-<end>/<total>" — 프록시가 엉뚱한 구간을 주면 여기서 잡는다.
  function assertRangeStart(res, expected) {
    const cr = res.headers.get?.("content-range");
    if (!cr) return;
    const start = Number(/bytes\s+(\d+)-/i.exec(cr)?.[1]);
    if (Number.isFinite(start) && start !== expected) {
      throw new Error(`Range 응답이 어긋납니다: ${expected}을 요청했는데 ${cr}`);
    }
  }

  async function openNext() {
    const end = Math.min(pos + chunkSize, totalBytes) - 1;
    aborter = new AbortController();
    requests++;
    const res = await fetchImpl(url, { headers: { ...headers, Range: `bytes=${pos}-${end}` }, signal: aborter.signal });

    if (res.status === 206) {
      assertRangeStart(res, pos);
    } else if (res.status === 200 && pos === 0) {
      // 서버가 Range를 무시했다. 첫 요청이라 본문이 곧 전체 파일이므로 그대로 다 읽으면 된다
      // (페이싱 우회는 못 하지만 재생은 정상). 두 번째 요청부터의 200은 구간이 어긋나므로 오류다.
      chunkSize = totalBytes;
    } else {
      throw new Error(`Range 요청 실패: HTTP ${res.status}`);
    }

    if (!res.body) throw new Error("응답 본문이 없습니다");
    settleReady?.(null);
    return res.body.getReader();
  }

  async function pump() {
    if (pumping || stream.destroyed) return;
    pumping = true;
    try {
      while (!stream.destroyed) {
        if (!reader) {
          if (pos >= totalBytes) break;
          reader = await openNext();
          if (stream.destroyed) return;
        }
        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          aborter = null;
          continue;
        }
        pos += value.length;
        // push가 false면 소비 측이 포화된 것 — 다음 _read()가 이어서 부른다(백프레셔)
        if (!stream.push(Buffer.from(value))) return;
      }
      if (pos >= totalBytes) stream.push(null);
    } catch (err) {
      if (err?.name === "AbortError" || stream.destroyed) return;
      settleReady?.(err);
      stream.destroy(err);
    } finally {
      pumping = false;
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
      pump();
    }
    return ready;
  };

  // 관측용 — 로그·테스트에서 요청 횟수와 진행 위치를 볼 때
  stream.stats = () => ({ requests, received: pos, totalBytes });
  return stream;
}

/**
 * createChunkedStream + 첫 요청 대기. 실패하면 여기서 던지므로 호출부의 폴백이 그대로 동작한다.
 * (단일 GET 시절 `await fetch(...)`가 서 있던 자리와 같은 의미)
 */
async function openChunkedStream(opts) {
  const stream = createChunkedStream(opts);
  // 오류는 prime()의 거부로도 전달되므로, 스트림 자신의 error 이벤트가 듣는 사람 없이 떠서
  // uncaughtException이 되는 것만 막는다. 리스너가 여럿이어도 호출부 핸들러는 그대로 불린다 —
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

// googlevideo URL은 전체 길이를 clen 파라미터로 들고 있다. HEAD 요청이 필요 없다.
// 값이 없으면(라이브 스트림 등) null — 호출부는 이때 단일 GET으로 돌아간다.
function contentLengthFromUrl(url) {
  try {
    const clen = Number(new URL(url).searchParams.get("clen"));
    return Number.isFinite(clen) && clen > 0 ? clen : null;
  } catch {
    return null;
  }
}

module.exports = { createChunkedStream, openChunkedStream, contentLengthFromUrl };
