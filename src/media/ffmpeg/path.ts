import { codedError, codeOf, messageOf } from "../../rules/error-kind.ts";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { toolEnv } from "../../config/tool-env.ts";
import config from "../../config/index.ts";
import logger from "../../infra/log/logger.ts";
import { PROJECT } from "../../infra/project-paths.ts";
import { readState, withLock, writeState, type FfmpegBuild } from "./state.ts";
const log = logger.child({ category: "ffmpeg" });

/**
 * ffmpeg 실행 파일 경로의 단일 출처. 재생(spawnFfmpeg)과 캐시 변환(yt-dlp --ffmpeg-location)이
 * 같은 바이너리를 쓰도록 여기서만 결정한다.
 *
 * 해석 순서: FFMPEG_PATH(.env) → vendor/ffmpeg의 설치본(state.json의 active) → 이전 설치본(previous) → 옛 자리(vendor/bin)의 번들 → PATH의 ffmpeg. 전부 실패하면 예외를 던진다.
 * FFMPEG_PATH가 유효하지 않으면 다음 후보로 넘어가지 않고 즉시 실패한다.
 * 옛 자리는 vendor/ffmpeg로 옮기기 전의 설치 경로다. 봇 업데이트 뒤 첫 기동에서 다운로드가 실패해도 쓰던 ffmpeg로 뜨게 남긴다
 */

/** source: 찾은 곳. release: 설치본이면 그 릴리스 */
type Source = "FFMPEG_PATH" | "설치본" | "이전 설치본" | "옛 자리" | "PATH";
type Resolved = { path: string; version: string; source: Source; release: string | null };
type Capabilities = { https: boolean; hls: boolean; dash: boolean; segMaxRetry: boolean; ok: boolean };
/** 실행 확인의 결과. timeout: 시간 상한(10초)을 넘겼다(백신이 처음 보는 실행 파일을 검사하느라 늦을 수 있어 물리지 않는다) */
type ProbeResult = { version: string } | { failed: "timeout" | "error" };

const BIN = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

let resolved: Resolved | null = null;
let caps: Capabilities | null = null;
/** 지금 설치본이 실행되지 않아 이전 설치본으로 떴다. settleRejected가 물린 릴리스로 기록한다(기록이 기동 때 읽은 active, previous 그대로일 때만) */
let toReject: { active: FfmpegBuild; previous: FfmpegBuild } | null = null;

function probeResult(candidate: string, source: string): ProbeResult {
  try {
    const result = spawnSync(candidate, ["-version"], { windowsHide: true, encoding: "utf8", timeout: 10000, env: toolEnv() });
    if (result.error || result.status !== 0) {
      log.warn(`ffmpeg 후보 실행 확인(-version) 실패: ${candidate} | 출처=${source} | 원인=${result.error ? (codeOf(result.error) ?? messageOf(result.error)) : `종료 코드 ${result.status ?? result.signal ?? "없음"}`}`);
      return { failed: codeOf(result.error) === "ETIMEDOUT" ? "timeout" : "error" };
    }
    const match = /ffmpeg version (\S+)/i.exec(result.stdout || "");
    return { version: match ? match[1] : "unknown" };
  } catch (error) {
    log.warn(`ffmpeg 후보 실행 확인(-version) 실패: ${candidate} | 출처=${source} | 원인=${codeOf(error) ?? messageOf(error)}`);
    return { failed: "error" };
  }
}

/** 후보가 실제로 실행 가능한 ffmpeg인지 확인하고 버전 문자열을 추출한다. 실행할 수 없으면 null */
function probe(candidate: string | null | undefined, source = "?"): string | null {
  if (!candidate) return null;
  const ran = probeResult(candidate, source);
  return "version" in ran ? ran.version : null;
}

/** 옛 자리(vendor/bin)의 번들. 없으면 null */
function fromBundle(): string | null {
  const p = path.join(PROJECT.bin, BIN);
  return fs.existsSync(p) ? p : null;
}

