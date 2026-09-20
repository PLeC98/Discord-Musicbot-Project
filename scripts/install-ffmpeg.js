/**
 * ffmpeg 바이너리 설치. BtbN/FFmpeg-Builds 릴리스에서 받아 `bin/`에 둔다.
 *
 * 움직이지 않는 autobuild 태그로 고정한다. `latest`는 이름이 같은 채로 내용물이 바뀐다.
 * 그중 월말 빌드를 쓴다. 일반 autobuild는 2주 뒤 지워져서 고정해 두면 404가 난다.
 *
 * 다른 릴리스를 쓰려면 .env의 FFMPEG_RELEASE에 태그를 적는다. 자산 이름은 그 릴리스의
 * checksums.sha256에서 찾으므로 버전 문자열을 따로 맞출 필요가 없다.
 * 태그 목록: https://github.com/BtbN/FFmpeg-Builds/releases
 *
 * macOS와 미지원 아키텍처는 BtbN이 빌드를 주지 않아 건너뛴다. PATH의 ffmpeg나 FFMPEG_PATH를 쓴다.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const DEFAULT_RELEASE = "autobuild-2026-08-31-13-27"; // 월말 빌드 (2년 보관)
const VARIANT = "lgpl"; // 오디오만 쓰므로 GPL 전용 코덱(x264/x265)은 불필요

const RELEASES_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download";
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

/**
 * .env 값 하나를 가볍게 읽는다. 이 스크립트는 .env가 없을 수도 있는 시점(postinstall)에 돌아
 * dotenv를 쓸 수 없다. 그래서 dotenv의 규칙 중 필요한 것만 흉내 낸다.
 *
 * 인라인 주석을 떼는 것이 핵심이다. `FFMPEG_PATH=   # 설명`처럼 값이 비고 주석만 있는 줄을
 * 그대로 읽으면 설명문이 경로가 되어, 설정한 적 없는 사용자가 내려받기를 영영 건너뛴다.
 */
