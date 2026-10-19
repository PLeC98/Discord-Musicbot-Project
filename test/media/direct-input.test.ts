// src/media/direct-input.ts — 직접 링크를 재생 · 다운로드 입력으로. 파일은 본문, HLS 는 조각 스트림. 끝이 없는가(live) · 끝과 크기를 아는가(bounded)

import { PassThrough } from "node:stream";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDirectInput, guardedRanges, validatorOf } from "../../src/media/direct-input.ts";
import * as SafeUrl from "../../src/infra/safe-url.ts";
import { codeOf } from "../../src/rules/error-kind.ts";
import type { DirectOpen } from "../../src/sources/direct.ts";
import type { Hls, HlsPart } from "../../src/sources/hls.ts";

const file =
  (radio: boolean, length: number | null, headers: Record<string, unknown> = {}) =>
  async (): Promise<DirectOpen> => ({ kind: "file", body: Object.assign(new PassThrough(), { headers }), radio, length });

function hlsOf(live: boolean, asked: number[] = []): () => Promise<DirectOpen> {
  const hls: Hls = {
    live,
    durationMs: live ? null : 8000,
    fragments(startMs = 0) {
      asked.push(startMs);
      const parts = ["a", "b"];
      return {
        next: async () => {
          const name = parts.shift();
          return name ? ({ url: name, range: null, key: null, sequence: 0 } satisfies HlsPart) : null;
        },
        fetch: async (part) => Buffer.from(part.url),
        startedAtMs: 4000,
        describe: (sent) => `흘림 ${sent}`,
        close: () => {},
      };
    },
  };
  return async () => ({ kind: "hls", hls });
}

test("파일: 크기를 알리면 bounded, 인터넷 라디오는 live(크기를 붙여도)", async () => {
  const cases = [
    [false, 4096, { live: false, bounded: true }],
    [false, null, { live: false, bounded: false }],
    [true, 54_000_000, { live: true, bounded: false }],
  ] as const;
  for (const [radio, length, want] of cases) {
    const input = await openDirectInput("https://f.test/a", {}, file(radio, length));
    assert.deepEqual({ live: input.live, bounded: input.bounded }, want, `radio=${radio} length=${length}`);
    input.destroy();
  }
});

test("HLS: VOD 는 bounded 이고 위치를 조각으로 넘긴다, 라이브는 live", async () => {
  const asked: number[] = [];
  const vod = await openDirectInput("https://h.test/v.m3u8", { startMs: 5000 }, hlsOf(false, asked));
  assert.deepEqual([vod.live, vod.bounded, vod.startedAtMs, asked], [false, true, 4000, [5000]]);
  let text = "";
  for await (const chunk of vod) text += String(chunk);
  assert.equal(text, "ab");
  assert.equal(vod.describe?.(), "흘림 2");

  const live = await openDirectInput("https://h.test/l.m3u8", {}, hlsOf(true));
  assert.deepEqual([live.live, live.bounded], [true, false]);
  live.destroy();
});

test("끊긴 라이브를 다시 열 때(liveOnly) 목록이 끝났으면 live-ended. 라이브면 연다", async () => {
  await assert.rejects(openDirectInput("https://h.test/x.m3u8", { liveOnly: true }, hlsOf(false)), (e: unknown) => codeOf(e) === "live-ended");
  const reopened = await openDirectInput("https://h.test/x.m3u8", { liveOnly: true }, hlsOf(true));
  assert.equal(reopened.live, true);
  reopened.destroy();
});

test("이어받기: 크기를 알리고 상한 안인 파일만. 검사값은 강한 ETag, 없으면 Last-Modified", async () => {
  const resumableOf = async (radio: boolean, length: number | null, headers: Record<string, unknown> = {}) => {
    const input = await openDirectInput("https://f.test/a", {}, file(radio, length, headers));
    input.destroy();
    return input.resumable;
  };
  const got = await resumableOf(false, 4096, { etag: '"abc"' });
  assert.deepEqual([got?.totalBytes, got?.validator], [4096, '"abc"']);
  assert.equal((await resumableOf(false, 4096, { etag: 'W/"weak"', "last-modified": "Tue, 20 Oct 2026 00:00:00 GMT" }))?.validator, "Tue, 20 Oct 2026 00:00:00 GMT");
  assert.equal((await resumableOf(false, 4096))?.validator, null, "검사값이 없으면 If-Range 없이(바뀐 파일은 전체 크기 · 구간으로 가린다)");
  assert.equal(await resumableOf(false, null), undefined, "크기를 모르면 잇지 않는다");
  assert.equal(await resumableOf(true, 4096), undefined, "라디오는 잇지 않는다");
  assert.equal(await resumableOf(false, SafeUrl.DIRECT_LINK.maxBytes + 1), undefined, "상한을 넘으면 잇지 않는다");
  assert.equal(validatorOf({ etag: "" }), null);
});

test("Range 어댑터: 구간 · If-Range 를 가드에 넘기고, 상태 오류는 응답으로, 가드가 막으면 다시 받지 않음, 끊으면 본문을 부순다", async () => {
  const asked: unknown[] = [];
  const body = Object.assign(PassThrough.from([Buffer.from("xyz")]), { headers: { "content-range": "bytes 3-5/9" }, status: 206 });
  const fetch = guardedRanges(async (url, _deps, opts) => {
    asked.push([url, opts.from, opts.to, opts.ifRange]);
    return body;
  });
  const controller = new AbortController();
  const res = await fetch("https://f.test/a", { headers: { Range: "bytes=3-5", "If-Range": '"e"' }, signal: controller.signal });
  assert.deepEqual(asked, [["https://f.test/a", 3, 5, '"e"']]);
  assert.deepEqual([res.status, res.headers.get?.("Content-Range")], [206, "bytes 3-5/9"]);
  body.on("error", () => {}); // 읽는 쪽(청크 스트림)이 받을 오류
  controller.abort(new Error("멈춤"));
  assert.equal(body.destroyed, true);

  const failing = (error: Error) =>
    guardedRanges(async () => {
      throw error;
    });
  const gone = await failing(Object.assign(new Error("요청 실패: HTTP 416"), { status: 416 }))("https://f.test/a", { headers: { Range: "bytes=9-" }, signal: new AbortController().signal });
  assert.deepEqual([gone.status, gone.body], [416, null]);
  await assert.rejects(failing(new SafeUrl.SsrfError("내부 주소"))("https://f.test/a", { headers: { Range: "bytes=1-" }, signal: new AbortController().signal }), (e: unknown) => (e as { permanent?: boolean }).permanent === true);
  await assert.rejects(failing(new Error("ECONNRESET"))("https://f.test/a", { headers: { Range: "bytes=1-" }, signal: new AbortController().signal }), (e: unknown) => (e as { permanent?: boolean }).permanent !== true);
});
