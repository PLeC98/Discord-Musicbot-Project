// 따로 받는 도구(bgutil · ffmpeg)의 새 버전과 고정한 bgutil 잠금 파일의 취약점을 본다. 주마다 도는 vendor-updates 워크플로가 부르고, 로컬에서도 돈다.
//
//   node scripts/check-vendor-updates.ts           결과를 JSON 으로 찍는다
//   node scripts/check-vendor-updates.ts --write   새 버전이 있으면 src/config/vendor-versions.ts 의 기본값을 고치고 찍는다
//
// 설정 모듈 · .env 를 부르지 않는다(워크플로 실행기에는 .env 가 없다. 견주는 것은 저장소의 기본값이다).
// GITHUB_TOKEN 이 있으면 GitHub API 에 실어 보낸다(요청 한도). 잠금 파일은 package.json 과 함께 받아 npm audit --package-lock-only 로 본다(설치하지 않는다)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PROJECT } from "../src/infra/project-paths.ts";
import { FFMPEG_RELEASE, BGUTIL_VERSION } from "../src/config/vendor-versions.ts";
import { auditCounts, newerFfmpegRelease, newerRelease, rewriteConstant, type AuditCounts } from "../src/rules/vendor-updates.ts";

const BGUTIL_REPO = "Brainicism/bgutil-ytdlp-pot-provider";
const FFMPEG_REPO = "BtbN/FFmpeg-Builds";
const VERSIONS_FILE = path.join(PROJECT.root, "src", "config", "vendor-versions.ts");
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

// 고정한 태그의 잠금 파일을 지금의 취약점 DB 로 본다
async function auditBgutil(tag: string): Promise<AuditCounts> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgutil-audit-"));
  try {
    for (const name of ["package.json", "package-lock.json"]) {
      const res = await fetch(`https://raw.githubusercontent.com/${BGUTIL_REPO}/${encodeURIComponent(tag)}/server/${name}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`bgutil ${tag} 의 server/${name}: ${res.status}`);
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
    if (!counts) throw new Error(`npm audit 결과를 읽지 못했습니다(bgutil ${tag}): ${(ran.stderr || ran.error?.message || "").trim().split("\n")[0]}`);
    return counts;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const write = process.argv.includes("--write");

const latestBgutil = String(((await github(`/repos/${BGUTIL_REPO}/releases/latest`)) as { tag_name?: unknown }).tag_name ?? "");
const ffmpegTags = ((await github(`/repos/${FFMPEG_REPO}/releases?per_page=100`)) as Array<{ tag_name?: unknown }>).map((r) => String(r.tag_name ?? ""));
const bgutilNewer = newerRelease(latestBgutil, BGUTIL_VERSION);
const ffmpegNewer = newerFfmpegRelease(ffmpegTags, FFMPEG_RELEASE);

const result = {
  bgutil: {
    current: BGUTIL_VERSION,
    latest: latestBgutil || null,
    newer: bgutilNewer,
    audit: { current: await auditBgutil(BGUTIL_VERSION), newer: bgutilNewer ? await auditBgutil(bgutilNewer) : null },
  },
  ffmpeg: { current: FFMPEG_RELEASE, newer: ffmpegNewer },
  wrote: false,
};

if (write && (bgutilNewer || ffmpegNewer)) {
  let text = fs.readFileSync(VERSIONS_FILE, "utf8");
  if (bgutilNewer) text = rewriteConstant(text, "BGUTIL_VERSION", bgutilNewer);
  if (ffmpegNewer) text = rewriteConstant(text, "FFMPEG_RELEASE", ffmpegNewer);
  fs.writeFileSync(VERSIONS_FILE, text);
  result.wrote = true;
}

console.log(JSON.stringify(result, null, 2));
