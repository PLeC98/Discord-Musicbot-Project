// src/ui/queue-mosaic: /queue 썸네일 모자이크의 칸 이미지(thumbnails)와 워커에서 그린 한 장(card-render/render)

import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { cellImagesOf, isArtHost, SIZE, _internals } from "../../src/ui/queue-mosaic/thumbnails.ts";
import { sizeOf, PER_ROW } from "../../src/ui/queue-mosaic/layout.ts";
import { renderQueueMosaic } from "../../src/ui/card-render/render.ts";
import { remember } from "../helpers/tagged-audio.ts";
import sink from "../../src/infra/log/sink.ts";

const yt = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const small = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const image = (width: number, height: number, format: "jpeg" | "png" = "jpeg") =>
  sharp({ create: { width, height, channels: 3, background: "#3366cc" } })
    [format]()
    .toBuffer();

test("받는 썸네일 서버는 https 의 유튜브, 스포티파이, 사운드클라우드뿐", () => {
  for (const url of ["https://i.ytimg.com/vi/x/mqdefault.jpg", "https://i9.ytimg.com/a.jpg", "https://img.youtube.com/vi/x/0.jpg", "https://i.scdn.co/image/ab67", "https://mosaic.scdn.co/640/a", "https://image-cdn-ak.spotifycdn.com/image/a", "https://i1.sndcdn.com/artworks-a-t500x500.jpg"]) {
    assert.ok(isArtHost(url), url);
  }
  for (const url of ["http://i.ytimg.com/vi/x/mqdefault.jpg", "https://i.ytimg.com.evil.test/a.jpg", "https://evil.test/i.ytimg.com/a.jpg", "https://cdn.example.org/a.jpg", "file:///C:/a.jpg", "not a url"]) {
    assert.ok(!isArtHost(url), url);
  }
});

test("칸 이미지: 작은 썸네일 주소로 받아 칸 크기 JPEG 으로. 16:9 가 아닌 것(정사각형)도 칸 크기", async () => {
  const asked: string[] = [];
  _internals.useFetch(async (url) => {
    asked.push(url);
    return url.includes("square") ? image(640, 640, "png") : image(320, 180);
  });
  const [wide, square] = await cellImagesOf([{ thumbnail: yt("wideimage00") }, { thumbnail: "https://i.scdn.co/image/square" }]);
  assert.deepEqual(asked, [small("wideimage00"), "https://i.scdn.co/image/square"]);
  for (const one of [wide, square]) {
    const meta = await sharp(one!).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ["jpeg", SIZE.width, SIZE.height]);
  }
});

test("받지 않는 서버, 썸네일 없는 곡은 받지 않고 null", async () => {
  _internals.useFetch(async () => assert.fail("받지 않는다"));
  assert.deepEqual(await cellImagesOf([{ thumbnail: "https://cdn.example.org/a.jpg" }, { thumbnail: null }, {}]), [null, null, null]);
});

test("같은 이미지는 한 번만 받는다: 동시에 물어도, 다시 물어도", async () => {
  let count = 0;
  _internals.useFetch(async () => {
    count++;
    return image(320, 180);
  });
  const [a, b] = await cellImagesOf([{ thumbnail: yt("samevideo00") }, { thumbnail: small("samevideo00") }]);
  const [c] = await cellImagesOf([{ thumbnail: yt("samevideo00") }]);
  assert.equal(count, 1);
  assert.ok(a && a === b && b === c);
});

test("받지 못하거나 디코딩하지 못하면 null 이고, 한동안 다시 받지 않는다", async () => {
  let count = 0;
  _internals.useFetch(async (url) => {
    count++;
    if (url.includes("brokennet")) throw new Error("ECONNRESET");
    return Buffer.from("not an image");
  });
  assert.deepEqual(await cellImagesOf([{ thumbnail: yt("brokennet00") }, { thumbnail: yt("notimage000") }]), [null, null]);
  assert.deepEqual(await cellImagesOf([{ thumbnail: yt("brokennet00") }, { thumbnail: yt("notimage000") }]), [null, null]);
  assert.equal(count, 2);
});

