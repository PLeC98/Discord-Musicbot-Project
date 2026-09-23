"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const config = require("../../../config");
const log = require("../../infra/log/logger").child({ category: "ffmpeg" });

/**
 * ffmpeg 실행 파일 경로의 단일 출처. 재생(spawnFfmpeg)과 캐시 변환(yt-dlp --ffmpeg-location)이
 * 같은 바이너리를 쓰도록 여기서만 결정한다.
 *
 * 해석 순서: FFMPEG_PATH(.env) → bin/의 번들 → PATH의 ffmpeg. 전부 실패하면 던진다.
 * FFMPEG_PATH가 유효하지 않으면 다음 후보로 넘어가지 않고 즉시 실패한다.
 */

let resolved = null; // { path, version, source }
let caps = null; // { https, hls, segMaxRetry, ok }

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
  const p = path.join(__dirname, "..", "..", "..", "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
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
      // 명시 지정이 틀렸으면 다른 후보로 넘어가지 않는다. 사용자가 의도한 바이너리가 아닌 것을
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

/** 해석된 실행 파일 경로만 반환. 실행 지점에서 쓰는 기본 접근자. */
function ffmpegPath() {
  return resolve().path;
}

/**
 * HLS(라이브) 재생에 필요한 능력. 결과는 프로세스 단위로 캐시한다.
 *
 * 우리가 깔아 주는 BtbN 빌드는 전부 갖췄지만 FFMPEG_PATH로 다른 빌드를 물릴 수 있다.
 * 네트워크 주소를 여는 경로는 그쪽 네트워크 스택에 통째로 의존하므로, 쓰기 전에 물어본다.
 * (파이프 경로는 이 결과와 무관하게 늘 동작한다. 못 갖춘 빌드는 라이브만 못 튼다.)
 *
 * `segMaxRetry`는 비교적 최근 옵션이라 따로 본다. ffmpeg는 모르는 옵션을 치명적 오류로 보므로
 * 없는 빌드에 붙이면 재생이 시작조차 못 한다.
 *
 * @returns {{https: boolean, hls: boolean, segMaxRetry: boolean, ok: boolean}}
 */
function capabilities() {
  if (caps) return caps;

  const ask = (args) => {
    try {
      const result = spawnSync(ffmpegPath(), args, { windowsHide: true, encoding: "utf8", timeout: 10000 });
      if (result.error) return "";
      return `${result.stdout || ""}${result.stderr || ""}`;
    } catch {
      return "";
    }
  };

  // -protocols는 Input:과 Output: 두 절을 낸다. 우리가 쓰는 것은 읽기이므로 Input: 절만 본다.
  const protocols = ask(["-hide_banner", "-protocols"]);
  const inputSection = protocols.split(/^\s*Output:/m)[0];
  const https = /^\s*https\s*$/m.test(inputSection);

  const hls = /^\s*\S*D\S*\s+hls\s/m.test(ask(["-hide_banner", "-demuxers"]));
  const segMaxRetry = /-seg_max_retry\b/.test(ask(["-hide_banner", "-h", "demuxer=hls"]));

  caps = { https, hls, segMaxRetry, ok: https && hls };
  if (!caps.ok) {
    log.warn(`이 ffmpeg 빌드는 라이브(HLS) 재생을 지원하지 않습니다 (https:${https ? "있음" : "없음"}, hls:${hls ? "있음" : "없음"})`);
  }
  return caps;
}

/** 기동 시 1회 호출. 실제로 쓰는 바이너리를 로그에 남긴다. 못 찾으면 던진다. */
function logResolved() {
  const info = resolve();
  const shown = info.source === "PATH" ? "PATH의 ffmpeg" : info.path;
  log.info({ tags: ["startup"] }, `ffmpeg ${info.version} (${info.source}: ${shown})`);
  return info;
}

/** 테스트용. 캐시 초기화 */
function _reset() {
  resolved = null;
  caps = null;
}

module.exports = { ffmpegPath, resolve, capabilities, logResolved, _internals: { probe, fromBundle, _reset } };
