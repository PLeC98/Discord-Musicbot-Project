// src/sources/direct.ts · direct-open.ts — 단순 목록(PLS · M3U)은 첫 주소를 다시 열고(목록 안의 목록은 한 번까지), 옛 SHOUTcast(ICY 첫 줄)는 그 까닭으로 거절한다

import { Readable } from "node:stream";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as DirectLink from "../../src/sources/direct.ts";
import { openLink, type AudioStream } from "../../src/sources/direct-open.ts";
import { getTrackData } from "../../src/sources/lookup.ts";
import { codeOf } from "../../src/rules/error-kind.ts";

type Reply = { body?: string; headers?: Record<string, unknown>; error?: Error };

/** 가짜 SafeUrl(주소 → 응답). 라디오는 끝나지 않는 본문 흉내로 같은 조각을 이어 준다 */
function netOf(routes: Record<string, Reply>) {
  const asked: string[] = [];
  const net = {
    getStream: async (url: string) => {
      asked.push(url);
      const reply = routes[url];
      if (!reply) throw Object.assign(new Error("요청 실패: HTTP 404"), { status: 404 });
      if (reply.error) throw reply.error;
      return Object.assign(Readable.from([Buffer.from(reply.body ?? "")]), { headers: reply.headers ?? {}, status: 200, url }) as AudioStream;
    },
  };
  return { net, asked };
}

const radio: Reply = { body: "ÿû", headers: { "content-type": "audio/mpeg", "icy-name": "Radio X" } };
const icyError = () => Object.assign(new Error("Parse Error: Expected HTTP/, RTSP/ or ICE/"), { code: "HPE_INVALID_CONSTANT", rawPacket: Buffer.from("ICY 200 OK\r\n") });

test("PLS · M3U: 첫 주소를 열어 본다. 곡의 음원 주소는 목록 주소 그대로(열 때마다 다시 푼다)", async () => {
  const { net, asked } = netOf({
    "https://site.test/listen.pls": { body: "[playlist]\nNumberOfEntries=2\nFile1=https://radio.test/a\nFile2=https://radio.test/b\n", headers: { "content-type": "audio/x-scpls" } },
    "https://site.test/listen.m3u": { body: "#EXTM3U\n#EXTINF:-1,Radio X\nhttps://radio.test/a\n", headers: { "content-type": "audio/x-mpegurl" } },
    "https://radio.test/a": radio,
  });
  for (const url of ["https://site.test/listen.pls", "https://site.test/listen.m3u"]) {
    const [track] = await DirectLink.getInfo(url, { net });
    assert.deepEqual([track.audioUrl, track.isLive, track.title], [url, true, "Radio X"], url);
    const opened = await DirectLink.open(url, net);
    assert.ok(opened.kind === "file" && opened.radio, url);
    if (opened.kind === "file") opened.body.destroy();
  }
  assert.ok(!asked.includes("https://radio.test/b"), "첫 주소만");
});

test("목록 안의 목록은 한 번까지, 빈 목록 · 더 깊은 목록은 unsupported-link", async () => {
  const pls = (target: string): Reply => ({ body: `[playlist]\nFile1=${target}\n`, headers: { "content-type": "audio/x-scpls" } });
  const { net } = netOf({
    "https://l.test/one.pls": pls("https://l.test/two.pls"),
    "https://l.test/two.pls": pls("https://radio.test/a"),
    "https://l.test/deep.pls": pls("https://l.test/one.pls"),
    "https://l.test/empty.pls": { body: "[playlist]\nNumberOfEntries=0\n", headers: { "content-type": "audio/x-scpls" } },
    "https://radio.test/a": radio,
  });
  const [ok] = await DirectLink.getInfo("https://l.test/one.pls", { net });
  assert.equal(ok.isLive, true, "목록 → 목록 → 방송");
  for (const url of ["https://l.test/deep.pls", "https://l.test/empty.pls"]) {
    await assert.rejects(DirectLink.getInfo(url, { net }), (e: unknown) => codeOf(e) === "unsupported-link", url);
    await assert.rejects(DirectLink.open(url, net), (e: unknown) => codeOf(e) === "unsupported-link", url);
  }
});

test("옛 SHOUTcast(ICY 첫 줄)는 shoutcast-v1 로 거절하고 곡 찾기가 그 까닭으로 알린다. 다른 해석 오류는 그대로", async () => {
  const { net } = netOf({ "https://old.test/;": { error: icyError() }, "https://bad.test/": { error: Object.assign(new Error("Parse Error"), { code: "HPE_INVALID_CONSTANT", rawPacket: Buffer.from("FOO 1\r\n") }) } });
  await assert.rejects(openLink("https://old.test/;", { net }), (e: unknown) => codeOf(e) === "shoutcast-v1");
  await assert.rejects(openLink("https://bad.test/", { net }), (e: unknown) => codeOf(e) === "HPE_INVALID_CONSTANT");
  await assert.rejects(DirectLink.open("https://old.test/;", net), (e: unknown) => codeOf(e) === "shoutcast-v1", "숨기지 않는다");
  await assert.rejects(DirectLink.open("https://bad.test/", net), (e: unknown) => codeOf(e) === "direct-unavailable");
  // PLS 가 옛 방송을 가리켜도 같다
  const listed = netOf({ "https://site.test/old.pls": { body: "[playlist]\nFile1=https://old.test/;\n", headers: { "content-type": "audio/x-scpls" } }, "https://old.test/;": { error: icyError() } });
  await assert.rejects(DirectLink.getInfo("https://site.test/old.pls", { net: listed.net }), (e: unknown) => codeOf(e) === "shoutcast-v1");

  const direct = { getInfo: (url: string) => DirectLink.getInfo(url, { net }) };
  const result = await getTrackData("https://old.test/;", "test", {}, { direct });
  assert.deepEqual(result, { success: false, code: "shoutcast-v1" });
});
