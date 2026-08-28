/**
 * ffmpeg 바이너리 설치 — BtbN/FFmpeg-Builds 릴리스에서 받아 `bin/`에 둔다.
 *
 * 릴리스는 움직이지 않는 autobuild 태그로 고정한다. `latest` 같은 태그는 이름이 같은 채로
 * 내용물이 바뀌어 환경마다 다른 바이너리가 깔린다.
 *
 * 업그레이드하려면 아래 RELEASE/VERSION을 함께 바꾼다(자산 이름에 버전이 박혀 있다).
 * 새 값은 https://github.com/BtbN/FFmpeg-Builds/releases 에서 확인.
 *
 * macOS와 미지원 아키텍처는 건너뛴다 — BtbN이 빌드를 제공하지 않는다.
 * 그 환경에서는 PATH의 ffmpeg나 .env의 FFMPEG_PATH를 쓴다.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const RELEASE = "autobuild-2026-08-27-16-45";
const VERSION = "n9.0.1-9-gfa97c9f046";
const BRANCH = "9.0"; // 자산 이름 꼬리표
const VARIANT = "lgpl"; // 오디오만 쓰므로 GPL 전용 코덱(x264/x265)은 불필요

const BASE_URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${RELEASE}`;
const ROOT = path.join(__dirname, "..");
const BIN_DIR = path.join(ROOT, "bin");

// BtbN이 제공하는 플랫폼만. 키는 `${process.platform}-${process.arch}`.
const TARGETS = {
  "linux-x64": { slug: "linux64", ext: "tar.xz", bin: "ffmpeg" },
  "linux-arm64": { slug: "linuxarm64", ext: "tar.xz", bin: "ffmpeg" },
  "win32-x64": { slug: "win64", ext: "zip", bin: "ffmpeg.exe" },
  "win32-arm64": { slug: "winarm64", ext: "zip", bin: "ffmpeg.exe" },
};

const force = process.argv.includes("--force");

function skip(reason) {
  console.log(`ℹ️  [ffmpeg] ${reason}`);
  process.exit(0);
}

/** .env의 FFMPEG_PATH를 가볍게 읽는다 — 이 스크립트는 .env가 없을 수도 있는 시점에 돈다. */
function configuredPath() {
  if (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.trim()) return process.env.FFMPEG_PATH.trim();
  try {
    const line = fs
      .readFileSync(path.join(ROOT, ".env"), "utf8")
      .split(/\r?\n/)
      .find((l) => /^\s*FFMPEG_PATH\s*=/.test(l));
    const value = line ? line.split("=").slice(1).join("=").trim() : "";
    return value || null;
  } catch {
    return null;
  }
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** 체크섬 파일에서 해당 자산의 sha256을 찾는다. */
async function expectedSha(assetName) {
  const text = (await download(`${BASE_URL}/checksums.sha256`)).toString("utf8");
  for (const line of text.split(/\r?\n/)) {
    const [hash, name] = line.trim().split(/\s+/);
    if (name === assetName) return hash;
  }
  throw new Error(`checksums.sha256에 ${assetName} 항목이 없습니다`);
}

/**
 * 아카이브를 읽을 수 있는 tar 후보들.
 *
 * 윈도우는 System32의 bsdtar를 먼저 본다 — zip은 bsdtar만 읽고, PATH에 Git Bash 등의
 * GNU tar가 앞서 있으면 그쪽이 잡혀 실패한다. 리눅스는 PATH의 tar면 된다(.tar.xz는 xz 필요).
 */
function tarCandidates() {
  const candidates = [];
  if (process.platform === "win32" && process.env.SystemRoot) {
    candidates.push(path.join(process.env.SystemRoot, "System32", "tar.exe"));
  }
  candidates.push("tar");
  return candidates;
}

/**
 * 아카이브에서 ffmpeg 실행 파일 하나만 꺼낸다.
 *
 * 경로는 전부 상대경로로 넘기고 cwd로 위치를 잡는다 — GNU tar는 `-f C:\...`의 콜론을
 * 원격 호스트 지정으로 해석해 실패한다.
 */
function extractBinary(archiveName, binName, cwd) {
  const errors = [];
  for (const tar of tarCandidates()) {
    const run = (args) => spawnSync(tar, args, { cwd, encoding: "utf8", windowsHide: true });

    const list = run(["-tf", archiveName]);
    if (list.status !== 0) {
      errors.push(`${tar}: ${(list.stderr || list.error?.message || "").trim().split("\n")[0]}`);
      continue;
    }

    const member = list.stdout.split(/\r?\n/).find((entry) => entry.endsWith(`/bin/${binName}`));
    if (!member) throw new Error(`아카이브에서 bin/${binName}을 찾지 못했습니다`);

    const extract = run(["-xf", archiveName, member]);
    if (extract.status !== 0) throw new Error(`압축 해제 실패: ${(extract.stderr || "").trim()}`);
    return path.join(cwd, member);
  }
  throw new Error(`아카이브를 열 수 있는 tar가 없습니다 (.tar.xz는 xz-utils 필요)\n  ${errors.join("\n  ")}`);
}

async function main() {
  const configured = configuredPath();
  if (configured) skip(`.env의 FFMPEG_PATH가 설정돼 있어 내려받지 않습니다 (${configured})`);

  const key = `${process.platform}-${process.arch}`;
  const target = TARGETS[key];
  if (!target) {
    skip(`${key}용 빌드가 제공되지 않습니다 — ffmpeg를 직접 설치해 PATH에 두거나 .env의 FFMPEG_PATH로 지정하세요${process.platform === "darwin" ? " (brew install ffmpeg)" : ""}.`);
  }

  const assetName = assetNameFor(key);
  const binPath = path.join(BIN_DIR, target.bin);
  const stampPath = path.join(BIN_DIR, ".ffmpeg-version.json");

  if (!force && fs.existsSync(binPath) && fs.existsSync(stampPath)) {
    try {
      const stamp = JSON.parse(fs.readFileSync(stampPath, "utf8"));
      if (stamp.asset === assetName) skip(`이미 설치됨 (${VERSION})`);
    } catch {
      /* 스탬프가 깨졌으면 다시 받는다 */
    }
  }

  console.log(`🔄 [ffmpeg] 내려받는 중: ${assetName}`);
  const [archiveBuf, wantSha] = await Promise.all([download(`${BASE_URL}/${assetName}`), expectedSha(assetName)]);

  const gotSha = crypto.createHash("sha256").update(archiveBuf).digest("hex");
  if (gotSha !== wantSha) throw new Error(`체크섬 불일치\n  기대: ${wantSha}\n  실제: ${gotSha}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-ffmpeg-"));
  try {
    fs.writeFileSync(path.join(tmpDir, assetName), archiveBuf);

    const extracted = extractBinary(assetName, target.bin, tmpDir);
    fs.mkdirSync(BIN_DIR, { recursive: true });
    fs.copyFileSync(extracted, binPath);
    if (process.platform !== "win32") fs.chmodSync(binPath, 0o755);

    fs.writeFileSync(stampPath, JSON.stringify({ asset: assetName, release: RELEASE, sha256: wantSha }, null, 2));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const probe = spawnSync(binPath, ["-version"], { encoding: "utf8", windowsHide: true });
  const reported = /ffmpeg version (\S+)/i.exec(probe.stdout || "");
  if (!reported) throw new Error("설치한 바이너리를 실행할 수 없습니다");
  console.log(`✅ [ffmpeg] ${reported[1]} → ${path.relative(ROOT, binPath)}`);
}

/** 플랫폼 키(`${platform}-${arch}`)에 해당하는 자산 이름. 미지원이면 null. */
function assetNameFor(key) {
  const target = TARGETS[key];
  return target ? `ffmpeg-${VERSION}-${target.slug}-${VARIANT}-${BRANCH}.${target.ext}` : null;
}

if (require.main === module) {
  main().catch((error) => {
    // 설치 실패로 pnpm install 전체를 깨지 않는다. 기동 시 ffmpegPath가 PATH를 찾고,
    // 그것도 없으면 거기서 분명한 메시지와 함께 멈춘다.
    console.warn(`⚠️  [ffmpeg] 내려받기 실패: ${error.message}`);
    console.warn("   PATH의 ffmpeg를 사용하거나, .env의 FFMPEG_PATH로 경로를 지정하세요.");
    process.exit(0);
  });
}

module.exports = { RELEASE, VERSION, BRANCH, VARIANT, TARGETS, BASE_URL, assetNameFor };
