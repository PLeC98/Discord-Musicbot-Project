// 외부 도구(bgutil, ffmpeg)의 새 버전, 고정한 bgutil 태그가 고정한 커밋을 그대로 가리키는지와 그 lockfile의 취약점,Cloudflare IP 대역(data/cloudflare-ips.json, 대시보드의 사용자 IP 확인용) 변경, yt-dlp 서명 키(data/yt-dlp-signing-key.asc)가 그대로인지를 확인한다. 매주 실행되는 vendor-updates 워크플로가 호출하고, 로컬에서도 실행할 수 있다.
//
//   node scripts/check-vendor-updates.ts           결과를 JSON 으로 찍는다
//   node scripts/check-vendor-updates.ts --write   새 버전이 있으면 src/config/vendor-versions.ts의 기본값(bgutil 은 태그와 커밋)을, Cloudflare 대역이 바뀌었으면 data/cloudflare-ips.json을 갱신하고 결과를 출력한다
//
// 설정 모듈, .env 를 부르지 않는다(워크플로 실행기에는 .env 가 없다. 비교하는 것은 저장소의 기본값이다).
// GITHUB_TOKEN 이 있으면 GitHub API 에 실어 보낸다(요청 한도). 잠금 파일은 package.json 과 함께 받아 npm audit --package-lock-only 로 본다(설치하지 않는다)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PROJECT } from "../src/infra/project-paths.ts";
import { FFMPEG_RELEASE, BGUTIL_VERSION, BGUTIL_COMMIT } from "../src/config/vendor-versions.ts";
import { isCommitSha } from "../src/rules/bgutil-install.ts";
import { parseCidr } from "../src/rules/net-address.ts";
import { auditCounts, newerFfmpegRelease, newerRelease, rewriteConstant, type AuditCounts } from "../src/rules/vendor-updates.ts";
import { pinnedKey, verifyDetached } from "../src/infra/openpgp.ts";
import { SIGNING_FINGERPRINT, signingKey } from "../src/sources/ytdlp-release.ts";

const BGUTIL_REPO = "Brainicism/bgutil-ytdlp-pot-provider";
const FFMPEG_REPO = "BtbN/FFmpeg-Builds";
// 봇이 받는 yt-dlp 채널 중 둘(master 는 nightly 와 같은 키로 서명한다)
const YTDLP_REPOS = ["yt-dlp/yt-dlp", "yt-dlp/yt-dlp-nightly-builds"];
const VERSIONS_FILE = path.join(PROJECT.root, "src", "config", "vendor-versions.ts");
const CLOUDFLARE_FILE = path.join(PROJECT.root, "data", "cloudflare-ips.json");
const TIMEOUT_MS = 30_000;

async function github(pathname: string) {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Discord-Musicbot-Project vendor-updates", ...(token && { Authorization: `Bearer ${token}` }) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub ${pathname}: ${res.status}`);
  return res.json();
}

// 태그가 가리키는 커밋. refs/tags/ 로 적어야 주석 태그도 커밋으로 벗기고 같은 이름의 브랜치와 헷갈리지 않는다
async function bgutilCommitOf(tag: string) {
  const sha = String(((await github(`/repos/${BGUTIL_REPO}/commits/refs/tags/${encodeURIComponent(tag)}`)) as { sha?: unknown }).sha ?? "");
  if (!isCommitSha(sha)) throw new Error(`bgutil ${tag} 의 커밋을 읽지 못했습니다: ${sha}`);
  return sha;
}

