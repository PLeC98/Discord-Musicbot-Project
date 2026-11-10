// src/infra/zip.ts: 설정 내보내기, 불러오기, 백업의 ZIP. 묶은 것을 그대로 풀고(메모리, 파일, ZIP64 포함), 믿을 수 없는 파일은 거절한다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { unzip, writeZip, sinkOf, openZip, extractZip, type ZipInput } from "../../src/infra/zip.ts";
import { zipped } from "../helpers/zip.ts";
import { codeOf } from "../../src/rules/error-kind.ts";

const rejects = (buf: Buffer, options?: Parameters<typeof unzip>[1]) => {
  try {
    unzip(buf, options);
  } catch (error) {
    return codeOf(error) === "BAD_ZIP";
  }
  return false;
};

test("묶은 것을 그대로 푼다. 한글 이름, 빈 파일, 줄지 않는 내용도", async () => {
  const entries = [
    { name: "settings.json", data: Buffer.from(JSON.stringify({ 장르: "팝".repeat(500) })) },
    { name: "favicon/16.png", data: Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919) % 256)) },
    { name: "빈 파일.txt", data: Buffer.alloc(0) },
  ];
  const out = unzip(await zipped(entries));
  assert.deepEqual(
    out.map((one) => [one.name, one.data.toString("hex")]),
    entries.map((one) => [one.name, one.data.toString("hex")]),
  );
});

test("항목 수, 풀린 크기 상한을 넘으면 거절한다", async () => {
  const many = await zipped(Array.from({ length: 5 }, (_, i) => ({ name: `${i}.txt`, data: Buffer.from("x") })));
  assert.ok(rejects(many, { maxEntries: 4 }));
  const big = await zipped([{ name: "big.txt", data: Buffer.alloc(10_000, 1) }]);
  assert.ok(rejects(big, { maxBytes: 9_999 }), "압축은 작아도 풀린 크기로 잰다");
});

test("폴더 밖 경로, 깨진 내용, ZIP이 아닌 것은 거절한다", async () => {
  for (const name of ["../x", "a/../../x", "/etc/x", "C:/x", "..\\x"]) assert.ok(rejects(await zipped([{ name, data: Buffer.from("x") }])), name);
  assert.ok(rejects(Buffer.from("그냥 글")));
  const broken = await zipped([{ name: "a.txt", data: Buffer.from("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") }]);
  broken[40] ^= 0xff; // 압축된 몸통 한 바이트
  assert.ok(rejects(broken));
});

// 다른 프로그램이 만든 ZIP 의 흔한 형식: 압축 없이 담은 항목, 폴더 항목, 끝 주석
// Windows PowerShell 5.1 의 Compress-Archive 는 경로를 \ 로 나눈다(사용자가 풀었다 다시 묶은 파일)
test("\\ 로 나눈 경로는 / 로 읽는다", async () => {
  assert.deepEqual(
    unzip(await zipped([{ name: "favicon\\32.png", data: Buffer.from("x") }])).map((one) => one.name),
    ["favicon/32.png"],
  );
});

test("압축 없이 담은 항목, 폴더 항목, 끝의 주석이 있어도 읽는다", async () => {
  const made = await zipped([
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

// ── 스트리밍 쓰기, 파일 읽기, ZIP64 ──

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zip-stream-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }));

/** 스트리밍으로 묶어 파일로 */
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

test("스트리밍 쓰기: 파일 항목은 그대로 담고 바이트 항목은 줄면 deflate. 파일에서 열어 메모리, 스트리밍 읽기", async () => {
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
      assert.throws(() => opened.read(opened.entries[1], 1000), /너무 큼/);
    } finally {
      opened.close();
    }
    // 메모리 풀기도 같은 중앙 디렉터리 읽기(ZIP64 형식 포함)
    assert.deepEqual(
      unzip(fs.readFileSync(file), { maxBytes: 1_000_000 }).map((one) => one.name),
      ["index.json", "a/seg-000.m4s"],
    );
  }
});

test("스트리밍 쓰기: 사라진 optional 파일은 건너뛰고, build 는 앞에서 담은 이름들로 쓸 때 만든다", async () => {
  const kept = path.join(DIR, "kept.opus");
  fs.writeFileSync(kept, "있음");
  const gone = path.join(DIR, "gone.opus");
  const file = await written([
    { name: "files/kept.opus", file: kept, optional: true },
    { name: "files/gone.opus", file: gone, optional: true },
    { name: "rows.json", build: (names) => Buffer.from(JSON.stringify([...names])) },
  ]);
  const entries = unzip(fs.readFileSync(file));
  assert.deepEqual(
    entries.map((one) => one.name),
    ["files/kept.opus", "rows.json"],
  );
  assert.deepEqual(JSON.parse(entries[1].data.toString("utf8")), ["files/kept.opus"]);
  await assert.rejects(written([{ name: "files/gone.opus", file: gone }]), { code: "ENOENT" }, "optional 이 아니면 그대로 실패");
});

