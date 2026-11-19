// yt-dlp 릴리스의 onedir 판(실행 파일과 _internal 폴더를 담은 zip) 다운로드. 이 환경의 에셋을 정하고, 한 태그의 주소에서 체크섬 목록, 그 서명, zip을 받아
// 서명(yt-dlp의 키를 지문으로 고정)과 SHA-256을 맞춘다. 자체 업데이트(--update-to)는 onedir을 받지 않고, Windows 판은 onefile로 덮어 쓰므로 쓰지 않는다.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type config from "../config/index.ts";
import { httpFor } from "../infra/http.ts";
import { pinnedKey, verifyDetached, type PinnedKey } from "../infra/openpgp.ts";
import { PROJECT } from "../infra/project-paths.ts";
import { josa } from "../rules/josa.ts";

type Channel = (typeof config.ytdlp)["channel"];
type Libc = "glibc" | "musl";
/** zip: 릴리스 에셋 이름, exe: zip 맨 위의 실행 파일 이름 */
type Asset = { zip: string; exe: string };
/**
 * 실패의 종류. 호출부가 다시 할 때를 정한다.
 * network: 연결, 시간 초과, HTTP 오류. integrity: 체크섬이 맞지 않음, 크기 상한. missing: 릴리스에 이 에셋이 없음. signature: 서명이 맞지 않음(키 교체일 수 있다)
 */
type FailureKind = "network" | "integrity" | "missing" | "signature";
type ReleaseError = Error & { kind: FailureKind };

// 에셋 이름과 실행 파일 이름은 yt-dlp의 bundle/pyinstaller.py가 정한다. Windows arm64의 실행 파일에는 _win_이 없다
const ASSETS: Record<string, Asset> = {
  "win32-x64": { zip: "yt-dlp_win.zip", exe: "yt-dlp.exe" },
  "win32-arm64": { zip: "yt-dlp_win_arm64.zip", exe: "yt-dlp_arm64.exe" },
  "darwin-x64": { zip: "yt-dlp_macos.zip", exe: "yt-dlp_macos" },
  "darwin-arm64": { zip: "yt-dlp_macos.zip", exe: "yt-dlp_macos" },
  "linux-x64-glibc": { zip: "yt-dlp_linux.zip", exe: "yt-dlp_linux" },
  "linux-arm64-glibc": { zip: "yt-dlp_linux_aarch64.zip", exe: "yt-dlp_linux_aarch64" },
  "linux-arm-glibc": { zip: "yt-dlp_linux_armv7l.zip", exe: "yt-dlp_linux_armv7l" },
  "linux-x64-musl": { zip: "yt-dlp_musllinux.zip", exe: "yt-dlp_musllinux" },
  "linux-arm64-musl": { zip: "yt-dlp_musllinux_aarch64.zip", exe: "yt-dlp_musllinux_aarch64" },
};
// armv7l 판은 stable 릴리스에만 있다(nightly, master 빌드는 만들지 않는다)
const STABLE_ONLY = new Set(["yt-dlp_linux_armv7l.zip"]);

const SIGNING_FINGERPRINT = "AC0C BBE6 848D 6A87 3464 AF4E 57CF 6593 3B5A 7581";
const SIGNING_KEY = path.join(PROJECT.data, "yt-dlp-signing-key.asc");
const SUMS = "SHA2-256SUMS";
const SUMS_MAX = 64 * 1024; // 체크섬 목록과 서명 각각(지금 2KB 안팎)
const ZIP_MAX = 200 * 1024 * 1024; // 지금 가장 큰 macOS 판이 54MB
const IDLE_MS = 60_000; // 응답이나 다음 청크가 이만큼 오지 않으면 끊는다
const TOTAL_MS = 30 * 60_000;

const github = httpFor("github");

const failure = (kind: FailureKind, message: string): ReleaseError => Object.assign(new Error(message), { kind });

