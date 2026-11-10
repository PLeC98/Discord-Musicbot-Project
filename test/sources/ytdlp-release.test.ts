// src/sources/ytdlp-release.ts: 환경마다 onedir 자산을 정하고, 한 태그의 체크섬 목록, 서명, zip 을 받아 서명과 SHA-256 을 맞춘다. 전송은 가짜다
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assetFor, fetchRelease, sumOf, useFetch, type ReleaseError } from "../../src/sources/ytdlp-release.ts";
import { PROJECT } from "../../src/infra/project-paths.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-release-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));
afterEach(() => useFetch(null));

const SUMS = fs.readFileSync(path.join(PROJECT.root, "test", "fixtures", "ytdlp", "SHA2-256SUMS"));
const SIG = fs.readFileSync(path.join(PROJECT.root, "test", "fixtures", "ytdlp", "SHA2-256SUMS.sig"));
const BASE = "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26";

/** 주소마다 응답을 주는 가짜 전송. 부른 주소를 모은다 */
function serve(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  useFetch((async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    return routes[url]?.() ?? new Response("Not Found", { status: 404 });
  }) as typeof fetch);
  return asked;
}
const zipName = () => path.join(DIR, `${crypto.randomUUID()}.zip`);
const kindOf = (kind: string) => (error: unknown) => (error as ReleaseError).kind === kind;
const sha = (data: Buffer) => crypto.createHash("sha256").update(data).digest("hex");

test("환경마다 자산과 실행 파일 이름(Windows arm64 의 실행 파일에는 _win_ 이 없다)", () => {
  const of = (platform: NodeJS.Platform, arch: string, libc: "glibc" | "musl" | null = null) => assetFor({ platform, arch, libc, channel: "nightly" });
  assert.deepEqual(of("win32", "x64"), { zip: "yt-dlp_win.zip", exe: "yt-dlp.exe" });
  assert.deepEqual(of("win32", "arm64"), { zip: "yt-dlp_win_arm64.zip", exe: "yt-dlp_arm64.exe" });
  assert.deepEqual(of("darwin", "x64"), { zip: "yt-dlp_macos.zip", exe: "yt-dlp_macos" });
  assert.deepEqual(of("darwin", "arm64"), { zip: "yt-dlp_macos.zip", exe: "yt-dlp_macos" });
  assert.deepEqual(of("linux", "x64", "glibc"), { zip: "yt-dlp_linux.zip", exe: "yt-dlp_linux" });
  assert.deepEqual(of("linux", "arm64", "glibc"), { zip: "yt-dlp_linux_aarch64.zip", exe: "yt-dlp_linux_aarch64" });
  assert.deepEqual(of("linux", "x64", "musl"), { zip: "yt-dlp_musllinux.zip", exe: "yt-dlp_musllinux" });
  assert.deepEqual(of("linux", "arm64", "musl"), { zip: "yt-dlp_musllinux_aarch64.zip", exe: "yt-dlp_musllinux_aarch64" });
});

test("armv7l 판은 stable 에만 있다. 표에 없는 환경은 까닭을 준다", () => {
  assert.deepEqual(assetFor({ platform: "linux", arch: "arm", libc: "glibc", channel: "stable" }), { zip: "yt-dlp_linux_armv7l.zip", exe: "yt-dlp_linux_armv7l" });
  assert.deepEqual(assetFor({ platform: "linux", arch: "arm", libc: "glibc", channel: "nightly" }), { missing: "nightly 채널에는 arm 판이 없음(YTDLP_CHANNEL=stable 로 바꾸세요)" });
  assert.deepEqual(assetFor({ platform: "linux", arch: "arm", libc: "musl", channel: "stable" }), { missing: "이 OS, CPU 용 yt-dlp 판이 없음(linux-arm-musl)" });
  assert.deepEqual(assetFor({ platform: "freebsd", arch: "x64", libc: null, channel: "stable" }), { missing: "이 OS, CPU 용 yt-dlp 판이 없음(freebsd-x64)" });
  assert.deepEqual(assetFor({ platform: "win32", arch: "ia32", libc: null, channel: "stable" }), { missing: "이 OS, CPU 용 yt-dlp 판이 없음(win32-ia32)" });
});

test("체크섬 목록: 이름이 정확히 같은 줄 하나(앞부분이 같은 다른 자산, 바이너리 표시, 둘 이상)", () => {
  const list = SUMS.toString("utf8");
  assert.equal(sumOf(list, "yt-dlp_win.zip"), "fd51b212cf8380c7a52ee08c0d6be7f3c59b2f2c832eaf7b45acfae6eab57419");
  assert.notEqual(sumOf(list, "yt-dlp_win_arm64.zip"), sumOf(list, "yt-dlp_win.zip"));
  assert.equal(sumOf(`${"a".repeat(64)} *x.zip\n`, "x.zip"), "a".repeat(64));
  assert.equal(sumOf(`${"a".repeat(64)}  x.zip\n${"b".repeat(64)}  x.zip\n`, "x.zip"), null);
  assert.equal(sumOf(list, "없는.zip"), null);
});

