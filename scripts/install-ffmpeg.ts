/**
 * ffmpeg 바이너리 설치. BtbN/FFmpeg-Builds 릴리스에서 다운로드해 `vendor/bin/`에 둔다.
 *
 * 움직이지 않는 autobuild 태그로 고정한다. `latest`는 이름이 같은 채로 내용물이 바뀐다.
 * 그중 월말 빌드를 쓴다. 일반 autobuild는 2주 뒤 삭제돼서 고정해 두면 404가 난다.
 *
 * 기본 태그는 src/config/vendor-versions.ts 에 있고, .env의 FFMPEG_RELEASE로 바꾼다. 자산 이름은 그 릴리스의
 * checksums.sha256에서 찾으므로 버전 문자열을 따로 맞출 필요가 없다.
 * 태그 목록: https://github.com/BtbN/FFmpeg-Builds/releases
 *
 * macOS와 미지원 아키텍처는 BtbN이 빌드를 주지 않아 건너뛴다. PATH의 ffmpeg나 FFMPEG_PATH를 쓴다.
 */
import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env 를 읽는다(없으면 만든다)
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import config from "../src/config/index.ts";
import { PROJECT } from "../src/infra/project-paths.ts";
import { messageOf } from "../src/rules/error-kind.ts";
import { TARGETS, RELEASES_URL, assetFor } from "../src/media/ffmpeg/release.ts";

const ROOT = PROJECT.root;
const BIN_DIR = PROJECT.bin;

const force = process.argv.includes("--force");

function skip(reason: string): never {
  console.log(`ℹ️  [ffmpeg] ${reason}`);
  process.exit(0);
}

async function download(url: string) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}. ${url}`);
  return Buffer.from(await res.arrayBuffer());
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
function extractBinary(archiveName: string, binName: string, cwd: string) {
  const errors: string[] = [];
  for (const tar of tarCandidates()) {
    const run = (args: string[]) => spawnSync(tar, args, { cwd, encoding: "utf8", windowsHide: true });

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

// 같은 릴리스를 이미 다운로드해 두었으면 그 버전. 없거나 스탬프가 깨졌으면 null(다시 다운로드한다)
function installedVersion(binPath: string, stampPath: string, release: string): string | null {
  if (!fs.existsSync(binPath) || !fs.existsSync(stampPath)) return null;
  try {
    const stamp = JSON.parse(fs.readFileSync(stampPath, "utf8"));
    return stamp.release === release ? String(stamp.version || stamp.asset) : null;
  } catch {
    return null;
  }
}

async function main() {
  // --force는 FFMPEG_PATH가 있어도 다운로드한다. 명시적으로 요청한 갱신을 설정이 막으면 안 된다.
  const configured = config.ffmpeg.path;
  if (configured && !force) skip(`.env의 FFMPEG_PATH가 설정돼 있어 다운로드하지 않습니다 (${configured}). 그래도 다운로드하려면 --force`);

  const key = `${process.platform}-${process.arch}`;
  const target = TARGETS[key];
  if (!target) {
    skip(`${key}용 빌드가 제공되지 않습니다. ffmpeg를 직접 설치해 PATH에 두거나 .env의 FFMPEG_PATH로 지정하세요${process.platform === "darwin" ? " (brew install ffmpeg)" : ""}.`);
  }

  const release = config.ffmpeg.release;
  const baseUrl = `${RELEASES_URL}/${encodeURIComponent(release)}`;
  const binPath = path.join(BIN_DIR, target.bin);
  const stampPath = path.join(BIN_DIR, ".ffmpeg-version.json");

  const installed = force ? null : installedVersion(binPath, stampPath, release);
  if (installed) skip(`이미 설치됨 (${installed})`);

  const checksums = (await download(`${baseUrl}/checksums.sha256`)).toString("utf8");
  const { assetName, sha256: wantSha, version } = assetFor(checksums, target, key);

  console.log(`🔄 [ffmpeg] 다운로드 중: ${assetName}`);
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

main().catch((error) => {
  // 설치 실패로 pnpm install 전체를 깨지 않는다. 기동 시 ffmpegPath가 PATH를 찾고,
  // 그것도 없으면 거기서 분명한 메시지와 함께 멈춘다.
  console.warn(`⚠️  [ffmpeg] 다운로드 실패: ${messageOf(error)}`);
  console.warn("   PATH의 ffmpeg를 사용하거나, .env의 FFMPEG_PATH로 경로를 지정하세요.");
  process.exit(0);
});