function readEnvValue(name, source = null) {
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess.trim()) return fromProcess.trim();

  let text = source;
  if (text == null) {
    try {
      text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    } catch {
      return null;
    }
  }

  const line = text.split(/\r?\n/).find((l) => new RegExp(`^\\s*(export\\s+)?${name}\\s*=`).test(l));
  if (!line) return null;

  let value = line.slice(line.indexOf("=") + 1).trim();
  const quoted = /^(['"])([\s\S]*?)\1/.exec(value);
  if (quoted) return quoted[2].trim() || null;

  value = value.replace(/\s+#.*$/, "").trim(); // 값 뒤의 주석 (dotenv와 같은 규칙)
  if (value.startsWith("#")) return null; // 값이 비고 주석만 있는 줄
  return value || null;
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}. ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 릴리스의 checksums.sha256에서 이 플랫폼이 쓸 자산을 고른다.
 *
 * 한 릴리스에는 ffmpeg 브랜치가 여럿 들어 있다(예: 8.1 · 9.0 · N-master). 그중
 * 릴리스 브랜치의 가장 높은 버전을 쓴다. N-master(`ffmpeg-N-126342-…`)는 이름에 브랜치가
 * 없어 제외되고, `-shared-`는 실행에 별도 라이브러리가 필요해 제외한다.
 *
 * 자산 이름을 코드에 박지 않는 이유: 이름에 커밋 해시가 들어가 릴리스마다 달라진다.
 * 태그 하나만 바꾸면 되도록 이름은 릴리스가 알려주는 것을 쓴다.
 *
 * @returns {{assetName: string, sha256: string, version: string, branch: string}}
 */
function resolveAsset(checksumsText, key) {
  const target = TARGETS[key];
  if (!target) return null;

  const pattern = new RegExp(`^ffmpeg-(n\\d[^\\s]*?)-${target.slug}-${VARIANT}-(\\d+\\.\\d+)\\.${target.ext.replace(".", "\\.")}$`);

  let best = null;
  for (const line of checksumsText.split(/\r?\n/)) {
    const [hash, name] = line.trim().split(/\s+/);
    if (!hash || !name) continue;

    const match = pattern.exec(name);
    if (!match) continue;

    const branch = match[2].split(".").map(Number);
    if (!best || branch[0] > best.order[0] || (branch[0] === best.order[0] && branch[1] > best.order[1])) {
      best = { assetName: name, sha256: hash, version: match[1], branch: match[2], order: branch };
    }
  }

  if (!best) throw new Error(`이 릴리스에 ${key}용 ${VARIANT} 빌드가 없습니다`);
  return { assetName: best.assetName, sha256: best.sha256, version: best.version, branch: best.branch };
}

/**
 * 아카이브를 읽을 수 있는 tar 후보들.
 *
 * 윈도우는 System32의 bsdtar를 먼저 본다. zip은 bsdtar만 읽고, PATH에 Git Bash 등의
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
 * 경로는 전부 상대경로로 넘기고 cwd로 위치를 잡는다. GNU tar는 `-f C:\...`의 콜론을
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
  // --force는 FFMPEG_PATH가 있어도 내려받는다. 명시적으로 요청한 갱신을 설정이 막으면 안 된다.
  const configured = readEnvValue("FFMPEG_PATH");
  if (configured && !force) skip(`.env의 FFMPEG_PATH가 설정돼 있어 내려받지 않습니다 (${configured}). 그래도 받으려면 --force`);

  const key = `${process.platform}-${process.arch}`;
  const target = TARGETS[key];
  if (!target) {
    skip(`${key}용 빌드가 제공되지 않습니다. ffmpeg를 직접 설치해 PATH에 두거나 .env의 FFMPEG_PATH로 지정하세요${process.platform === "darwin" ? " (brew install ffmpeg)" : ""}.`);
  }

  const release = readEnvValue("FFMPEG_RELEASE") || DEFAULT_RELEASE;
  const baseUrl = `${RELEASES_URL}/${release}`;
  const binPath = path.join(BIN_DIR, target.bin);
  const stampPath = path.join(BIN_DIR, ".ffmpeg-version.json");

  if (!force && fs.existsSync(binPath) && fs.existsSync(stampPath)) {
    try {
      const stamp = JSON.parse(fs.readFileSync(stampPath, "utf8"));
      if (stamp.release === release) skip(`이미 설치됨 (${stamp.version || stamp.asset})`);
    } catch {
      /* 스탬프가 깨졌으면 다시 받는다 */
    }
  }

  const checksums = (await download(`${baseUrl}/checksums.sha256`)).toString("utf8");
  const { assetName, sha256: wantSha, version } = resolveAsset(checksums, key);

  console.log(`🔄 [ffmpeg] 내려받는 중: ${assetName}`);
  const archiveBuf = await download(`${baseUrl}/${assetName}`);

  const gotSha = crypto.createHash("sha256").update(archiveBuf).digest("hex");
  if (gotSha !== wantSha) throw new Error(`체크섬 불일치\n  기대: ${wantSha}\n  실제: ${gotSha}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-ffmpeg-"));
  try {
    fs.writeFileSync(path.join(tmpDir, assetName), archiveBuf);

    const extracted = extractBinary(assetName, target.bin, tmpDir);
    fs.mkdirSync(BIN_DIR, { recursive: true });
    fs.copyFileSync(extracted, binPath);
    if (process.platform !== "win32") fs.chmodSync(binPath, 0o755);

    fs.writeFileSync(stampPath, JSON.stringify({ asset: assetName, release, version, sha256: wantSha }, null, 2));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const probe = spawnSync(binPath, ["-version"], { encoding: "utf8", windowsHide: true });
  const reported = /ffmpeg version (\S+)/i.exec(probe.stdout || "");
  if (!reported) throw new Error("설치한 바이너리를 실행할 수 없습니다");
  console.log(`✅ [ffmpeg] ${reported[1]} → ${path.relative(ROOT, binPath)}`);
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

module.exports = { DEFAULT_RELEASE, VARIANT, TARGETS, RELEASES_URL, resolveAsset, readEnvValue };
