// dashboard/src/utils/big-art.ts: 크게 그릴 앨범아트 주소. 출처의 큰 이미지부터, 대체 이미지 · 못 불러온 것은 기억해 다음 크기로

import { test } from "node:test";
import assert from "node:assert/strict";
import { bigArt, noteArt } from "../../../dashboard/src/utils/big-art.ts";

const SMALL = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const event = (type: "load" | "error", src: string, naturalWidth = 1280) => ({ type, target: { getAttribute: () => src, naturalWidth } }) as unknown as Event;

test("큰 칸은 유튜브 1280×720(large) · 480×360(standard) 주소를 쓰고, 그 밖의 출처는 그대로", () => {
  assert.equal(bigArt(SMALL("aaaaaaaaaaa"), "large"), "https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg");
  assert.equal(bigArt(SMALL("aaaaaaaaaaa"), "standard"), "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg");
  assert.equal(bigArt("https://example.com/cover.jpg", "large"), "https://example.com/cover.jpg");
  assert.equal(bigArt(null, "large"), null);
});

test("큰 그림이 대체 그림(120×90)이거나 못 불러왔으면 기억해 다음 크기로, 원래 주소를 못 불러온 것만 broken", () => {
  const url = SMALL("bbbbbbbbbbb");
  const large = bigArt(url, "large")!;
  assert.equal(noteArt(event("load", large), url), "ok");
  assert.equal(bigArt(url, "large"), large, "제대로 불러온 것은 그대로");

  assert.equal(noteArt(event("load", large, 120), url), "retry", "유튜브의 대체 그림");
  const standard = bigArt(url, "large")!;
  assert.match(standard, /hqdefault\.jpg$/);
  assert.equal(noteArt(event("error", standard), url), "retry");
  assert.equal(bigArt(url, "large"), url, "큰 그림이 다 없으면 원래 주소");
  assert.equal(bigArt(url, "standard"), url, "기억은 크기마다가 아니라 주소마다라 같이 쓴다");

  assert.equal(noteArt(event("error", url), url), "broken");
  assert.equal(noteArt(event("load", url, 320), url), "ok");
});
