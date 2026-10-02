// src/ui/text/queue.ts — 담은 안내와 대기열 화면의 글자를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as queue from "../../../src/ui/text/queue.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [
      queue.added({ tracks: [{ title: "곡*" }], collection: null, total: null, first: false }),
      queue.added({ tracks: [{ title: "Love" }], collection: null, total: null, first: false }),
      queue.added({ tracks: [{}], collection: null, total: null, first: true }),
      queue.added({ tracks: [{}, {}], collection: "앨범", total: null, first: false }),
      queue.added({ tracks: [{}, {}], collection: "재생목록", total: 1200, first: true }),
      queue.partlyAdded(),
      queue.addedWarnings({ dropped: 0, skipped: 0, queueLimited: false, max: 100 }),
      queue.addedWarnings({ dropped: 2, skipped: 3, queueLimited: true, max: 100 }),
      queue.addedWarnings({ dropped: 0, skipped: 0, queueLimited: true, max: 100 }),
      queue.view({ count: 4, page: 1, pages: 1 }),
      queue.view({ count: 40, page: 2, pages: 3 }),
    ],
    [
      { title: "✅ 곡을 추가했어요!", body: "**곡\\***을 대기열에 넣었어요." },
      { title: "✅ 곡을 추가했어요!", body: "**Love**를 대기열에 넣었어요." },
      { title: "⏫ 곡을 추가했어요!", body: "**알 수 없는 트랙**을 대기열 맨 앞에 넣었어요." },
      { title: "✅ 곡을 추가했어요!", body: "앨범의 2곡을 대기열에 넣었어요." },
      { title: "⏫ 곡을 추가했어요!", body: "재생목록 1,200곡 중 2곡을 대기열 맨 앞에 넣었어요." },
      "⚠️ 일부 곡을 추가했어요!",
      [],
      ["받을 수 없는 3곡은 제외됐어요. (미리듣기 · 지역 제한 등)", "대기열이 가득 차서 2곡은 넣지 못했어요. (최대 100곡)"],
      ["대기열이 가득 차서 목록의 일부만 넣었어요. (최대 100곡)"],
      { title: "📝 재생 대기열", footer: "모두 4곡" },
      { title: "📝 재생 대기열", footer: "모두 40곡 • 2/3쪽" },
    ],
  );
});
