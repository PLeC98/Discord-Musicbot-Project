// src/ui/search-results.ts: /search 결과 화면. 카드(헤더 줄, 결과 줄, 연령 인증 푸터)와 카드 밖의 선택 메뉴

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchResultsView, pickOfOption, type ResultRow } from "../../src/ui/search-results.ts";
import { useUploaded } from "../../src/ui/icons.ts";
import { selectOf, separatorsOf, textsOf } from "../helpers/cv2.ts";

afterEach(() => useUploaded(new Map()));

const youtube = (id: string, extra: Partial<ResultRow> = {}): ResultRow => ({ platform: "youtube", id, title: `영상 ${id}`, artist: "채널", duration: 236, pageUrl: `https://www.youtube.com/watch?v=${id}`, ...extra });
const spotify = (id: string): ResultRow => ({ platform: "spotify", id, title: `곡 ${id[0]}`, artist: "가수", duration: 61, pageUrl: `https://open.spotify.com/track/${id}` });
const SP = "1SwZVVH9BnXtLRLi2cbFhw";

test("카드: 헤더 줄, 번호와 제목 링크, 아랫줄에 출처 아이콘과 채널 | 길이. 메뉴는 카드 밖", () => {
  const view = searchResultsView({ query: "노래", rows: [youtube("aaaaaaaaaaa"), youtube("bbbbbbbbbbb", { isLive: true }), spotify(SP)], gated: false, userId: "u1" });
  assert.equal(view.components.length, 2, "카드와 메뉴 줄");
  const [text] = textsOf({ components: [view.components[0]] });
  assert.equal(text, ['### 🔍 "노래" 검색 결과', "**1.** [영상 aaaaaaaaaaa](https://www.youtube.com/watch?v=aaaaaaaaaaa)", "-# 🔴 채널 | 3:56", "**2.** [영상 bbbbbbbbbbb](https://www.youtube.com/watch?v=bbbbbbbbbbb)", "-# 🔴 채널 | 🔴LIVE", `**3.** [곡 1](https://open.spotify.com/track/${SP})`, "-# 🟢 가수 | 1:01"].join("\n"));
  assert.equal(textsOf({ components: [view.components[0]] }).length, 1, "연령 인증이 아니면 푸터가 없다");
});

test("메뉴: 검색한 사람을 싣고, 항목은 번호. 제목, 채널 | 길이, 출처 이모지. 값은 번호와 선택한 곡이라 같은 곡이 두 번이어도 겹치지 않는다", () => {
  useUploaded(new Map([["youtube", { id: "11", animated: false }]]));
  const view = searchResultsView({ query: "q", rows: [youtube("aaaaaaaaaaa"), youtube("aaaaaaaaaaa"), spotify(SP)], gated: false, userId: "u1" });
  const menu = selectOf(view);
  assert.equal(menu?.custom_id, "search:pick:u1");
  assert.deepEqual(
    menu?.options?.map((o) => [o.label, o.value, o.emoji?.name]),
    [
      ["1. 영상 aaaaaaaaaaa", "1:yt:aaaaaaaaaaa", "youtube"],
      ["2. 영상 aaaaaaaaaaa", "2:yt:aaaaaaaaaaa", "youtube"],
      ["3. 곡 1", `3:sp:${SP}`, "🟢"],
    ],
  );
  assert.equal(pickOfOption(`3:sp:${SP}`), `sp:${SP}`);
});

test("연령 인증으로 스포티파이 곡만이면 구분선 아래 카드 푸터에 까닭", () => {
  const view = searchResultsView({ query: "閃光", rows: [spotify(SP)], gated: true, userId: "u1" });
  assert.equal(textsOf({ components: [view.components[0]] }).at(-1), "-# 유튜브가 연령 인증을 요구하는 검색어예요");
  assert.equal(separatorsOf({ components: [view.components[0]] }), 1);
  assert.equal(separatorsOf({ components: [searchResultsView({ query: "q", rows: [spotify(SP)], gated: false, userId: "u1" }).components[0]] }), 0, "푸터가 없으면 구분선도 없다");
});

test("열 줄 모두 제목, 가수가 아주 길어도 카드 글은 4000자 안(디스코드가 넘으면 메시지 전체를 거절한다)", () => {
  const long = (i: number): ResultRow => ({ ...spotify(SP), id: SP, title: "제".repeat(300), artist: Array.from({ length: 20 }, (_, n) => `가수${i}-${n}`).join(", ") });
  const view = searchResultsView({ query: "가".repeat(100), rows: Array.from({ length: 10 }, (_, i) => long(i)), gated: true, userId: "u1" });
  const total = textsOf({ components: [view.components[0]] }).join("").length;
  assert.ok(total < 4000, String(total));
});
