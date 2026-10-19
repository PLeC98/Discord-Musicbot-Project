// src/rules/container-index.ts — 음원 앞부분의 색인(webm Cues · mp4 sidx)으로 시간 → 바이트, 받기 시작할 키프레임 고르기, 받은 첫 바이트 확인.
// 실제 파일(ffmpeg 로 만든 webm · m4a, 유튜브와 같은 배치)과 손으로 만든 바이트(가장자리)를 함께 본다

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readIndex, headerOf, startPoint, worthIndexing, FIRST_BYTES, type ContainerIndex } from "../../src/rules/container-index.ts";
import { spawnFfmpeg } from "../../src/media/ffmpeg/process.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-container-index-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

function ffmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFfmpeg(["-hide_banner", "-loglevel", "error", ...args], "probe", { killOnStdoutClose: false });
    } catch {
      return resolve(false);
    }
    child.stdout.resume();
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

let webm: Buffer | null = null;
let m4a: Buffer | null = null;
before(async () => {
  const sine = ["-f", "lavfi", "-i", "sine=frequency=440:duration=60"];
  if (await ffmpeg([...sine, "-c:a", "libopus", "-b:a", "64k", "-f", "webm", "-cues_to_front", "1", "-cluster_time_limit", "2000", "-y", path.join(DIR, "a.webm")])) webm = fs.readFileSync(path.join(DIR, "a.webm"));
  if (await ffmpeg([...sine, "-c:a", "aac", "-b:a", "96k", "-movflags", "+dash+global_sidx", "-frag_duration", "2000000", "-y", path.join(DIR, "a.m4a")])) m4a = fs.readFileSync(path.join(DIR, "a.m4a"));
});

const indexOf = (file: Buffer, headBytes = 64 * 1024): ContainerIndex => {
  const read = readIndex(file.subarray(0, headBytes), file.length);
  assert.ok(read.ok, JSON.stringify(read));
  return read.index;
};

for (const [name, file] of [
  ["webm(Cues)", () => webm],
  ["m4a(sidx)", () => m4a],
] as const) {
  test(`실제 파일 ${name}: 색인을 읽고, 고른 키프레임 자리의 실제 바이트가 확인을 통과한다`, (t) => {
    const buf = file();
    if (!buf) return t.skip("ffmpeg로 시료를 만들 수 없음");
    const index = indexOf(buf);
    assert.ok(index.points.length >= 20, `키프레임 ${index.points.length}`);
    assert.ok(Math.abs(index.points.at(-1)!.ms - 58_000) < 3000, `마지막 ${index.points.at(-1)!.ms}`);
    const start = startPoint(index, { targetMs: 40_000, durationMs: 60_000, chunkBytes: 1 });
    assert.ok("byte" in start, JSON.stringify(start));
    assert.ok(start.startedAtMs <= 39_000 && start.startedAtMs > 30_000, `시작 ${start.startedAtMs}`);
    assert.equal(start.expectStart(buf.subarray(start.byte, start.byte + FIRST_BYTES[index.kind])), true, "그 자리가 키프레임");
    assert.equal(start.expectStart(buf.subarray(start.byte + 1, start.byte + 1 + FIRST_BYTES[index.kind])), false, "한 바이트 어긋나면 아니다");
    // 다른 키프레임의 자리를 주면 아니다(webm 은 클러스터 시각까지 본다)
    const other = index.points.find((p) => p.byte !== start.byte)!;
    if (index.kind === "webm") assert.equal(start.expectStart(buf.subarray(other.byte, other.byte + 32)), false, "다른 클러스터");
  });
}

test("실제 파일: 머리는 첫 클러스터 · moov 까지, webm 은 Segment 크기를 같은 너비의 크기 모름으로", (t) => {
  if (!webm || !m4a) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const w = indexOf(webm);
  const header = headerOf(webm, w);
  assert.equal(header.length, w.headerEnd);
  const at = w.segment!.at + 4;
  assert.equal(header[at] & (0x80 >> (w.segment!.width - 1)), 0x80 >> (w.segment!.width - 1), "길이 표시 비트는 그대로");
  assert.deepEqual([...header.subarray(at + 1, at + w.segment!.width)], new Array(w.segment!.width - 1).fill(0xff));
  assert.notDeepEqual(header.subarray(at, at + w.segment!.width), webm.subarray(at, at + w.segment!.width));
  assert.equal(Buffer.compare(header.subarray(at + w.segment!.width), webm.subarray(at + w.segment!.width, w.headerEnd)), 0, "나머지는 그대로");

  const m = indexOf(m4a);
  assert.equal(Buffer.compare(headerOf(m4a, m), m4a.subarray(0, m.headerEnd)), 0);
  assert.equal(m4a.toString("latin1", m.headerEnd + 4, m.headerEnd + 8), "sidx", "머리는 moov 끝까지(sidx 는 넣지 않는다)");
});

