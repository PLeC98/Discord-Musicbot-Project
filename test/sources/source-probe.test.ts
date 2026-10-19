// src/sources/source-probe.ts — 재생 테스트 한 건. 출처마다 실제로 열어 보고, 라이브(인터넷 라디오 포함)는 실패(live), 오류는 문제 코드로. 던지지 않는다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { probeSource, type Openers } from "../../src/sources/source-probe.ts";
import { codedError } from "../../src/rules/error-kind.ts";

const fail = (code: string) => async () => {
  throw codedError(code, code);
};
const never = async () => assert.fail("이 출처를 열면 안 된다");

type Over = { youtube: Openers["youtube"]["getStream"]; soundcloud: Openers["soundcloud"]["getStream"]; direct: Openers["direct"]["open"] };
function openers(over: Partial<Over>): Openers {
  return { youtube: { getStream: over.youtube ?? never }, soundcloud: { getStream: over.soundcloud ?? never }, direct: { open: over.direct ?? never } };
}

test("유튜브: 열리면 됨, 라이브면 live, 실패면 그 코드", async () => {
  const yt = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
  assert.deepEqual(await probeSource(yt, openers({ youtube: async () => ({ isLive: false }) })), { ok: true });
  assert.deepEqual(await probeSource(yt, openers({ youtube: async () => ({ isLive: true }) })), { ok: false, code: "live" });
  assert.deepEqual(await probeSource(yt, openers({ youtube: fail("unavailable-contents") })), { ok: false, code: "unavailable-contents" });
  assert.deepEqual(
    await probeSource(
      yt,
      openers({
        youtube: async () => {
          throw new Error("모르는 오류");
        },
      }),
    ),
    { ok: false, code: "unknown-error" },
  );
});

test("사운드클라우드: 열리면 됨, 미리듣기만이면 그 코드", async () => {
  const sc = "https://soundcloud.com/artist/song";
  assert.deepEqual(await probeSource(sc, openers({ soundcloud: async () => ({}) })), { ok: true });
  assert.deepEqual(await probeSource(sc, openers({ soundcloud: fail("sc-preview-only") })), { ok: false, code: "sc-preview-only" });
});

test("직접 링크: 열자마자 끊고, 인터넷 라디오 · 라이브 HLS 면 live", async () => {
  const url = "https://cdn.example.net/a.mp3";
  const opened: PassThrough[] = [];
  const open = (radio: boolean) =>
    openers({
      direct: async () => {
        const body = new PassThrough();
        opened.push(body);
        return { kind: "file", body, radio };
      },
    });
  assert.deepEqual(await probeSource(url, open(false)), { ok: true });
  assert.deepEqual(await probeSource(url, open(true)), { ok: false, code: "live" });
  for (const live of [false, true]) {
    assert.deepEqual(await probeSource(url, openers({ direct: async () => ({ kind: "hls", hls: { live } }) })), live ? { ok: false, code: "live" } : { ok: true }, `HLS live=${live}`);
  }
  assert.ok(
    opened.every((one) => one.destroyed),
    "열린 스트림은 모두 끊었다",
  );
  assert.deepEqual(await probeSource(url, openers({ direct: fail("direct-unavailable") })), { ok: false, code: "direct-unavailable" });
});

test("모르는 주소는 열지 않고 unsupported-link", async () => {
  assert.deepEqual(await probeSource("그냥 검색어", openers({})), { ok: false, code: "unsupported-link" });
});
