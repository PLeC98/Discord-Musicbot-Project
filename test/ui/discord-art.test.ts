// src/ui/discord-art.ts — 디스코드에 거는 큰 곡 그림

import { test } from "node:test";
import assert from "node:assert/strict";
import { prepare, urlOf, artFor, _internals } from "../../src/ui/discord-art.ts";
import { remember } from "../helpers/tagged-audio.ts";

const yt = (id: string, name = "mqdefault") => `https://i.ytimg.com/vi/${id}/${name}.jpg`;

test("유튜브: 큰 그림이 있으면 maxresdefault, 없으면(404) · 묻지 못하면 hqdefault. 물어 보기 전에는 hqdefault", async () => {
  const asked: string[] = [];
  _internals.useHead(async (url) => {
    asked.push(url);
    if (url.includes("/brokennet00/")) throw new Error("ECONNRESET");
    return url.includes("/oldvideo000/") ? { ok: false, status: 404 } : { ok: true, status: 200 };
  });
  assert.equal(urlOf(yt("newvideo000")), yt("newvideo000", "hqdefault"), "물어 보기 전");
  await Promise.all([prepare(yt("newvideo000")), prepare(yt("newvideo000", "hqdefault"))]);
  await prepare(yt("oldvideo000"));
  await prepare(yt("brokennet00"));
  assert.equal(urlOf(yt("newvideo000")), yt("newvideo000", "maxresdefault"));
  assert.equal(urlOf(yt("oldvideo000")), yt("oldvideo000", "hqdefault"));
  assert.equal(urlOf(yt("brokennet00")), yt("brokennet00", "hqdefault"));
  await prepare(yt("newvideo000"));
  assert.deepEqual(asked, [yt("newvideo000", "maxresdefault"), yt("oldvideo000", "maxresdefault"), yt("brokennet00", "maxresdefault")], "영상마다 한 번만 묻는다");
});

test("유튜브가 아니면 묻지 않고 rules/track-art 의 큰 것(사운드클라우드 500×500 · 그 밖은 그대로), 없으면 null", async () => {
  _internals.useHead(async () => assert.fail("묻지 않는다"));
  await prepare("https://i1.sndcdn.com/artworks-ab-mini.jpg");
  await prepare(null);
  assert.equal(urlOf("https://i1.sndcdn.com/artworks-ab-mini.jpg"), "https://i1.sndcdn.com/artworks-ab-t500x500.jpg");
  assert.equal(urlOf("https://example.org/a.jpg"), "https://example.org/a.jpg");
  assert.equal(urlOf(null), null);
});

test("artFor: 곡 그림 주소가 있으면 그 큰 것, 직접 링크 곡은 찾아 둔 파일 태그 그림을 첨부로, 모르면 null", async (t) => {
  _internals.useHead(async () => ({ ok: true, status: 200 }));
  assert.deepEqual(await artFor({ thumbnail: yt("artforvideo") }), { url: yt("artforvideo", "maxresdefault") });
  const url = "https://files.test/artfor.mp3";
  assert.equal(await artFor({ thumbnail: null, audioUrl: url }), null, "아직 모른다");
  if (!(await remember(url))) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const art = await artFor({ thumbnail: null, audioUrl: url });
  assert.equal(art?.url, "attachment://art.jpg");
  assert.equal(art?.file?.name, "art.jpg");
  assert.ok(art?.file?.attachment.length && art.fingerprint);
  assert.equal(await artFor(null), null);
});
