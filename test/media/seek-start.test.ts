// src/media/seek-start.ts — 위치를 옮길 때 받기 시작할 자리(헤더 · 키프레임 바이트)를 묻는다.
// 요청은 가짜(파일 바이트를 Range 로 준다). 끝에서는 진짜 청크 스트림 · ffmpeg 로 색인 길과 처음부터 받은 길의 소리를 견준다

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import type { Readable } from "node:stream";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { seekStart, type SeekRequest } from "../../src/media/seek-start.ts";
import { openChunkedStream, type RangeFetch } from "../../src/media/chunked-stream.ts";
import { buildFfmpegArgs } from "../../src/media/ffmpeg/args.ts";
import { spawnFfmpeg } from "../../src/media/ffmpeg/process.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-seek-start-"));
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

const files: Record<"webm" | "m4a", Buffer | null> = { webm: null, m4a: null };
before(async () => {
  // 주파수가 바뀌는 소리(어긋나면 소리가 달라진다)
  const tone = ["-f", "lavfi", "-i", "aevalsrc=0.4*sin(2*PI*(200+3*t)*t):s=48000:d=120"];
  if (await ffmpeg([...tone, "-c:a", "libopus", "-b:a", "64k", "-f", "webm", "-cues_to_front", "1", "-cluster_time_limit", "2000", "-y", path.join(DIR, "a.webm")])) files.webm = fs.readFileSync(path.join(DIR, "a.webm"));
  if (await ffmpeg([...tone, "-c:a", "aac", "-b:a", "96k", "-movflags", "+dash+global_sidx", "-frag_duration", "2000000", "-y", path.join(DIR, "a.m4a")])) files.m4a = fs.readFileSync(path.join(DIR, "a.m4a"));
});

/** 파일 바이트를 Range 로 주는 가짜. status 를 주면 그 상태, hang 이면 끊을 때까지 답하지 않는다 */
function fileFetch(file: Buffer, { status = 206, hang = false } = {}) {
  const asked: string[] = [];
  const fetchImpl: RangeFetch = async (_url, { headers, signal }) => {
    asked.push(headers.Range);
    if (hang) await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    const [, from, to] = /bytes=(\d+)-(\d*)/.exec(headers.Range) ?? [];
    const start = Number(from);
    const end = to ? Math.min(Number(to), file.length - 1) : file.length - 1;
    const body = status === 200 ? file : file.subarray(start, end + 1);
    let sent = false;
    return {
      status,
      headers: { get: (k: string) => (k.toLowerCase() === "content-range" && status === 206 ? `bytes ${start}-${end}/${file.length}` : null) },
      body: { getReader: () => ({ read: async () => (sent ? { done: true as const } : ((sent = true), { done: false as const, value: new Uint8Array(body) })) }) },
    };
  };
  return { fetchImpl, asked };
}

const request = (file: Buffer, over: Partial<SeekRequest> = {}): SeekRequest => ({ url: "https://rr.test/a", headers: {}, totalBytes: file.length, startMs: 90_000, durationMs: 120_000, chunkBytes: 64 * 1024, ...over });

for (const kind of ["webm", "m4a"] as const) {
  test(`${kind}: 헤더 · 키프레임 바이트 · 그 자리의 첫 바이트 확인을 준다`, async (t) => {
    const file = files[kind];
    if (!file) return t.skip("ffmpeg로 시료를 만들 수 없음");
    const { fetchImpl, asked } = fileFetch(file);
    const answer = await seekStart(request(file), { fetchImpl });
    assert.ok(answer.ok, JSON.stringify(answer));
    const { header, startByte, startedAtMs, expectStart } = answer.start;
    assert.ok(startedAtMs <= 89_000 && startedAtMs > 80_000, `시작 ${startedAtMs}`);
    assert.equal(expectStart.check(file.subarray(startByte, startByte + expectStart.bytes)), true);
    assert.ok(header.length > 0 && header.length < startByte);
    assert.deepEqual(asked, ["bytes=0-65535"]);
  });
}

test("가까운 위치는 묻지 않는다 · 색인이 처음 받은 양보다 길면 모자란 만큼 더 받는다", async (t) => {
  const file = files.webm;
  if (!file) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const near = fileFetch(file);
  assert.deepEqual(await seekStart(request(file, { startMs: 3000 }), { fetchImpl: near.fetchImpl }), { ok: false, why: "가까운 위치", near: true });
  assert.equal(near.asked.length, 0);

  const more = fileFetch(file);
  // Cues 중간에서 끊기는 양
  const answer = await seekStart(request(file), { fetchImpl: more.fetchImpl, headBytes: 300 });
  assert.ok(answer.ok, JSON.stringify(answer));
  assert.equal(more.asked.length, 2, more.asked.join(" "));
  assert.equal(more.asked[0], "bytes=0-299");
});

