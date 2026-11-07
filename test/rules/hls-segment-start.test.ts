// src/rules/hls-segment-start.ts: HLS 세그먼트가 TS, Packed Audio(ID3), fMP4 로 시작하는지 판정한다. 판정에 필요한 만큼 없으면 more, 세그먼트 전체면 있는 만큼으로 판정한다.
// 시료는 test/fixtures/hls: ffmpeg 로 만든 1초 사인파 AAC 의 MPEG-TS(segment.mpegts), fMP4 미디어 세그먼트(segment.m4s, -f hls -hls_segment_type fmp4),
// ADTS 앞에 RFC 8216 의 ID3 타임스탬프(PRIV com.apple.streaming.transportStreamTimestamp)를 붙인 Packed Audio(segment.aac)

import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentStart, TS_NEED } from "../../src/rules/hls-segment-start.ts";

const fixture = (name: string) => fs.readFileSync(new URL(`../fixtures/hls/${name}`, import.meta.url));

test("ffmpeg 로 만든 TS, fMP4, Packed Audio 세그먼트는 ok 다. 판정에 필요한 만큼 모이기 전에는 more 다", () => {
  const ts = fixture("segment.mpegts");
  assert.equal(segmentStart(ts), "ok");
  assert.equal(segmentStart(ts.subarray(0, TS_NEED - 1)), "more");
  assert.equal(segmentStart(ts.subarray(0, TS_NEED)), "ok");
  assert.equal(segmentStart(ts, true), "ok", "세그먼트 전체면 모든 패킷 경계를 본다");

  const fmp4 = fixture("segment.m4s");
  assert.equal(fmp4.toString("latin1", 4, 8), "styp");
  assert.equal(segmentStart(fmp4), "ok");
  assert.equal(segmentStart(fmp4.subarray(0, 7)), "more");

  const packed = fixture("segment.aac");
  assert.equal(packed.toString("latin1", 0, 3), "ID3");
  assert.equal(segmentStart(packed), "ok");
  assert.equal(segmentStart(packed.subarray(0, 9)), "more");
  assert.equal(segmentStart(Buffer.alloc(0)), "more");
});

test("TS 동기 바이트, ID3 버전과 크기, 박스 이름과 크기가 깨진 앞부분은 bad 다", () => {
  const ts = Buffer.from(fixture("segment.mpegts"));
  ts[188] = 0;
  assert.equal(segmentStart(ts), "bad", "두 번째 패킷");
  const late = Buffer.from(fixture("segment.mpegts"));
  late[188 * 5] = 0;
  assert.equal(segmentStart(late), "ok", "앞 세 패킷만 본다");
  assert.equal(segmentStart(late, true), "bad", "세그먼트 전체면 모든 패킷 경계");

  const id3 = (version: number, size = [0, 0, 0, 0x3f]) => Buffer.from([0x49, 0x44, 0x33, version, 0, 0, ...size]);
  assert.equal(segmentStart(id3(4)), "ok");
  assert.equal(segmentStart(id3(5)), "bad");
  assert.equal(segmentStart(id3(1)), "bad");
  assert.equal(segmentStart(id3(3, [0, 0, 0x80, 0])), "bad", "크기 바이트의 최상위 비트");

  const box = (size: number, name: string, large?: bigint) => {
    const head = Buffer.alloc(large === undefined ? 8 : 16);
    head.writeUInt32BE(size, 0);
    head.write(name, 4, "latin1");
    if (large !== undefined) head.writeBigUInt64BE(large, 8);
    return head;
  };
  assert.equal(segmentStart(box(24, "moof")), "ok");
  assert.equal(segmentStart(box(24, "abcd")), "bad", "최상위 박스가 아님");
  assert.equal(segmentStart(box(4, "moof")), "bad", "8보다 작은 크기");
  assert.equal(segmentStart(box(1, "mdat", 4096n)), "ok", "64비트 크기");
  assert.equal(segmentStart(box(1, "mdat", 8n)), "bad");
  assert.equal(segmentStart(box(1, "mdat").subarray(0, 8)), "more");
  assert.equal(segmentStart(Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0])), "bad");
});

test("세그먼트 전체(짧은 세그먼트)면 있는 만큼으로 판정하고, 판정하기에 모자라면 bad 다", () => {
  const ts = fixture("segment.mpegts");
  assert.equal(segmentStart(ts.subarray(0, 188), true), "ok", "패킷 하나짜리");
  assert.equal(segmentStart(ts.subarray(0, 200), true), "ok", "둘째 패킷의 동기 바이트까지");
  assert.equal(segmentStart(fixture("segment.aac").subarray(0, 9), true), "bad");
  assert.equal(segmentStart(Buffer.alloc(0), true), "bad");
});