test("스트리밍 읽기는 내용이 맞지 않으면 끝에서 BAD_ZIP 으로 끊는다", async () => {
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

test("받는 곳이 비워지기를 기다리는 사이 닫히면(다운로드하던 쪽이 끊었다) 실패로 멈춘다", async () => {
  const { Writable } = await import("node:stream");
  // 받기만 하고 비우지 않는 곳
  const out = new Writable({ highWaterMark: 1, write: () => {} });
  const sink = sinkOf(out);
  const waiting = sink(Buffer.alloc(16));
  out.destroy();
  await assert.rejects(waiting, /받는 쪽이 닫힘/);
  await assert.rejects(sink(Buffer.alloc(1)), /받는 쪽이 닫힘/);
});

test("이름에 NUL, 콜론(드라이브, 대체 데이터 스트림)이 있으면 거절한다", async () => {
  for (const name of [`a${String.fromCharCode(0)}b`, "a.txt:secret", "x/C:y"]) assert.ok(rejects(await zipped([{ name, data: Buffer.from("x") }])), JSON.stringify(name));
});

test("스트림으로 읽기: 원본을 읽다 실패하면 받는 쪽이 오류를 받는다(처리되지 않은 예외가 아니다)", async () => {
  // 압축하면 줄어드는 바이트라 deflate로 담긴다(압축 해제를 거친다)
  const file = await written([{ name: "gone.bin", data: Buffer.alloc(200_000, 7) }]);
  const opened = openZip(file);
  try {
    assert.equal(opened.entries[0].method, 8);
    // 중앙 디렉터리는 읽었고, 본문을 읽을 때는 파일이 없다
    fs.rmSync(file);
    await assert.rejects(drain(opened.stream(opened.entries[0])), (error: { code?: string }) => error.code === "ENOENT" || error.code === "EPERM");
  } finally {
    opened.close();
  }
});

// ── 0바이트 항목, 유닉스 모드, 폴더로 풀기 ──

/** 묶은 ZIP 의 중앙 디렉터리에서 이름마다 만든 OS 를 유닉스로, 외부 속성의 위 16비트를 mode 로 바꾼다(writeZip 은 쓰지 않는 필드다) */
function withUnixModes(buf: Buffer, modes: Record<string, number>): Buffer {
  const out = Buffer.from(buf);
  let end = out.length - 22;
  while (out.readUInt32LE(end) !== 0x06054b50) end--;
  let at = out.readUInt32LE(end + 16);
  for (let i = 0; i < out.readUInt16LE(end + 10); i++) {
    const nameLength = out.readUInt16LE(at + 28);
    const name = out.toString("utf8", at + 46, at + 46 + nameLength);
    if (name in modes) {
      out.writeUInt16LE((3 << 8) | 20, at + 4);
      out.writeUInt32LE((modes[name] << 16) >>> 0, at + 38);
    }
    at += 46 + nameLength + out.readUInt16LE(at + 30) + out.readUInt16LE(at + 32);
  }
  return out;
}
const zipFile = (buf: Buffer) => {
  const file = path.join(DIR, `${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(file, buf);
  return file;
};
const freshDir = () => path.join(DIR, `out-${Math.random().toString(36).slice(2)}`);
const LIMITS = { maxEntries: 100, maxBytes: 1024 * 1024 };

test("0바이트 항목도 파일에서 스트림으로 읽는다", async () => {
  const file = await written([
    { name: "empty.typed", data: Buffer.alloc(0) },
    { name: "after.txt", data: Buffer.from("뒤") },
  ]);
  const opened = openZip(file);
  try {
    assert.equal((await drain(opened.stream(opened.entries[0]))).length, 0);
    assert.equal((await drain(opened.stream(opened.entries[1]))).toString("utf8"), "뒤");
  } finally {
    opened.close();
  }
});

test("유닉스에서 만든 항목만 mode 를 싣는다", async () => {
  const buf = withUnixModes(
    await zipped([
      { name: "run", data: Buffer.from("x") },
      { name: "plain.txt", data: Buffer.from("y") },
    ]),
    { run: 0o100755 },
  );
  const opened = openZip(zipFile(buf));
  try {
    assert.deepEqual(
      opened.entries.map((one) => [one.name, one.mode]),
      [
        ["run", 0o100755],
        ["plain.txt", null],
      ],
    );
  } finally {
    opened.close();
  }
});

test("폴더로 풀기: 상위 폴더를 만들고 내용, 0바이트 파일, 실행 비트를 옮긴다(Windows 처럼 폴더 항목이 없어도)", async () => {
  const buf = withUnixModes(
    await zipped([
      { name: "yt-dlp_linux", data: Buffer.from("실행 파일") },
      { name: "_internal/lib/a.so", data: Buffer.alloc(5000, 3) },
      { name: "_internal/certifi/py.typed", data: Buffer.alloc(0) },
      { name: "_internal/base.txt", data: Buffer.from("읽기만") },
    ]),
    { "yt-dlp_linux": 0o100755, "_internal/lib/a.so": 0o100755, "_internal/base.txt": 0o100644 },
  );
  const dir = freshDir();
  await extractZip(zipFile(buf), dir, LIMITS);
  assert.equal(fs.readFileSync(path.join(dir, "yt-dlp_linux"), "utf8"), "실행 파일");
  assert.ok(fs.readFileSync(path.join(dir, "_internal", "lib", "a.so")).equals(Buffer.alloc(5000, 3)));
  assert.equal(fs.statSync(path.join(dir, "_internal", "certifi", "py.typed")).size, 0);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(dir, "yt-dlp_linux")).mode & 0o111, 0o111 & ~process.umask());
    assert.equal(fs.statSync(path.join(dir, "_internal", "base.txt")).mode & 0o111, 0);
  }
});

test("폴더로 풀기: 일반 파일이 아닌 항목(심볼릭 링크, 장치), Windows 장치 이름, 폴더 밖 경로는 쓰기 전에 거절한다", async () => {
  const cases: [string, Buffer][] = [
    [
      "심볼릭 링크",
      withUnixModes(
        await zipped([
          { name: "ok.txt", data: Buffer.from("x") },
          { name: "link", data: Buffer.from("/etc/passwd") },
        ]),
        { link: 0o120777 },
      ),
    ],
    ["문자 장치", withUnixModes(await zipped([{ name: "dev", data: Buffer.alloc(0) }]), { dev: 0o020644 })],
    ["장치 이름", await zipped([{ name: "_internal/CON.txt", data: Buffer.from("x") }])],
    ["장치 이름(확장자 없음)", await zipped([{ name: "nul", data: Buffer.from("x") }])],
  ];
  for (const [label, buf] of cases) {
    const dir = freshDir();
    await assert.rejects(extractZip(zipFile(buf), dir, LIMITS), { code: "BAD_ZIP" }, label);
    assert.equal(fs.existsSync(dir), false, `${label}: 아무것도 쓰지 않는다`);
  }
  const outside = freshDir();
  await assert.rejects(extractZip(zipFile(await zipped([{ name: "../out.txt", data: Buffer.from("x") }])), outside, LIMITS), { code: "BAD_ZIP" });
  assert.equal(fs.existsSync(path.join(DIR, "out.txt")), false);
});

test("폴더로 풀기: 정상 이름의 .. 접두사(..foo)는 받는다", async () => {
  const dir = freshDir();
  await extractZip(zipFile(await zipped([{ name: "..foo", data: Buffer.from("x") }])), dir, LIMITS);
  assert.equal(fs.readFileSync(path.join(dir, "..foo"), "utf8"), "x");
});

test("폴더로 풀기: 이미 있는 폴더, 같은 이름 두 번, 항목 수와 풀린 크기 상한을 넘으면 실패한다", async () => {
  const one = zipFile(await zipped([{ name: "a.txt", data: Buffer.from("x") }]));
  const existing = freshDir();
  fs.mkdirSync(existing);
  await assert.rejects(extractZip(one, existing, LIMITS), { code: "EEXIST" });

  const twice = zipFile(
    await zipped([
      { name: "a.txt", data: Buffer.from("x") },
      { name: "A.txt", data: Buffer.from("y") },
      { name: "a.txt", data: Buffer.from("z") },
    ]),
  );
  await assert.rejects(extractZip(twice, freshDir(), LIMITS), { code: "EEXIST" });

  const many = zipFile(await zipped(Array.from({ length: 5 }, (_, i) => ({ name: `${i}.txt`, data: Buffer.from("x") }))));
  await assert.rejects(extractZip(many, freshDir(), { ...LIMITS, maxEntries: 4 }), { code: "BAD_ZIP" });
  const big = zipFile(await zipped([{ name: "big.bin", data: Buffer.alloc(10_000, 1) }]));
  const dir = freshDir();
  await assert.rejects(extractZip(big, dir, { ...LIMITS, maxBytes: 9_999 }), { code: "BAD_ZIP" });
  assert.equal(fs.existsSync(dir), false, "쓰기 전에 거절한다");
});
