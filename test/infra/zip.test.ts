// src/infra/zip.ts — 설정 내보내기 · 가져오기 · 백업의 ZIP. 묶은 것을 그대로 풀고(메모리 · 파일, ZIP64 포함), 믿을 수 없는 파일은 거절한다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { zip, unzip, writeZip, sinkOf, openZip, type ZipInput } from "../../src/infra/zip.ts";
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

// ── 흘려 쓰기 · 파일 읽기 · ZIP64 ──

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zip-stream-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }));

/** 흘려 묶어 파일로 */
async function written(inputs: ZipInput[], zip64 = false) {
  const file = path.join(DIR, `${Math.random().toString(36).slice(2)}.zip`);
  const out = fs.createWriteStream(file);
  const bytes = await writeZip(inputs, sinkOf(out), { zip64 });
  await new Promise((resolve) => out.end(resolve));
  assert.equal(fs.statSync(file).size, bytes);
  return file;
}
const drain = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

test("흘려 쓰기: 파일 항목은 그대로 담고 바이트 항목은 줄면 deflate. 파일에서 열어 메모리 · 흘려 읽기", async () => {
  const media = path.join(DIR, "seg.m4s");
  fs.writeFileSync(media, crypto.randomBytes(300_000));
  const text = Buffer.from("가".repeat(5000));
  for (const zip64 of [false, true]) {
    const file = await written(
      [
        { name: "index.json", data: text },
        { name: "a/seg-000.m4s", file: media },
      ],
      zip64,
    );
    const opened = openZip(file);
    try {
      assert.deepEqual(
        opened.entries.map((one) => [one.name, one.method, one.size]),
        [
          ["index.json", 8, text.length],
          ["a/seg-000.m4s", 0, 300_000],
        ],
      );
      assert.deepEqual(opened.read(opened.entries[0], 1_000_000), text);
      assert.deepEqual(await drain(opened.stream(opened.entries[1])), fs.readFileSync(media));
      assert.throws(() => opened.read(opened.entries[1], 1000), /너무 큽니다/);
    } finally {
      opened.close();
    }
    // 메모리 풀기도 같은 목차 읽기(ZIP64 꼴 포함)
    assert.deepEqual(
      unzip(fs.readFileSync(file), { maxBytes: 1_000_000 }).map((one) => one.name),
      ["index.json", "a/seg-000.m4s"],
    );
  }
});

test("흘려 읽기는 내용이 맞지 않으면 끝에서 BAD_ZIP 으로 끊는다", async () => {
  const media = path.join(DIR, "body.bin");
  fs.writeFileSync(media, Buffer.alloc(50_000, 7));
  const file = await written([{ name: "body.bin", file: media }]);
  // 몸통 한가운데를 바꾼다(CRC 가 어긋난다)
  const buf = fs.readFileSync(file);
  buf[30 + "body.bin".length + 25_000] ^= 0xff;
  fs.writeFileSync(file, buf);
  const opened = openZip(file);
  try {
    await assert.rejects(drain(opened.stream(opened.entries[0])), (error: { code?: string }) => error.code === "BAD_ZIP");
  } finally {
    opened.close();
  }
});

test("받는 곳이 비워지기를 기다리는 사이 닫히면(내려받던 쪽이 끊었다) 실패로 멈춘다", async () => {
  const { Writable } = await import("node:stream");
  // 받기만 하고 비우지 않는 곳
  const out = new Writable({ highWaterMark: 1, write: () => {} });
  const sink = sinkOf(out);
  const waiting = sink(Buffer.alloc(16));
  out.destroy();
  await assert.rejects(waiting, /받는 쪽이 닫혔습니다/);
  await assert.rejects(sink(Buffer.alloc(1)), /받는 쪽이 닫혔습니다/);
});
