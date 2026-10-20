// src/sources/youtube/recent-info.ts — 받아 둔 유튜브 영상 정보: 줄이기 · 두지 않는 것 · 꺼내기(만료 · 사본) · 상한과 밀어내기 · 셈

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { remember, recall, forget, reuseLoad, useRecentInfo, budgetFor, trimmed } from "../../src/sources/youtube/recent-info.ts";

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const HOUR = 3600;
// 만료가 넉넉한 주소(초 단위 expire)
const urlFor = (id: string, expireIn = 6 * HOUR) => `https://rr1.googlevideo.com/videoplayback?id=${id}&expire=${Math.floor(Date.now() / 1000) + expireIn}`;
const audio = (id: string, extra: Record<string, unknown> = {}) => ({ format_id: id, acodec: "opus", vcodec: "none", url: urlFor(id), ...extra });
const info = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `영상 ${id}`,
  duration: 200,
  url: urlFor(id),
  format_id: "251",
  protocol: "https",
  http_headers: { "User-Agent": "UA", Cookie: "SID=secret" },
  formats: [audio("251"), audio("140", { acodec: "mp4a.40.2" }), { format_id: "sb0", acodec: "none", vcodec: "none" }, { format_id: "137", acodec: "none", vcodec: "avc1" }, { format_id: "18", acodec: "mp4a", vcodec: "avc1" }],
  automatic_captions: { en: [{ url: "x" }] },
  subtitles: {},
  thumbnails: [{ url: "t" }],
  description: "설명",
  cookies: "SID=secret",
  ...extra,
});

beforeEach(() => useRecentInfo(null));

test("줄이기: 소리만 있는 포맷과 고른 포맷만, 자막 · 썸네일 목록 · 설명 · 쿠키는 뺀다. 나머지는 그대로", () => {
  const out = trimmed(info("a", { format_id: "18" }))!;
  assert.deepEqual(
    (out.formats as Array<{ format_id: string }>).map((f) => f.format_id),
    ["251", "140", "18"],
    "스토리보드(소리 · 영상 모두 없음)와 영상만 있는 것은 뺀다",
  );
  for (const key of ["automatic_captions", "subtitles", "thumbnails", "description", "cookies"]) assert.equal(key in out, false, key);
  assert.deepEqual(out.http_headers, { "User-Agent": "UA" });
  assert.equal(out.title, "영상 a");
});

test("두지 않는 것: 재생목록 · 라이브 · 예약 방송 · 주소 없음 · 만료 모름 · 조각 목록 · 너무 큰 것", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["p", { _type: "playlist" }],
    ["l", { is_live: true }],
    ["u", { live_status: "is_upcoming" }],
    ["n", { url: undefined }],
    ["e", { url: "https://rr1.googlevideo.com/videoplayback?x=1" }],
    ["f", { fragments: [{ url: "a" }] }],
    ["d", { protocol: "http_dash_segments" }],
    ["h", { protocol: "m3u8_native" }],
    ["b", { formats: [audio("251", { padding: "x".repeat(300 * 1024) })] }],
  ];
  for (const [id, extra] of cases) {
    remember(info(id, extra));
    assert.equal(recall(id), null, id);
  }
  remember(info("ok"));
  assert.ok(recall("ok"));
});

test("꺼내기: 곡을 다 받기 전에 만료될 것은 꺼내지 않고 지운다. 꺼낸 것은 사본이다", () => {
  remember(info("near", { url: urlFor("near", 200 + 30) }));
  assert.equal(recall("near"), null, "200초 곡에 230초 남음: 여유 60초가 안 된다");
  remember(info("far"));
  const first = recall("far")!;
  first.title = "바꿈";
  assert.equal(recall("far")!.title, "영상 far");
  forget("far");
  assert.equal(recall("far"), null);
});

test("상한: 넘으면 만료된 것부터, 그다음 가장 오래 남은 것을 밀어낸다. 같은 곡을 다시 넣으면 뒤로 간다", () => {
  const one = JSON.stringify(trimmed(info("x"))).length;
  useRecentInfo(one * 3 + 10);
  remember(info("a"));
  remember(info("b"));
  remember(info("c"));
  remember(info("a")); // 다시 넣어 가장 새 것이 된다
  remember(info("d"));
  assert.equal(recall("b"), null, "가장 오래 남은 것");
  assert.ok(recall("a") && recall("c") && recall("d"));

  useRecentInfo(one * 3 + 10);
  // 크기가 같게 한 글자 id
  remember(info("o"));
  remember(info("g", { url: urlFor("g", -10) })); // 이미 만료(넣을 때는 만료 시각을 읽을 수 있는지만 본다)
  remember(info("n"));
  remember(info("m"));
  assert.ok(recall("o"), "만료된 것이 먼저 빠져 오래된 것이 남는다");
  assert.equal(recall("g"), null);
});

test("셈: 다시 쓴 수, 밀려난 뒤 필요해져 놓친 수(처음부터 없던 것은 세지 않는다)", () => {
  const one = JSON.stringify(trimmed(info("x"))).length;
  useRecentInfo(one + 10);
  remember(info("a"));
  remember(info("b")); // a 가 밀려난다
  assert.ok(recall("b"));
  assert.equal(recall("a"), null);
  assert.equal(recall("a"), null, "놓친 것은 한 번만 센다");
  assert.equal(recall("never"), null);
  assert.deepEqual(reuseLoad(), { reused: 1, missed: 1 });
});

test("상한은 메모리로: 1GB 마다 2MB, 8 ~ 64MB. 프로세스에 걸린 상한이 있으면 그것으로", () => {
  assert.equal(budgetFor(0, 16 * GB), 32 * MB);
  assert.equal(budgetFor(0, 2 * GB), 8 * MB);
  assert.equal(budgetFor(0, 128 * GB), 64 * MB);
  assert.equal(budgetFor(6 * GB, 64 * GB), 12 * MB);
  assert.equal(budgetFor(2 ** 62, 16 * GB), 32 * MB);
});