/** vendor/ffmpeg의 설치본 둘(지금 설치본, 이전 설치본). 기록을 읽지 못하면 경고하고 건너뛴다 */
function installed(dir: string): { active: FfmpegBuild | null; previous: FfmpegBuild | null } {
  const read = readState(dir);
  if (read.kind === "broken") log.warn(`ffmpeg 기록(${path.join(dir, "state.json")}) 읽기 실패(${read.error}): 설치본을 건너뜀. pnpm run install:ffmpeg로 다시 맞추세요`);
  return read.kind === "ok" ? read.state : { active: null, previous: null };
}

/** vendor/ffmpeg의 지금 설치본, 안 되면 이전 설치본. 지금 설치본이 시간 초과가 아닌 실패로 끝났으면 물린 릴리스로 기록할 것을 남긴다 */
function pickInstalled(dir: string): Resolved | null {
  const { active, previous } = installed(dir);
  let activeFailed: ProbeResult | null = null;
  if (active) {
    const file = path.join(dir, active.folder, BIN);
    const ran = probeResult(file, "설치본");
    if ("version" in ran) return { path: file, version: ran.version, source: "설치본", release: active.release };
    activeFailed = ran;
  }
  if (!previous) return null;
  const file = path.join(dir, previous.folder, BIN);
  const ran = probeResult(file, "이전 설치본");
  if (!("version" in ran)) return null;
  if (active) log.warn(`ffmpeg 설치본(${active.release})이 실행되지 않아 이전 설치본(${previous.release})을 씀`);
  if (active && activeFailed && "failed" in activeFailed && activeFailed.failed === "error") toReject = { active, previous };
  return { path: file, version: ran.version, source: "이전 설치본", release: previous.release };
}

/**
 * ffmpeg 경로를 해석한다(결과는 프로세스 단위로 캐시).
 * @throws 어느 후보도 실행 가능한 ffmpeg가 아니면 예외를 던진다.
 */
function resolve(dir = PROJECT.ffmpeg): Resolved {
  if (resolved) return resolved;

  const configured = config.ffmpeg && config.ffmpeg.path;
  if (configured) {
    const version = probe(configured, "FFMPEG_PATH");
    if (!version) {
      // 명시 지정이 틀렸으면 다른 후보로 넘어가지 않는다. 사용자가 의도한 바이너리가 아닌 것을
      // 조용히 쓰면 "왜 내 설정이 반영되지 않지"로 이어진다.
      // 범위: 모든 곡이 같이 안 된다(player/failure-scope)
      throw Object.assign(codedError("stream-failed", `FFMPEG_PATH로 지정한 경로를 실행할 수 없음: ${configured}`), { scope: "environment" });
    }
    resolved = { path: configured, version, source: "FFMPEG_PATH", release: null };
    return resolved;
  }

  const fromInstalled = pickInstalled(dir);
  if (fromInstalled) return (resolved = fromInstalled);
  const bundle = fromBundle();
  if (bundle) {
    const version = probe(bundle, "옛 자리");
    if (version) {
      log.warn(`vendor/ffmpeg에 쓸 수 있는 설치본이 없어 옛 자리(vendor/bin)의 ffmpeg를 씀. 봇을 다시 시작하면 다시 받아 보고, 지금 받으려면 pnpm run install:ffmpeg`);
      return (resolved = { path: bundle, version, source: "옛 자리", release: null });
    }
  }
  const version = probe("ffmpeg", "PATH");
  if (version) return (resolved = { path: "ffmpeg", version, source: "PATH", release: null });

  throw Object.assign(codedError("stream-failed", "ffmpeg를 찾을 수 없음. `pnpm run install:ffmpeg`로 다운로드하거나, ffmpeg를 설치해 PATH에 두거나, .env의 FFMPEG_PATH로 경로를 지정하세요 (macOS: brew install ffmpeg)."), { scope: "environment" });
}

/**
 * 기동 뒤 한 번 부른다. 지금 설치본이 실행되지 않아(시간 초과가 아닌 실패) 이전 설치본으로 떴으면 기록을 그쪽으로 되돌리고 물린 릴리스에 적는다.
 * 그사이 다른 프로세스가 새 빌드를 적용했으면(기록이 기동 때 읽은 것과 다르면) 덮어쓰지 않는다. 다음 기동 때 물린 릴리스를 다시 받지 않게 한다
 */