test("선언된 픽셀 수가 상한을 넘는 이미지는 디코딩하지 않는다", async () => {
  const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "#000" } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  _internals.useFetch(async () => huge);
  assert.deepEqual(await cellImagesOf([{ thumbnail: yt("hugeimage00") }]), [null]);
});

test("JPEG, PNG, WebP 가 아닌 이미지(sharp 가 디코딩할 수 있는 SVG, GIF 도)는 디코딩하지 않는다", async () => {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="red"/></svg>`);
  const gif = await sharp({ create: { width: 320, height: 180, channels: 3, background: "#f00" } })
    .gif()
    .toBuffer();
  _internals.useFetch(async (url) => (url.includes("svgimage") ? svg : gif));
  assert.deepEqual(await cellImagesOf([{ thumbnail: yt("svgimage000") }, { thumbnail: yt("gifimage000") }]), [null, null]);
  const webp = await sharp({ create: { width: 320, height: 180, channels: 3, background: "#f00" } })
    .webp()
    .toBuffer();
  _internals.useFetch(async () => webp);
  assert.ok((await cellImagesOf([{ thumbnail: yt("webpimage00") }]))[0], "WebP 는 받는다");
});

test("직접 링크 곡은 찾아 둔 파일 태그 이미지로", async (t) => {
  _internals.useFetch(async () => assert.fail("받지 않는다"));
  const url = "https://files.test/queue-mosaic.mp3";
  assert.deepEqual(await cellImagesOf([{ thumbnail: null, audioUrl: url }]), [null], "아직 모른다");
  if (!(await remember(url))) return t.skip("ffmpeg로 픽스처를 만들 수 없음");
  const [jpeg] = await cellImagesOf([{ thumbnail: null, audioUrl: url }]);
  const meta = await sharp(jpeg!).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["jpeg", SIZE.width, SIZE.height]);
});

test("워커에서 그린 모자이크: 칸 수에 맞는 크기의 투명한 WebP. 빈 칸, 세 자리 번호, 잘못된 바탕색도 그린다", async () => {
  const jpeg = new Uint8Array(
    await sharp({ create: { width: SIZE.width, height: SIZE.height, channels: 3, background: "#888" } })
      .jpeg()
      .toBuffer(),
  );
  for (const count of [1, PER_ROW, PER_ROW + 1, PER_ROW * 2]) {
    const cells = Array.from({ length: count }, (_, i) => ({ number: 95 + i, jpeg: i % 3 === 1 ? null : jpeg }));
    const webp = await renderQueueMosaic({ seed: count === 1 ? "not-a-color" : "#7289da", cells });
    const meta = await sharp(webp).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height, meta.hasAlpha], ["webp", sizeOf(count).width, sizeOf(count).height, true], `${count}칸`);
  }
});

test("로그: 4xx(썸네일 없음)는 warn 을 남기지 않고, 그 밖의 실패는 원인마다 처음 한 번 warn, 다시 만들면 복구 한 줄", async () => {
  const lines = () => sink.buffer.slice(from).flatMap((e) => (e.text.includes("/queue 썸네일 처리") ? [`${e.level} ${e.text}`] : []));
  _internals.useFetch(async () => image(320, 180));
  await cellImagesOf([{ thumbnail: yt("logreset000") }]);
  const from = sink.buffer.length;
  _internals.useFetch(async (url) => {
    if (url.includes("missing")) throw Object.assign(new Error("요청 실패: HTTP 404"), { status: 404 });
    if (url.includes("netfail")) throw new Error("응답이 5000ms 동안 없음");
    return image(320, 180);
  });
  await cellImagesOf([{ thumbnail: yt("missing0000") }]);
  await cellImagesOf([{ thumbnail: yt("netfail0001") }, { thumbnail: yt("netfail0002") }]);
  await cellImagesOf([{ thumbnail: yt("recovered00") }]);
  assert.deepEqual(lines(), ["warn /queue 썸네일 처리 실패: 응답이 5000ms 동안 없음", "info /queue 썸네일 처리 복구(실패 2회)"]);
});