// 고정한 커밋의 잠금 파일을 지금의 취약점 DB 로 본다(설치하는 것과 같은 것)
async function auditBgutil(commit: string): Promise<AuditCounts> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgutil-audit-"));
  try {
    for (const name of ["package.json", "package-lock.json"]) {
      const res = await fetch(`https://raw.githubusercontent.com/${BGUTIL_REPO}/${commit}/server/${name}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`bgutil ${commit} 의 server/${name}: ${res.status}`);
      fs.writeFileSync(path.join(dir, name), await res.text());
    }
    // 취약점이 있으면 1 로 끝나므로 종료 코드가 아니라 출력을 읽는다
    // 윈도우의 npm 은 .cmd 라 셸로 부른다. 인자는 고정 글자뿐이라 한 줄로 넘긴다
    const ran = spawnSync("npm audit --package-lock-only --json", { cwd: dir, encoding: "utf8", shell: true, timeout: 120_000 });
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(ran.stdout);
    } catch {
      /* 아래에서 던진다 */
    }
    const counts = auditCounts(parsed);
    if (!counts) throw new Error(`npm audit 결과를 읽지 못했습니다(bgutil ${commit}): ${(ran.stderr || ran.error?.message || "").trim().split("\n")[0]}`);
    return counts;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Cloudflare가 공개하는 IP 대역 목록(한 줄에 CIDR 하나). 대역마다 프리픽스까지 검사한다
async function cloudflareList(family: "v4" | "v6") {
  const res = await fetch(`https://www.cloudflare.com/ips-${family}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Cloudflare ips-${family}: ${res.status}`);
  const list = (await res.text()).split(/\s+/).filter(Boolean);
  if (!list.length || !list.every((c) => c.includes("/") && parseCidr(c)?.family === (family === "v4" ? "ipv4" : "ipv6"))) throw new Error(`Cloudflare ips-${family}: 목록 형식이 아님`);
  return list;
}

/**
 * yt-dlp 서명 키가 그대로인가. yt-dlp 저장소의 public.key 가 고정한 지문의 키인지, stable, nightly 최신 릴리스의 SHA2-256SUMS 서명이 data/ 의 키로 맞는지.
 * 다르면 키를 사람이 바꿔야 한다(새 키는 yt-dlp 의 공지와 대조한다. 자동으로 바꾸면 릴리스를 바꿔치기한 쪽의 키를 들이게 된다)
 */
async function ytdlpSigningKey() {
  const res = await fetch("https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/public.key", { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`yt-dlp public.key: ${res.status}`);
  let problem: string | null = null;
  try {
    pinnedKey(await res.text(), SIGNING_FINGERPRINT);
  } catch (error) {
    problem = `yt-dlp 저장소의 public.key: ${(error as Error).message}`;
  }
  const releases: { repo: string; tag: string; ok: boolean; reason: string | null }[] = [];
  for (const repo of YTDLP_REPOS) {
    const tag = String(((await github(`/repos/${repo}/releases/latest`)) as { tag_name?: unknown }).tag_name ?? "");
    const base = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}`;
    const [list, signature] = await Promise.all(
      ["SHA2-256SUMS", "SHA2-256SUMS.sig"].map(async (name) => {
        const file = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!file.ok) throw new Error(`${repo} ${tag} ${name}: ${file.status}`);
        return Buffer.from(await file.arrayBuffer());
      }),
    );
    try {
      verifyDetached(list, signature, signingKey());
      releases.push({ repo, tag, ok: true, reason: null });
    } catch (error) {
      releases.push({ repo, tag, ok: false, reason: (error as Error).message });
    }
  }
  return { same: !problem && releases.every((one) => one.ok), problem, releases };
}

const write = process.argv.includes("--write");

const latestBgutil = String(((await github(`/repos/${BGUTIL_REPO}/releases/latest`)) as { tag_name?: unknown }).tag_name ?? "");
const ffmpegTags = ((await github(`/repos/${FFMPEG_REPO}/releases?per_page=100`)) as Array<{ tag_name?: unknown }>).map((r) => String(r.tag_name ?? ""));
// 실패해도 다른 확인(특히 고정한 태그의 상태)을 이어 가는 것. 실패는 errors 에 모아 결과를 찍은 뒤 종료 코드 1 로 알린다
const errors: string[] = [];
async function attempt<T>(what: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    errors.push(`${what}: ${(error as Error).message}`);
    return null;
  }
}

const bgutilNewer = newerRelease(latestBgutil, BGUTIL_VERSION);
const bgutilNewerCommit = bgutilNewer ? await attempt(`bgutil ${bgutilNewer} 의 커밋`, () => bgutilCommitOf(bgutilNewer)) : null;
const ffmpegNewer = newerFfmpegRelease(ffmpegTags, FFMPEG_RELEASE);
const [cfV4, cfV6] = await Promise.all([cloudflareList("v4"), cloudflareList("v6")]);

/**
 * 고정한 태그가 지금 가리키는 커밋. same 고정한 커밋, moved 다른 커밋, unresolved 풀지 못함(태그가 지워졌거나 API 오류).
 * 풀지 못한 것을 같음이나 다름으로 치지 않고, 다른 확인은 그대로 이어 간다
 */
async function pinnedTagState(): Promise<{ state: "same" | "moved" | "unresolved"; commit: string | null; reason: string | null }> {
  try {
    const commit = await bgutilCommitOf(BGUTIL_VERSION);
    return { state: commit === BGUTIL_COMMIT ? "same" : "moved", commit, reason: null };
  } catch (error) {
    return { state: "unresolved", commit: null, reason: (error as Error).message };
  }
}

const result = {
  bgutil: {
    current: BGUTIL_VERSION,
    commit: BGUTIL_COMMIT,
    tag: await pinnedTagState(),
    latest: latestBgutil || null,
    newer: bgutilNewer,
    newerCommit: bgutilNewerCommit,
    audit: { current: await attempt("bgutil 잠금 파일 감사", () => auditBgutil(BGUTIL_COMMIT)), newer: bgutilNewerCommit ? await attempt(`bgutil ${String(bgutilNewer)} 잠금 파일 감사`, () => auditBgutil(bgutilNewerCommit)) : null },
  },
  ffmpeg: { current: FFMPEG_RELEASE, newer: ffmpegNewer },
  cloudflare: { changed: false, v4: cfV4.length, v6: cfV6.length },
  ytdlpKey: await ytdlpSigningKey(),
  wrote: false,
  errors,
};
const savedCf = JSON.parse(fs.readFileSync(CLOUDFLARE_FILE, "utf8")) as { v4: string[]; v6: string[] };
const sameList = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
result.cloudflare.changed = !sameList(savedCf.v4, cfV4) || !sameList(savedCf.v6, cfV6);

if (write && (bgutilNewer || ffmpegNewer)) {
  let text = fs.readFileSync(VERSIONS_FILE, "utf8");
  // 태그와 커밋은 함께 고친다(설치가 둘을 맞춰 본다)
  if (bgutilNewer && bgutilNewerCommit) text = rewriteConstant(rewriteConstant(text, "BGUTIL_VERSION", bgutilNewer), "BGUTIL_COMMIT", bgutilNewerCommit);
  if (ffmpegNewer) text = rewriteConstant(text, "FFMPEG_RELEASE", ffmpegNewer);
  fs.writeFileSync(VERSIONS_FILE, text);
  result.wrote = true;
}
if (write && result.cloudflare.changed) {
  fs.writeFileSync(
    CLOUDFLARE_FILE,
    `${JSON.stringify({ ...savedCf, v4: cfV4, v6: cfV6 }, null, 2)}
`,
  );
  result.wrote = true;
}

console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
