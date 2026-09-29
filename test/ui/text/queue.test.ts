// src/ui/text/queue.ts — 담기 안내 · 대기열 화면의 글자를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as queue from "../../../src/ui/text/queue.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [
      queue.added({ tracks: [{ title: "곡*" }], collection: null, total: null, first: false }),
      queue.added({ tracks: [{}], collection: null, total: null, first: true }),
      queue.added({ tracks: [{}, {}], collection: "앨범", total: null, first: false }),
      queue.added({ tracks: [{}, {}], collection: "재생목록", total: 1200, first: true }),
      queue.addedWarnings({ dropped: 0, skipped: 0, queueLimited: false, max: 100 }),
      queue.addedWarnings({ dropped: 2, skipped: 3, queueLimited: true, max: 100 }),
      queue.addedWarnings({ dropped: 0, skipped: 0, queueLimited: true, max: 100 }),
      queue.full(100),
      queue.view({ waiting: 4, total: 5, page: 1, pages: 1 }),
      queue.view({ waiting: 40, total: 41, page: 2, pages: 3 }),
      queue.currentHeader(),
    ],
    [
      "✅ **곡\\***이(가) 대기열에 추가되었습니다!",
      "⏫ **알 수 없는 트랙**이(가) 대기열 맨 앞에 추가되었습니다!",
      "✅ 앨범의 2개 노래가 대기열에 추가되었습니다!",
      "⏫ 재생목록 전체 1,200곡 중 2곡이 대기열 맨 앞에 추가되었습니다!",
      "",
      "\n⚠️ 받을 수 없는 3곡(미리듣기 · 지역 제한 등)은 뺐습니다\n⚠️ 대기열이 가득 차 2곡은 넣지 못했습니다 (최대 100곡)",
      "\n⚠️ 대기열이 가득 차 목록의 일부만 넣었습니다 (최대 100곡)",
      "대기열이 가득 찼습니다 (최대 100곡)",
      { title: "📝 재생 대기열", header: "📋 다음 노래들 (4개)", footer: "총 5개의 노래" },
      { title: "📝 재생 대기열", header: "📋 다음 노래들 (40개)", footer: "총 41개의 노래 • 2/3 페이지" },
      "🎵 현재 재생 중",
    ],
  );
});
