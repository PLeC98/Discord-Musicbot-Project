"use strict";

// 썸네일 자리를 채우는 투명 PNG. CV2 섹션은 액세서리가 있어야 하고, 없으면 레이아웃이 달라진다.
// 메시지에 첨부하고 attachment://로 가리킨다. 파일로 두지 않고 처음 쓸 때 만든다.

const zlib = require("node:zlib");

const NAME = "blank.png";
const SIZE = 256;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 채널당 8비트
  header[9] = 6; // RGBA
  const pixels = Buffer.alloc((size * 4 + 1) * size); // 줄마다 필터 바이트 0 + 완전 투명
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

let cached = null;

module.exports = {
  url: `attachment://${NAME}`,
  file: () => ({ attachment: (cached ??= png(SIZE)), name: NAME }),
  _internals: { png, crc32, NAME, SIZE },
};