let libc: Libc | null = null;
/** Linux의 C 라이브러리. Node의 진단 보고서에 glibc 버전이 있으면 glibc, 없으면 musl이다(한 번만 잰다) */
function libcNow(): Libc {
  libc ??= (process.report.getReport() as { header?: { glibcVersionRuntime?: string } }).header?.glibcVersionRuntime ? "glibc" : "musl";
  return libc;
}

/** 이 환경의 onedir 에셋. 없으면 이유 */
function assetFor({ platform, arch, libc: lib, channel }: { platform: NodeJS.Platform; arch: string; libc: Libc | null; channel: Channel }): Asset | { missing: string } {
  const where = platform === "linux" ? `${platform}-${arch}-${lib ?? "glibc"}` : `${platform}-${arch}`;
  const asset = ASSETS[where];
  if (!asset) return { missing: `이 OS, CPU 용 yt-dlp 판이 없음(${where})` };
  if (STABLE_ONLY.has(asset.zip) && channel !== "stable") return { missing: `${channel} 채널에는 ${arch} 판이 없음(운영자 패널 업데이트 탭의 yt-dlp 채널을 stable로 바꾸세요)` };
  return asset;
}

/** 지금 돌고 있는 환경의 에셋 */
const assetHere = (channel: Channel) => assetFor({ platform: process.platform, arch: process.arch, libc: process.platform === "linux" ? libcNow() : null, channel });

let key: PinnedKey | null = null;
const signingKey = () => (key ??= pinnedKey(fs.readFileSync(SIGNING_KEY, "utf8"), SIGNING_FINGERPRINT));

/** 체크섬 목록에서 에셋 줄 하나의 SHA-256(GNU 형식 `<hex>  <이름>`, 바이너리 표시 `*`도 받는다). 없거나 둘 이상이면 null */
function sumOf(list: string, name: string): string | null {
  const found = list
    .split(/\r?\n/)
    .map((line) => /^([0-9a-f]{64}) [ *](.+)$/i.exec(line.trim()))
    .filter((match) => match?.[2] === name);
  return found.length === 1 ? found[0]![1].toLowerCase() : null;
}

/** 응답을 받는다. 응답 전과 청크 사이가 IDLE_MS를 넘거나, 전체가 TOTAL_MS를 넘거나, signal이 끊기면 멈춘다 */
async function open(url: string, signal: AbortSignal | undefined): Promise<{ body: Readable; idle: () => void; stop: () => void }> {
  const idle = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(new Error(`${IDLE_MS / 1000}초 동안 받은 것이 없어 끊음`)), IDLE_MS);
  };
  const stop = () => clearTimeout(timer);
  arm();
  const signals = [idle.signal, AbortSignal.timeout(TOTAL_MS), ...(signal ? [signal] : [])];
  let res: Response;
  try {
    res = await github.fetch(url, { redirect: "follow", signal: AbortSignal.any(signals) });
  } catch (error) {
    stop();
    throw failure("network", `${path.basename(new URL(url).pathname)} 다운로드 실패: ${(error as Error).message}`);
  }
  if (!res.ok || !res.body) {
    stop();
    throw failure(res.status === 404 ? "missing" : "network", `${path.basename(new URL(url).pathname)} 다운로드 실패: HTTP ${res.status}`);
  }
  return { body: Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>), idle: arm, stop };
}

/** 작은 파일(체크섬 목록, 서명)을 메모리로. max를 넘으면 integrity */
async function small(url: string, max: number, signal: AbortSignal | undefined): Promise<Buffer> {
  const { body, idle, stop } = await open(url, signal);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of body) {
      idle();
      size += (chunk as Buffer).length;
      if (size > max) throw failure("integrity", `크기가 ${max}바이트를 넘음: ${path.basename(new URL(url).pathname)}`);
      chunks.push(chunk as Buffer);
    }
  } catch (error) {
    throw (error as Partial<ReleaseError>).kind ? error : failure("network", `${path.basename(new URL(url).pathname)} 다운로드 실패: ${(error as Error).message}`);
  } finally {
    stop();
  }
  return Buffer.concat(chunks);
}

