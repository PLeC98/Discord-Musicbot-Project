// src/media/direct-input.ts — 직접 링크를 재생 · 다운로드 입력으로. 파일은 본문, HLS 는 조각 스트림. 끝이 없는가(live) · 끝과 크기를 아는가(bounded)

import { PassThrough } from "node:stream";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDirectInput } from "../../src/media/direct-input.ts";
import { codeOf } from "../../src/rules/error-kind.ts";
import type { DirectOpen } from "../../src/sources/direct.ts";
import type { Hls, HlsPart } from "../../src/sources/hls.ts";

const file = (radio: boolean, length: number | null) => async (): Promise<DirectOpen> => ({ kind: "file", body: new PassThrough(), radio, length });

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
