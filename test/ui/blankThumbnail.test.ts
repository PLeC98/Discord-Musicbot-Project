// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import * as blankThumbnail from "../../src/ui/blankThumbnail.ts";

const { crc32, NAME, SIZE } = blankThumbnail._internals;

test("투명 썸네일: 올바른 PNG — 서명·크기·RGBA·체크섬, 픽셀은 전부 투명", () => {
  const { attachment, name } = blankThumbnail.file();
  assert.equal(name, NAME);
  assert.equal(blankThumbnail.url, `attachment://${NAME}`);
  assert.deepEqual([...attachment.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const chunks = [];
  for (let at = 8; at < attachment.length;) {
    const len = attachment.readUInt32BE(at);
    const type = attachment.toString("ascii", at + 4, at + 8);
    const data = attachment.subarray(at + 8, at + 8 + len);
    assert.equal(attachment.readUInt32BE(at + 8 + len), crc32(attachment.subarray(at + 4, at + 8 + len)), `${type} 체크섬`);
    chunks.push({ type, data });
    at += 12 + len;
  }
  assert.deepEqual(
    chunks.map((c) => c.type),
    ["IHDR", "IDAT", "IEND"],
  );
  assert.equal(chunks[0].data.readUInt32BE(0), SIZE);
  assert.equal(chunks[0].data[9], 6, "RGBA");
  const pixels = zlib.inflateSync(chunks[1].data);
  assert.equal(pixels.length, (SIZE * 4 + 1) * SIZE);
  assert.ok(pixels.every((b) => b === 0));
});

test("crc32는 표준값과 같다", () => {
  assert.equal(crc32(Buffer.from("IEND", "ascii")), 0xae426082);
});