/**
 * 한 태그의 에셋(zip)을 zipFile에 다운로드하고 확인한다. zipFile은 없어야 한다(새로 만든다).
 * 순서: 체크섬 목록과 서명 → 서명 확인(skipSignature면 건너뛴다) → 목록의 에셋 줄 → zip을 받으며 SHA-256. 실패하면 ReleaseError(kind)로 던지고 받다 만 zipFile은 지우지 않는다(호출부의 staging과 함께 지운다)
 */
async function fetchRelease({ repo, tag, asset, zipFile, signal, skipSignature = false }: { repo: string; tag: string; asset: string; zipFile: string; signal?: AbortSignal; skipSignature?: boolean }): Promise<void> {
  const base = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}`;
  const list = await small(`${base}/${SUMS}`, SUMS_MAX, signal).catch(async (error: unknown) => {
    throw (error as ReleaseError).kind === "missing" ? await whyNoSums(repo, tag, error as ReleaseError, signal) : error;
  });
  if (!skipSignature) {
    const signature = await small(`${base}/${SUMS}.sig`, SUMS_MAX, signal).catch((error: unknown) => {
      // 2023년 3월 전의 stable 릴리스에는 서명 파일이 없다
      throw (error as ReleaseError).kind === "missing" ? failure("missing", `${tag}${josa(tag, "은")} 서명 파일이 없는 옛 릴리스라 받지 않음(서명 없이 받으려면 터미널에서 pnpm run update:ytdlp --pin ${tag} --skip-signature)`) : error;
    });
    try {
      verifyDetached(list, signature, signingKey());
    } catch (error) {
      throw failure("signature", (error as Error).message);
    }
  }
  const want = sumOf(list.toString("utf8"), asset);
  if (!want) throw failure("missing", `릴리스 ${tag}에 ${asset} 없음`);

  const { body, idle, stop } = await open(`${base}/${asset}`, signal);
  const hash = crypto.createHash("sha256");
  let size = 0;
  const count = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      idle();
      size += chunk.length;
      if (size > ZIP_MAX) return done(failure("integrity", `크기가 ${ZIP_MAX / 1024 / 1024}MB를 넘음: ${asset}`));
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(body, count, fs.createWriteStream(zipFile, { flags: "wx" }));
  } catch (error) {
    throw (error as Partial<ReleaseError>).kind ? error : failure("network", `${asset} 다운로드 실패: ${(error as Error).message}`);
  } finally {
    stop();
  }
  const got = hash.digest("hex");
  if (got !== want) throw failure("integrity", `${asset} 체크섬 불일치(기대 ${want.slice(0, 12)}…, 실제 ${got.slice(0, 12)}…)`);
}

/**
 * 체크섬 목록이 404일 때 이유를 가른다: 그 채널(저장소)에 없는 태그인지(다른 채널의 태그를 고정했을 때 흔하다), 목록이 없는 옛 릴리스인지(2021~2022년의 일부).
 * 릴리스 페이지를 한 번 본다. 그것도 알 수 없으면 원래 실패 그대로
 */
async function whyNoSums(repo: string, tag: string, original: ReleaseError, signal: AbortSignal | undefined): Promise<ReleaseError> {
  let status: number;
  try {
    status = (await github.fetch(`https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`, { method: "HEAD", redirect: "follow", signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]) })).status;
  } catch {
    return original;
  }
  if (status === 404) return failure("missing", `이 채널에 ${tag} 버전이 없음(다른 채널의 버전이면 운영자 패널 업데이트 탭에서 채널을 바꾸세요)`);
  if (status >= 200 && status < 300) return failure("missing", `${tag}${josa(tag, "은")} 체크섬 목록(${SUMS})이 없는 옛 릴리스라 확인할 수 없어 받지 않음`);
  return original;
}

/** 테스트가 가짜 전송을 넣는다. null이면 진짜 fetch */
const useFetch = (fake: typeof fetch | null) => github.useFetch(fake);

export { assetFor, assetHere, fetchRelease, sumOf, useFetch, signingKey, SIGNING_FINGERPRINT };
export type { Asset, Channel as YtdlpChannel, FailureKind as ReleaseFailureKind, ReleaseError, Libc };
