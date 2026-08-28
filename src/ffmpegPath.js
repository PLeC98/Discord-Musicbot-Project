"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const config = require("../config");
const log = require("./logger").child({ category: "ffmpeg" });

/**
 * ffmpeg 실행 파일 경로의 단일 출처. 재생(spawnFfmpeg)과 캐시 변환(yt-dlp --ffmpeg-location)이
 * 같은 바이너리를 쓰도록 여기서만 결정한다.
 *
 * 해석 순서: FFMPEG_PATH(.env) → bin/의 번들 → PATH의 ffmpeg. 전부 실패하면 던진다.
 * FFMPEG_PATH가 유효하지 않으면 다음 후보로 넘어가지 않고 즉시 실패한다.
 */

let resolved = null; // { path, version, source }

/** 후보가 실제로 실행 가능한 ffmpeg인지 확인하고 버전 문자열을 뽑는다. 아니면 null. */
function probe(candidate) {
  if (!candidate) return null;
  try {
    const result = spawnSync(candidate, ["-version"], { windowsHide: true, encoding: "utf8", timeout: 10000 });
    if (result.error || result.status !== 0) return null;
    const match = /ffmpeg version (\S+)/i.exec(result.stdout || "");
    return match ? match[1] : "unknown";
  } catch {
    return null;
  }
}

/** scripts/install-ffmpeg.js가 내려받아 두는 위치. 미지원 플랫폼에서는 없다. */
function fromBundle() {
  const p = path.join(__dirname, "..", "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return fs.existsSync(p) ? p : null;
}

/**
 * ffmpeg 경로를 해석한다(결과는 프로세스 단위로 캐시).
 * @returns {{path: string, version: string, source: string}}
 * @throws 어느 후보도 실행 가능한 ffmpeg가 아니면 던진다.
 */
function resolve() {
  if (resolved) return resolved;

  const configured = config.ffmpeg && config.ffmpeg.path;
  if (configured) {
    const version = probe(configured);
    if (!version) {
      // 명시 지정이 틀렸으면 다른 후보로 넘어가지 않는다 — 사용자가 의도한 바이너리가 아닌 것을
      // 조용히 쓰면 "왜 내 설정이 안 먹지"로 이어진다.
      throw new Error(`FFMPEG_PATH로 지정한 경로를 실행할 수 없습니다: ${configured}`);
    }
    resolved = { path: configured, version, source: "FFMPEG_PATH" };
    return resolved;
  }

  const candidates = [
    { path: fromBundle(), source: "번들" },
    { path: "ffmpeg", source: "PATH" },
  ];
  for (const candidate of candidates) {
    if (!candidate.path) continue;
    const version = probe(candidate.path);
    if (version) {
      resolved = { path: candidate.path, version, source: candidate.source };
      return resolved;
    }
  }

  throw new Error("ffmpeg를 찾을 수 없습니다. `pnpm run install:ffmpeg`로 내려받거나, ffmpeg를 설치해 PATH에 두거나, .env의 FFMPEG_PATH로 경로를 지정하세요 (macOS: brew install ffmpeg).");
}

/** 해석된 실행 파일 경로만 반환 — 실행 지점에서 쓰는 기본 접근자. */
function ffmpegPath() {
  return resolve().path;
}

/** 기동 시 1회 호출 — 실제로 쓰는 바이너리를 로그에 남긴다. 못 찾으면 던진다. */
function logResolved() {
  const info = resolve();
  const shown = info.source === "PATH" ? "PATH의 ffmpeg" : info.path;
  log.info(`🎬 ffmpeg ${info.version} (${info.source}: ${shown})`);
  return info;
}

/** 테스트용 — 캐시 초기화 */
function _reset() {
  resolved = null;
}

module.exports = { ffmpegPath, resolve, logResolved, _internals: { probe, fromBundle, _reset } };
