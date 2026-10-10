// src/infra/zip.ts — 설정 내보내기 · 가져오기의 ZIP. 묶은 것을 그대로 풀고, 믿을 수 없는 파일은 거절한다

import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { zip, unzip } from "../../src/infra/zip.ts";
import { codeOf } from "../../src/rules/error-kind.ts";

const rejects = (buf: Buffer, options?: Parameters<typeof unzip>[1]) => {
  try {
    unzip(buf, options);
  } catch (error) {
    return codeOf(error) === "BAD_ZIP";
  }
  return false;
};

test("묶은 것을 그대로 푼다. 한글 이름 · 빈 파일 · 줄지 않는 내용도", () => {
  const entries = [
    { name: "settings.json", data: Buffer.from(JSON.stringify({ 장르: "팝".repeat(500) })) },
    { name: "favicon/16.png", data: Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919) % 256)) },
    { name: "빈 파일.txt", data: Buffer.alloc(0) },
  ];
  const out = unzip(zip(entries));
  assert.deepEqual(
    out.map((one) => [one.name, one.data.toString("hex")]),
    entries.map((one) => [one.name, one.data.toString("hex")]),
  );
});

test("항목 수 · 풀린 크기 상한을 넘으면 거절한다", () => {
  const many = zip(Array.from({ length: 5 }, (_, i) => ({ name: `${i}.txt`, data: Buffer.from("x") })));
  assert.ok(rejects(many, { maxEntries: 4 }));
  const big = zip([{ name: "big.txt", data: Buffer.alloc(10_000, 1) }]);
  assert.ok(rejects(big, { maxBytes: 9_999 }), "압축은 작아도 풀린 크기로 잰다");
});

test("폴더 밖 경로 · 깨진 내용 · ZIP 이 아닌 것은 거절한다", () => {
  for (const name of ["../x", "a/../../x", "/etc/x", "C:/x", "..\\x"]) assert.ok(rejects(zip([{ name, data: Buffer.from("x") }])), name);
  assert.ok(rejects(Buffer.from("그냥 글")));
  const broken = zip([{ name: "a.txt", data: Buffer.from("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") }]);
  broken[40] ^= 0xff; // 압축된 몸통 한 바이트
  assert.ok(rejects(broken));
});

// 다른 프로그램이 만든 ZIP 의 흔한 꼴: 압축 없이 담은 항목 · 폴더 항목 · 끝 주석
// Windows PowerShell 5.1 의 Compress-Archive 는 경로를 \ 로 나눈다(사용자가 풀었다 다시 묶은 파일)
test("\\ 로 나눈 경로는 / 로 읽는다", () => {
  assert.deepEqual(
    unzip(zip([{ name: "favicon\\32.png", data: Buffer.from("x") }])).map((one) => one.name),
    ["favicon/32.png"],
  );
});

test("압축 없이 담은 항목 · 폴더 항목 · 끝의 주석이 있어도 읽는다", () => {
  const made = zip([
    { name: "dir/", data: Buffer.alloc(0) },
    { name: "dir/a.txt", data: Buffer.from("ab") },
  ]);
  const comment = Buffer.from("만든 프로그램의 주석");
  const withComment = Buffer.concat([made, comment]);
  withComment.writeUInt16LE(comment.length, made.length - 2);
  assert.deepEqual(
    unzip(withComment).map((one) => one.name),
    ["dir/a.txt"],
  );
  assert.equal(zlib.crc32(unzip(withComment)[0].data), zlib.crc32(Buffer.from("ab")));
});
