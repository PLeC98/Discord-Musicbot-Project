// src/autoplay/sources/lbradio.ts — ListenBrainz Radio 소스.
//
// 지키려는 계약:
//  · mode 파라미터는 하나만 받는다(둘을 주면 400). 모드를 섞으려면 프롬프트 안에서 원소마다 적는다
//  · 길이는 밀리초로 온다. 초로 바꾸고, 없으면 비워 둔다(길이 필터가 따로 다룬다)
//  · MusicBrainz 가 모를 때 채우는 정해진 이름([unknown] 등)은 버린다. 대괄호로 싸인 진짜 이름([Alexandros])은 둔다
//  · 토큰이 없으면 던진다. 부르는 쪽이 다음 소스로 넘어간다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { lbradio } from "../../src/autoplay/sources/lbradio.ts";
import { useFetch } from "../../src/autoplay/sources/http.ts";
import type { GenreSource } from "../../src/config/genres.ts";
import { withConfig } from "../helpers/config.ts";
import { fake } from "../helpers/fake.ts";

after(() => useFetch(null));

type Track = { creator?: string; title?: string; duration?: number; identifier?: string[] };

function serve(tracks: Track[]) {
  const calls: Array<{ url: URL; auth: string | undefined }> = [];
  useFetch(
    fake<typeof fetch>(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: new URL(String(input)), auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
      return { ok: true, status: 200, json: async () => ({ payload: { jspf: { playlist: { track: tracks } } } }) };
    }),
  );
  return calls;
}

const source = (extra: Partial<GenreSource> = {}): GenreSource => ({ type: "lbradio", ...extra }) as GenreSource;
const withToken = <R>(fn: () => R) => withConfig({ sources: { listenbrainzToken: "tok" } }, fn);

test("모드를 섞으면 프롬프트 안에서 원소마다 적고, mode 파라미터는 하나만 보낸다", () =>
  withToken(async () => {
    const calls = serve([]);
    await lbradio(source({ tags: ["rock", "indie"], mode: ["easy", "hard"] }));
    const q = calls[0].url.searchParams;
    assert.equal(q.get("prompt"), "tag:(rock,indie)::easy tag:(rock,indie)::hard");
    assert.deepEqual(q.getAll("mode"), ["easy"], "둘을 주면 400");
    assert.equal(calls[0].auth, "Token tok");
  }));

test("모드를 안 적으면 hard. 프롬프트를 직접 적으면 그것을 쓴다", () =>
  withToken(async () => {
    const calls = serve([]);
    await lbradio(source({ tags: ["jazz"] }));
    await lbradio(source({ prompt: "artist:(Radiohead)" }));
    assert.equal(calls[0].url.searchParams.get("prompt"), "tag:(jazz)::hard");
    assert.equal(calls[1].url.searchParams.get("prompt"), "artist:(Radiohead)");
  }));

test("태그도 프롬프트도 없으면 묻지 않는다", () =>
  withToken(async () => {
    const calls = serve([]);
    assert.deepEqual(await lbradio(source()), []);
    assert.equal(calls.length, 0);
  }));

test("길이는 밀리초를 초로. 모를 때 채우는 이름은 버리고 대괄호로 싸인 진짜 이름은 둔다", () =>
  withToken(async () => {
    serve([
      { creator: "가수", title: "곡", duration: 215400, identifier: ["https://musicbrainz.org/recording/1"] },
      { creator: "[Alexandros]", title: "Starrrrrrr", identifier: ["https://musicbrainz.org/recording/2"] },
      { creator: "[unknown]", title: "곡3" },
      { creator: "가수4", title: "[untitled]" },
      { creator: "", title: "이름 없음" },
    ]);
    const got = await lbradio(source({ tags: ["rock"] }));
    assert.deepEqual(got, [
      { artist: "가수", title: "곡", durationSec: 215, sourceUrl: "https://musicbrainz.org/recording/1", platform: "lbradio", sourceKey: "https://musicbrainz.org/recording/1" },
      { artist: "[Alexandros]", title: "Starrrrrrr", durationSec: undefined, sourceUrl: "https://musicbrainz.org/recording/2", platform: "lbradio", sourceKey: "https://musicbrainz.org/recording/2" },
    ]);
  }));

test("토큰이 없으면 던진다", () =>
  withConfig({ sources: { listenbrainzToken: "" } }, async () => {
    await assert.rejects(lbradio(source({ tags: ["rock"] })), /LISTENBRAINZ_TOKEN/);
  }));