async function settleRejected(dir = PROJECT.ffmpeg): Promise<void> {
  const seen = toReject;
  if (!seen) return;
  toReject = null;
  const held = await withLock(
    dir,
    () => {
      const read = readState(dir);
      if (read.kind !== "ok" || read.state.active?.folder !== seen.active.folder || read.state.previous?.folder !== seen.previous.folder) return false;
      writeState(dir, { ...read.state, active: seen.previous, previous: null, rejected: [...new Set([...read.state.rejected, seen.active.release])] });
      return true;
    },
    5000,
  );
  if (held.ok && held.value) log.warn(`실행되지 않는 ffmpeg(${seen.active.release})를 물린 릴리스로 기록하고 이전 설치본(${seen.previous.release})을 가리키게 함. 다시 받으려면 pnpm run install:ffmpeg --force`);
}

/** 쓰는 ffmpeg의 버전(봇 상태 탭). 찾지 못했으면 null */
function ffmpegVersion(): string | null {
  try {
    return resolve().version;
  } catch {
    // 기동 시 ffmpeg를 찾지 못하면 멈추므로 여기까지 오지 않는다. 상태 탭에는 모름으로 보인다
    return null;
  }
}

/** 해석된 실행 파일 경로만 반환. 실행 지점에서 쓰는 기본 접근자. */
function ffmpegPath(): string {
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
 * `dash`는 DASH 세그먼트 목록을 여는가. 지금 받는 곳에서는 드물다.
 */
function capabilities(): Capabilities {
  if (caps) return caps;

  const ask = (args: string[]): string => {
    try {
      const result = spawnSync(ffmpegPath(), args, { windowsHide: true, encoding: "utf8", timeout: 10000, env: toolEnv() });
      if (result.error) {
        log.warn(`ffmpeg 지원 기능 확인 실패(${args.join(" ")}): ${messageOf(result.error)}`);
        return "";
      }
      return `${result.stdout || ""}${result.stderr || ""}`;
    } catch (error) {
      log.warn(`ffmpeg 지원 기능 확인 실패(${args.join(" ")}): ${messageOf(error)}`);
      return "";
    }
  };

  // -protocols는 Input:과 Output: 두 절을 낸다. 우리가 쓰는 것은 읽기이므로 Input: 절만 본다.
  const protocols = ask(["-hide_banner", "-protocols"]);
  const inputSection = protocols.split(/^\s*Output:/m)[0];
  const https = /^\s*https\s*$/m.test(inputSection);

  const demuxers = ask(["-hide_banner", "-demuxers"]);
  const hls = /^\s*\S*D\S*\s+hls\s/m.test(demuxers);
  const dash = /^\s*\S*D\S*\s+dash\s/m.test(demuxers);
  const segMaxRetry = /-seg_max_retry\b/.test(ask(["-hide_banner", "-h", "demuxer=hls"]));

  caps = { https, hls, dash, segMaxRetry, ok: https && hls };
  if (!caps.ok) {
    log.warn(`이 ffmpeg 빌드는 라이브(HLS) 재생을 지원하지 않음(https:${https ? "있음" : "없음"}, hls:${hls ? "있음" : "없음"}). \`pnpm run install:ffmpeg\`로 다운로드한 빌드를 쓰거나 FFMPEG_PATH를 확인하세요`);
  }
  return caps;
}

/** 기동 시 1회 호출. 실제로 쓰는 바이너리를 로그에 남긴다. 못 찾으면 예외를 던진다. */
function logResolved(): Resolved {
  const info = resolve();
  const shown = info.source === "PATH" ? "PATH의 ffmpeg" : info.path;
  log.info({ tags: ["startup"] }, `ffmpeg ${info.version} (${info.source}: ${shown})`);
  return info;
}

/** 테스트용. 캐시 초기화 */
function _reset() {
  resolved = null;
  caps = null;
  toReject = null;
}

export { ffmpegPath, ffmpegVersion, resolve, capabilities, logResolved, settleRejected };
export const _internals = { probe, fromBundle, _reset };
export type { Capabilities, Resolved, Source };