test("실제 파일: 앞부분이 모자라면 더 받을 양을 알린다", (t) => {
  if (!webm || !m4a) return t.skip("ffmpeg로 시료를 만들 수 없음");
  for (const file of [webm, m4a]) {
    const read = readIndex(file.subarray(0, 60), file.length);
    assert.ok(!read.ok && "need" in read && read.need > 60, JSON.stringify(read));
    assert.ok(readIndex(file.subarray(0, read.need), file.length).ok || "need" in readIndex(file.subarray(0, read.need), file.length));
  }
});

// ── 손으로 만든 바이트 ──

const hexId = (id: number) => Buffer.from(id.toString(16).padStart(id > 0xffffff ? 8 : id > 0xffff ? 6 : id > 0xff ? 4 : 2, "0"), "hex");
/** EBML 요소(크기는 8바이트 표기) */
function el(id: number, ...children: Buffer[]): Buffer {
  const body = Buffer.concat(children);
  const size = Buffer.alloc(8);
  size[0] = 0x01;
  size.writeUIntBE(body.length, 2, 6);
  return Buffer.concat([hexId(id), size, body]);
}
const uint = (id: number, value: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(value));
  return el(id, b);
};

/** webm: cues 의 [시각, 클러스터 차례(몇 번째 클러스터), 트랙들] 로 Cues 를 만든다. 클러스터는 2초 간격 */
function makeWebm(cues: Array<{ time?: number; cluster?: number; tracks?: number[] }>, { clusters = 10, scale = 1_000_000 } = {}) {
  const info = el(0x1549a966, uint(0x2ad7b1, scale));
  const tracks = el(0x1654ae6b, el(0xae, uint(0xd7, 1), uint(0x83, 1)), el(0xae, uint(0xd7, 2), uint(0x83, 2)));
  const clusterBufs = Array.from({ length: clusters }, (_, i) => el(0x1f43b675, uint(0xe7, i * 2000), Buffer.alloc(100, i)));
  // Cues 의 크기는 위치 값과 상관없이 같다(8바이트 표기). 한 번 만들어 크기를 알고 위치를 다시 넣는다
  const build = (positions: number[]) =>
    el(
      0x1c53bb6b,
      ...cues.map((c, i) => {
        const fields = [] as Buffer[];
        if (c.time !== undefined) fields.push(uint(0xb3, c.time));
        for (const track of c.tracks ?? [2]) fields.push(el(0xb7, uint(0xf7, track), ...(c.cluster === undefined ? [] : [uint(0xf1, positions[i] + (track === 1 ? 7 : 0))])));
        return el(0xbb, ...fields);
      }),
    );
  const before = Buffer.concat([info, tracks]);
  const cuesSize = build(cues.map(() => 0)).length;
  const clusterStart = (k: number) => before.length + cuesSize + clusterBufs.slice(0, k).reduce((sum, b) => sum + b.length, 0);
  const body = Buffer.concat([before, build(cues.map((c) => clusterStart(c.cluster ?? 0))), ...clusterBufs]);
  return Buffer.concat([el(0x1a45dfa3, uint(0x4286, 1)), el(0x18538067, body)]);
}

test("webm: 값이 빠진 CuePoint 는 버리고, 트랙이 둘이면 오디오 트랙의 자리, 겹치는 자리는 앞의 것", () => {
  const file = makeWebm([{ time: 0, cluster: 0 }, { time: 2000 }, { time: 4000, cluster: 2, tracks: [1, 2] }, { cluster: 3 }, { time: 6000, cluster: 3 }, { time: 6500, cluster: 3 }]);
  const read = readIndex(file, file.length);
  assert.ok(read.ok, JSON.stringify(read));
  assert.deepEqual(
    read.index.points.map((p) => p.ms),
    [0, 4000, 6000],
  );
  const [, second] = read.index.points;
  assert.equal(file.subarray(second.byte, second.byte + 4).toString("hex"), "1f43b675", "오디오 트랙(2)의 자리");
});

test("webm: TimecodeScale 을 따른다", () => {
  const file = makeWebm(
    [
      { time: 0, cluster: 0 },
      { time: 200, cluster: 1 },
    ],
    { scale: 10_000_000 },
  );
  const read = readIndex(file, file.length);
  assert.ok(read.ok);
  assert.deepEqual(
    read.index.points.map((p) => p.ms),
    [0, 2000],
  );
});

