// src/ui/text/more.ts — 더 넣기의 글자를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as more from "../../../src/ui/text/more.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [
      more.offered("재생목록", 1234, 50),
      more.added({ collection: "앨범", added: 20 }),
      more.added({ collection: "재생목록", added: 1000, skipped: 2, dropped: 3 }),
      more.finished("머리"),
      more.progressed("머리", 1234, 1050),
      more.noRoom("머리"),
      more.menu(1184),
      more.step(1000),
      more.capLabel(30, { all: true, perClick: false }),
      more.capLabel(10, { all: false, perClick: true }),
      more.capLabel(1500, { all: false, perClick: false }),
      more.countModal(2000),
      more.fetching(),
      more.fetchingCount(3, 10),
      more.refusal("not-requester"),
      more.refusal("not-requester-close"),
      more.refusal("expired"),
      more.refusal("full"),
      more.refusal("bad-count"),
      more.refusal("unknown-menu"),
    ],
    [
      "📃 재생목록은 전체 1,234곡이에요. 앞 50곡까지 넣었어요.",
      "✅ 앨범에서 20곡을 더 넣었어요.",
      "✅ 재생목록에서 1,000곡을 더 넣었어요. 받을 수 없는 2곡(미리듣기 · 지역 제한 등)은 뺐어요. 대기열이 가득 차 3곡은 빠졌어요.",
      "머리 목록을 끝까지 넣었어요.",
      "머리 (전체 1,234곡 중 1,050곡까지)",
      "머리\n대기열이 가득 차 지금은 더 넣을 수 없어요.",
      { placeholder: "더 넣기 (남은 1,184곡)", custom: "직접 입력…", stop: "그만 넣기" },
      "1,000곡 더",
      "남은 곡 전부 (30곡)",
      "10곡 더",
      "넣을 수 있는 만큼 (1,500곡)",
      { title: "더 넣기", label: "넣을 곡 수 (1~2,000)" },
      "⏳ 곡을 가져오는 중…",
      "⏳ 3/10곡 가져오는 중…",
      "목록을 넣은 사람만 더 넣을 수 있어요.",
      "목록을 넣은 사람만 닫을 수 있어요.",
      "시간이 지나 닫힌 메뉴예요. 링크를 다시 넣어 주세요.",
      "대기열이 가득 차 지금은 더 넣을 수 없어요.",
      "넣을 곡 수를 1 이상의 숫자로 적어 주세요.",
      "알 수 없는 메뉴예요.",
    ],
  );
});
