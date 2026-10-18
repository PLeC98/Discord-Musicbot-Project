// src/autoplay/route.ts — 직접 지정한 음원. 운영자가 정한 음원이 후보의 길(유튜브 주소 · 검색 · 음원)보다 앞서고 필터링을 다시 하지 않는다.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { openTempStore } from "../helpers/temp-store.ts";
import * as filterModule from "../../src/autoplay/filter.ts";
import type { Candidate } from "../../src/autoplay/sources/candidate.ts";
import type { Deps } from "../../src/autoplay/route.ts";

const store = openTempStore("autoplay-pinned-");
after(() => store.close());
const route = await import("../../src/autoplay/route.ts");
const pinnedSources = await import("../../src/store/pinned-sources.ts");

// 차단어 · 길이 하한이 걸리는 후보도 지정한 음원이면 지나간다
const LIMITS = filterModule.prepare({ minDurationSec: 600, maxDurationSec: 3600, blockedKeywords: ["live"] });
const deps: Deps = {
  ...route.REAL,
  search: async () => assert.fail("검색하면 안 된다"),
  known: () => assert.fail("링크 데이터를 보면 안 된다"),
  assist: { filter: async () => assert.fail("AI 보조를 부르면 안 된다"), accepts: async () => assert.fail("AI 보조를 부르면 안 된다") },
};

test("세 종류 후보 모두 지정한 음원으로 곡을 만들고, 검색 · 링크 데이터 · 필터링 · AI 보조를 거치지 않는다", async () => {
  const cands: Candidate[] = [
    { title: "Live 곡", sourceKey: "yt:1", youtubeUrl: "https://www.youtube.com/watch?v=pinauto0001", durationSec: 30 },
    { title: "Live 곡 둘", artist: "가수", sourceKey: "amq:9001", platform: "anisongdb", sourceUrl: "https://anilist.co/anime/1", durationSec: 30 },
    { title: "Live 곡 셋", sourceKey: "at:9002", platform: "animethemes", audioUrl: "https://cdn.example/a.webm", durationSec: 30 },
  ];
  for (const cand of cands) pinnedSources.setPin(route.requestKeyOf(cand), "https://soundcloud.com/pinned/auto");

  for (const cand of cands) {
    const track = await route.resolve(cand, LIMITS, "팝", deps);
    assert.ok(track, cand.title ?? "");
    assert.deepEqual([track.audioUrl, track.audioFoundBy, track.requestKey, track.title], ["https://soundcloud.com/pinned/auto", "pinned", route.requestKeyOf(cand), cand.title]);
  }
});