test("webm: Cues 가 첫 클러스터 앞에 없거나 · 시각이 줄거나 · 자리가 파일 밖이거나 · 크기 모를 요소가 앞에 있으면 없음", () => {
  const noCues = Buffer.concat([el(0x1a45dfa3), el(0x18538067, el(0x1549a966, uint(0x2ad7b1, 1_000_000)), el(0x1f43b675, uint(0xe7, 0)))]);
  const shrinking = makeWebm([
    { time: 4000, cluster: 2 },
    { time: 2000, cluster: 1 },
  ]);
  const file = makeWebm([
    { time: 0, cluster: 0 },
    { time: 2000, cluster: 1 },
  ]);
  const unknown = Buffer.concat([el(0x1a45dfa3), hexId(0x18538067), Buffer.from("01ffffffffffffff", "hex"), hexId(0x1549a966), Buffer.from("01ffffffffffffff", "hex")]);
  for (const [buf, total, why] of [
    [noCues, noCues.length, /Cues 가 첫 클러스터 앞에 없음/],
    [shrinking, shrinking.length, /늘어나지 않음/],
    [file, 300, /파일 밖/],
    [unknown, 10_000, /크기 모를 요소/],
    [Buffer.from("not media at all"), 100, /webm · mp4 가 아님/],
  ] as const) {
    const read = readIndex(buf, total);
    assert.ok(!read.ok && "why" in read && why.test(read.why), JSON.stringify(read));
  }
});

/** mp4 상자 */
function box(type: string, ...children: Buffer[]): Buffer {
  const body = Buffer.concat(children);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
}
/** sidx: version · timescale · EPT · first_offset · 항목[크기, 길이, 계층형] */
function sidx({ version = 0, timescale = 1000, ept = 0, firstOffset = 0, refs }: { version?: number; timescale?: number; ept?: number; firstOffset?: number; refs: Array<[number, number, boolean?]> }): Buffer {
  const fixed = Buffer.alloc(version === 1 ? 28 : 20);
  fixed[0] = version;
  fixed.writeUInt32BE(1, 4);
  fixed.writeUInt32BE(timescale, 8);
  if (version === 1) {
    fixed.writeBigUInt64BE(BigInt(ept), 12);
    fixed.writeBigUInt64BE(BigInt(firstOffset), 20);
  } else {
    fixed.writeUInt32BE(ept, 12);
    fixed.writeUInt32BE(firstOffset, 16);
  }
  const count = Buffer.alloc(4);
  count.writeUInt16BE(refs.length, 2);
  const entries = refs.map(([size, duration, nested]) => {
    const b = Buffer.alloc(12);
    b.writeUInt32BE(((nested ? 0x80000000 : 0) | size) >>> 0);
    b.writeUInt32BE(duration, 4);
    b.writeUInt32BE(0x90000000, 8);
    return b;
  });
  return box("sidx", fixed, count, ...entries);
}

test("mp4: 조각 시작은 sidx 다음 바이트 + first_offset, version 1(64비트)도 읽는다", () => {
  for (const version of [0, 1]) {
    const head = Buffer.concat([box("ftyp", Buffer.from("isom")), box("moov", Buffer.alloc(50))]);
    const index = sidx({
      version,
      timescale: 48000,
      ept: 48000,
      firstOffset: 10,
      refs: [
        [1000, 480000],
        [1000, 480000],
        [500, 240000],
      ],
    });
    const file = Buffer.concat([head, index, Buffer.alloc(10), box("moof", Buffer.alloc(992)), box("moof", Buffer.alloc(992)), box("moof", Buffer.alloc(492))]);
    const read = readIndex(file, file.length);
    assert.ok(read.ok, JSON.stringify(read));
    const anchor = head.length + index.length + 10;
    assert.deepEqual(
      read.index.points.map((p) => [p.ms, p.byte]),
      [
        [1000, anchor],
        [11000, anchor + 1000],
        [21000, anchor + 2000],
      ],
      `version ${version}`,
    );
    assert.equal(read.index.headerEnd, head.length);
  }
});

test("mp4: 계층형 sidx · timescale 0 · 항목 없음 · 끝이 파일 밖 · moov 앞의 sidx · 조각 뒤의 sidx 는 없음", () => {
  const ftyp = box("ftyp", Buffer.from("isom"));
  const moov = box("moov", Buffer.alloc(20));
  const cases: Array<[Buffer, RegExp]> = [
    [Buffer.concat([ftyp, moov, sidx({ refs: [[100, 1000, true]] })]), /계층형/],
    [Buffer.concat([ftyp, moov, sidx({ timescale: 0, refs: [[100, 1000]] })]), /timescale 이 0/],
    [Buffer.concat([ftyp, moov, sidx({ refs: [] })]), /항목이 없음/],
    [Buffer.concat([ftyp, moov, sidx({ refs: [[100000, 1000]] })]), /파일 밖/],
    [Buffer.concat([ftyp, sidx({ refs: [[100, 1000]] }), moov]), /moov 앞/],
    [Buffer.concat([ftyp, moov, box("moof", Buffer.alloc(10)), sidx({ refs: [[100, 1000]] })]), /조각 앞에 없음/],
  ];
  for (const [buf, why] of cases) {
    const read = readIndex(buf, buf.length + 200);
    assert.ok(!read.ok && "why" in read && why.test(read.why), `${why} → ${JSON.stringify(read)}`);
  }
});

