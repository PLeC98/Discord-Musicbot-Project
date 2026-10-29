// src/ui/text/ko/search.ts — 검색 화면의 글자를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as search from "../../../../src/ui/text/ko/search.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [search.results("노래", 5), search.result(1, { title: "곡", uploader: "채널", length: "3:00" }), search.result(2, { title: null, uploader: undefined, length: "알 수 없음" }), search.unknownLength(), search.adding(), search.searching("노래")],
    [{ title: '🔍 "노래" 검색 결과', description: "번호 버튼을 눌러 곡을 선택해 주세요.", footer: "결과 5개", cancel: "취소" }, { name: "1. 곡", value: "👤 채널 • ⏱️ 3:00" }, { name: "2. 알 수 없는 제목", value: "👤 알 수 없는 채널 • ⏱️ 알 수 없음" }, "알 수 없음", { title: "🔄 넣는 중...", description: "선택한 곡을 추가하고 있어요..." }, "🔄 **노래** 검색 중..."],
  );
});