test("서명을 맞춘 뒤 zip 을 받으며 SHA-256 을 본다. 다르면 integrity", async () => {
  serve({
    [`${BASE}/SHA2-256SUMS`]: () => new Response(SUMS),
    [`${BASE}/SHA2-256SUMS.sig`]: () => new Response(SIG),
    [`${BASE}/yt-dlp_win.zip`]: () => new Response("진짜가 아닌 zip"),
  });
  await assert.rejects(fetchRelease({ repo: "yt-dlp/yt-dlp", tag: "2026.10.26", asset: "yt-dlp_win.zip", zipFile: zipName() }), kindOf("integrity"));
});

test("체크섬 목록이 서명과 맞지 않으면 zip 을 받지 않는다(signature)", async () => {
  const asked = serve({
    [`${BASE}/SHA2-256SUMS`]: () => new Response(Buffer.concat([SUMS, Buffer.from(`${"0".repeat(64)}  evil.zip\n`)])),
    [`${BASE}/SHA2-256SUMS.sig`]: () => new Response(SIG),
  });
  await assert.rejects(fetchRelease({ repo: "yt-dlp/yt-dlp", tag: "2026.10.26", asset: "yt-dlp_win.zip", zipFile: zipName() }), (error: unknown) => kindOf("signature")(error) && /서명이 맞지 않음/.test((error as Error).message));
  assert.ok(!asked.some((url) => url.endsWith(".zip")), asked.join("\n"));
});

test("skipSignature: 서명은 받지 않고 체크섬은 본다. 맞으면 zipFile 에 그대로 쓴다", async () => {
  const zip = crypto.randomBytes(300_000);
  const asked = serve({
    [`${BASE}/SHA2-256SUMS`]: () => new Response(`${sha(zip)}  yt-dlp_win.zip\n`),
    [`${BASE}/yt-dlp_win.zip`]: () => new Response(zip),
  });
  const file = zipName();
  await fetchRelease({ repo: "yt-dlp/yt-dlp", tag: "2026.10.26", asset: "yt-dlp_win.zip", zipFile: file, skipSignature: true });
  assert.ok(fs.readFileSync(file).equals(zip));
  assert.ok(!asked.some((url) => url.endsWith(".sig")));
  await assert.rejects(fetchRelease({ repo: "yt-dlp/yt-dlp", tag: "2026.10.26", asset: "yt-dlp_win.zip", zipFile: file, skipSignature: true }), "이미 있는 zipFile 에 쓰지 않는다");
});

test("없는 태그, 목록에 없는 자산은 missing. 서버 오류, 받다 끊김, 끊으라는 신호는 network. 큰 목록은 integrity", async () => {
  const zip = Buffer.from("zip");
  const list = `${sha(zip)}  yt-dlp_win.zip\n`;
  const fetchOne = (extra: Partial<Parameters<typeof fetchRelease>[0]> = {}) => fetchRelease({ repo: "yt-dlp/yt-dlp", tag: "2026.10.26", asset: "yt-dlp_win.zip", zipFile: zipName(), skipSignature: true, ...extra });

  serve({});
  await assert.rejects(fetchOne(), kindOf("missing"));
  serve({ [`${BASE}/SHA2-256SUMS`]: () => new Response(list) });
  await assert.rejects(fetchOne({ asset: "yt-dlp_linux.zip" }), kindOf("missing"));
  serve({ [`${BASE}/SHA2-256SUMS`]: () => new Response(list), [`${BASE}/yt-dlp_win.zip`]: () => new Response("busy", { status: 503 }) });
  await assert.rejects(fetchOne(), kindOf("network"));
  serve({
    [`${BASE}/SHA2-256SUMS`]: () => new Response(list),
    [`${BASE}/yt-dlp_win.zip`]: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.error(new Error("socket hang up"));
          },
        }),
      ),
  });
  await assert.rejects(fetchOne(), kindOf("network"));
  serve({ [`${BASE}/SHA2-256SUMS`]: () => new Response(Buffer.alloc(70 * 1024, 0x20)) });
  await assert.rejects(fetchOne(), kindOf("integrity"));

  useFetch((async (_input: unknown, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    return new Response(list);
  }) as typeof fetch);
  await assert.rejects(fetchOne({ signal: AbortSignal.abort() }), kindOf("network"));
});