test("머리: Segment 크기를 같은 너비의 크기 모름으로(4바이트 표기면 1F FF FF FF), 나머지 바이트는 그대로", () => {
  const body = Buffer.concat([el(0x1549a966, uint(0x2ad7b1, 1_000_000)), el(0x1c53bb6b, el(0xbb, uint(0xb3, 0), el(0xb7, uint(0xf7, 1), uint(0xf1, 0)))), el(0x1f43b675, uint(0xe7, 0), Buffer.alloc(50))]);
  // Cues 의 자리(0)가 첫 클러스터를 가리키도록 Info · Cues 를 클러스터 뒤가 아니라 앞에 두되, 위치 값은 클러스터 자리로 다시 쓴다
  const clusterAt = body.indexOf(Buffer.from("1f43b675", "hex"));
  const fixed = Buffer.concat([el(0x1549a966, uint(0x2ad7b1, 1_000_000)), el(0x1c53bb6b, el(0xbb, uint(0xb3, 0), el(0xb7, uint(0xf7, 1), uint(0xf1, clusterAt)))), el(0x1f43b675, uint(0xe7, 0), Buffer.alloc(50))]);
  const size4 = Buffer.alloc(4);
  size4.writeUInt32BE(0x10000000 | fixed.length);
  const file = Buffer.concat([el(0x1a45dfa3, uint(0x4286, 1)), hexId(0x18538067), size4, fixed]);
  const read = readIndex(file, file.length);
  assert.ok(read.ok, JSON.stringify(read));
  assert.equal(read.index.segment!.width, 4);
  const header = headerOf(file, read.index);
  const at = read.index.segment!.at + 4;
  assert.equal(header.subarray(at, at + 4).toString("hex"), "1fffffff");
  assert.equal(Buffer.compare(header.subarray(at + 4), file.subarray(at + 4, read.index.headerEnd)), 0);
});

// ── 시작점 · 묻기 전에 거르기 ──

const synthetic = (points: Array<[number, number]>): ContainerIndex => ({ kind: "mp4", headerEnd: 100, segment: null, points: points.map(([ms, byte]) => ({ ms, byte, raw: ms })) });

test("시작점: 목표보다 1초 넘게 앞선 마지막 키프레임. 첫 청크 안 · 앞에 없음 · 마지막이 곡 길이와 크게 다르면 없음", () => {
  const index = synthetic([
    [0, 100],
    [10_000, 2_000_000],
    [20_000, 4_000_000],
    [30_000, 6_000_000],
  ]);
  const at = (targetMs: number, durationMs = 35_000, chunkBytes = 1_048_576) => startPoint(index, { targetMs, durationMs, chunkBytes });
  assert.deepEqual([(at(25_000) as { byte: number }).byte, (at(25_000) as { startedAtMs: number }).startedAtMs], [4_000_000, 20_000]);
  assert.equal((at(20_500) as { startedAtMs: number }).startedAtMs, 10_000, "예열 1초가 모자라면 한 키프레임 앞");
  assert.equal((at(21_000) as { startedAtMs: number }).startedAtMs, 20_000, "딱 1초면 그 키프레임");
  assert.match((at(9_000) as { why: string }).why, /첫 청크 안/);
  assert.match((at(500) as { why: string }).why, /키프레임이 없음/);
  assert.match((at(25_000, 200_000) as { why: string }).why, /곡 길이/, "마지막 키프레임이 곡 끝보다 한참 앞");
  assert.match((at(25_000, 20_000) as { why: string }).why, /곡 길이/, "마지막 키프레임이 곡 끝보다 뒤");
  assert.match((at(25_000, 0) as { why: string }).why, /곡 길이/, "길이를 모르면");
});

test("묻기 전에 거르기: 목표 바이트 어림이 첫 청크 둘 밖일 때만", () => {
  const base = { durationMs: 6_000_000, totalBytes: 120_000_000, chunkBytes: 1_048_576 };
  assert.equal(worthIndexing({ ...base, startMs: 60_000 }), false, "1분 = 1.2MB < 2MB");
  assert.equal(worthIndexing({ ...base, startMs: 120_000 }), true, "2분 = 2.4MB");
  assert.equal(worthIndexing({ ...base, startMs: 0 }), false);
  assert.equal(worthIndexing({ ...base, startMs: 120_000, durationMs: 0 }), false, "길이를 모르면");
});