test("헤더 요청이 206 이 아니면 · 받지 못하면 · 한도를 넘으면 없음(한도는 slow)", async (t) => {
  const file = files.webm;
  if (!file) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const ignored = await seekStart(request(file), { fetchImpl: fileFetch(file, { status: 200 }).fetchImpl });
  assert.ok(!ignored.ok && /HTTP 200/.test(ignored.why) && !ignored.slow);
  const failing: RangeFetch = async () => {
    throw new Error("ECONNRESET");
  };
  const down = await seekStart(request(file), { fetchImpl: failing });
  assert.ok(!down.ok && /ECONNRESET/.test(down.why) && !down.slow);
  const slow = await seekStart(request(file), { fetchImpl: fileFetch(file, { hang: true }).fetchImpl, timeoutMs: 50 });
  assert.ok(!slow.ok && slow.slow === true, JSON.stringify(slow));
});

test("곡 길이가 색인과 크게 다르면(시간 축을 잘못 읽은 것) 없음", async (t) => {
  const file = files.m4a;
  if (!file) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const answer = await seekStart(request(file, { durationMs: 600_000, startMs: 90_000 }), { fetchImpl: fileFetch(file).fetchImpl });
  assert.ok(!answer.ok && /곡 길이/.test(answer.why), JSON.stringify(answer));
});

// ── 진짜 청크 스트림 · ffmpeg ──

/** 청크 스트림을 ffmpeg 에 넣고 PCM 2초 */
function pcmOf(stream: Readable, seekMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawnFfmpeg(buildFfmpegArgs({ seekMs }), "probe", { killOnStdoutClose: false });
    const chunks: Buffer[] = [];
    let got = 0;
    const want = 48000 * 4 * 2;
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      got += chunk.length;
      if (got >= want) child.kill("SIGKILL");
    });
    child.stdin.on("error", () => {});
    child.on("error", reject);
    child.on("exit", () => {
      stream.destroy();
      resolve(Buffer.concat(chunks).subarray(0, want));
    });
    stream.pipe(child.stdin);
  });
}

/** 왼쪽 채널로 b 를 a 에 대어 ±5ms 안의 가장 잘 맞는 어긋남(ms)과 상관 */
function bestLag(a: Buffer, b: Buffer) {
  const at = (buf: Buffer, i: number) => buf.readInt16LE(i * 4);
  let best = { lagMs: 0, corr: -1 };
  for (let lag = -240; lag <= 240; lag++) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let i = 4800; i < 4800 + 24000; i += 3) {
      const x = at(a, i);
      const y = at(b, i + lag);
      xy += x * y;
      xx += x * x;
      yy += y * y;
    }
    const corr = xy / Math.sqrt(xx * yy || 1);
    if (corr > best.corr) best = { lagMs: lag / 48, corr };
  }
  return best;
}

for (const kind of ["webm", "m4a"] as const) {
  test(`실물 ${kind}: 색인 길(헤더 + 키프레임부터 · 남은 -ss)의 소리가 처음부터 받은 길과 같다(어긋남 2ms 안)`, async (t) => {
    const file = files[kind];
    if (!file) return t.skip("ffmpeg로 시료를 만들 수 없음");
    const startMs = 90_500;
    const { fetchImpl } = fileFetch(file);
    const base = { url: "https://rr.test/a", headers: {}, totalBytes: file.length, chunkSize: 64 * 1024, fetchImpl };
    const answer = await seekStart(request(file, { startMs }), { fetchImpl });
    assert.ok(answer.ok, JSON.stringify(answer));
    const { header, startByte, startedAtMs, expectStart } = answer.start;
    const indexed = await pcmOf(await openChunkedStream({ ...base, startByte, prefix: header, expectStart }), startMs - startedAtMs);
    const whole = await pcmOf(await openChunkedStream(base), startMs);
    const { lagMs, corr } = bestLag(whole, indexed);
    assert.ok(Math.abs(lagMs) <= 2 && corr > 0.999, `어긋남 ${lagMs}ms · 상관 ${corr.toFixed(5)}`);
  });
}
