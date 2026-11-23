// ffmpeg를 목표 릴리스에 맞춘다(설치 스크립트 scripts/install-ffmpeg가 부른다. 봇은 기동 때 그 스크립트를 자식 프로세스로 실행한다).
// 받은 빌드는 vendor/ffmpeg/<릴리스>-<받은 시각>/에 두고 state.json의 가리킴만 바꾼다. 실행 확인을 통과한 것만 적용하고, 쓰던 것은 이전 빌드로 남긴다.
// 다운로드, 압축 풀기, 실행 확인은 호출부가 넘긴다(테스트가 실제 vendor를 건드리거나 100MB를 받지 않게)

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RELEASES_URL, TARGETS, assetFor, type Target } from "./release.ts";
import { EMPTY_STATE, readState, setAsideBroken, writeState, type FfmpegBuild, type FfmpegState } from "./state.ts";
import { withLock } from "../../infra/folder-lock.ts";
import { L } from "../../infra/log/text.ts";
import { logTextError } from "../../infra/log/log-text.ts";

/** 실행 확인의 결과. ok면 ffmpeg -version이 출력한 버전 */
type Probe = { ok: true; version: string } | { ok: false; reason: string };

/**
 * key: 플랫폼(`${process.platform}-${process.arch}`). fetchText: 본문, 없으면(404) null. fetchFile: 본문 바이트.
 * extract: 압축 파일에서 실행 파일 하나를 꺼내 그 경로를 반환한다(cwd 안에 푼다). probe: 실행 확인
 */
type InstallIo = {
  key: string;
  fetchText(url: string): Promise<string | null>;
  fetchFile(url: string): Promise<Buffer>;
  extract(archive: string, bin: string, cwd: string): Promise<string>;
  probe(file: string): Promise<Probe>;
  now(): number;
  pid: number;
};

/**
 * unchanged: 이미 목표 릴리스다. switched: 이전 빌드가 목표라 가리킴만 바꿨다. installed: 받아서 적용했다.
 * skipped: 목표가 이 환경에서 실행되지 않아 물린 릴리스다(force가 아니면 다시 받지 않는다). failed: 받거나 적용하지 못했다(가리킴은 그대로).
 * busy: 다른 프로세스가 폴더 잠금을 풀지 않았다. 어느 결과든 notes에 운영자에게 알릴 줄이 있을 수 있다(깨진 기록을 옮긴 경우)
 */
type AlignOutcome = ({ kind: "unchanged"; release: string; version: string } | { kind: "switched"; release: string; version: string } | { kind: "installed"; release: string; version: string; from: string | null } | { kind: "skipped"; release: string } | { kind: "failed"; release: string; reason: string } | { kind: "busy"; holder: number | null }) & { notes: string[] };

/**
 * dir: vendor/ffmpeg. defaultRelease: 코드의 기본값. pin: 고정을 바꾼다(문자열은 고정, null은 풀기, 생략은 그대로).
 * 바꾼 고정은 맞추기에 성공했을 때만 저장한다. force: 이미 있어도, 물린 릴리스여도 새 폴더에 다시 받는다
 */
type AlignOptions = { dir: string; defaultRelease: string; pin?: string | null; force?: boolean; io: InstallIo };

/** 목표에 맞춘다. 폴더 잠금 안에서 기록을 새로 읽고 끝에 한 번 쓴다 */
async function alignFfmpeg({ dir, defaultRelease, pin, force = false, io }: AlignOptions): Promise<AlignOutcome> {
  const target = TARGETS[io.key];
  if (!target) throw logTextError(L.ffmpeg.ffmpegTargetUnsupported({ target: io.key }));
  const notes: string[] = [];
  const held = await withLock(dir, () => alignLocked({ dir, defaultRelease, pin, force, io, target, notes }));
  return held.ok ? held.value : { kind: "busy", holder: held.holder, notes };
}

async function alignLocked({ dir, defaultRelease, pin, force, io, target, notes }: Required<Omit<AlignOptions, "pin">> & { pin: string | null | undefined; target: Target; notes: string[] }): Promise<AlignOutcome> {
  const read = readState(dir);
  const state: FfmpegState = read.kind === "ok" ? read.state : EMPTY_STATE;
  if (read.kind === "broken") {
    const aside = setAsideBroken(dir, io.now());
    notes.push(`ffmpeg 기록(state.json)을 읽지 못해(${read.error}) ${path.basename(aside)} 파일로 옮기고 새로 기록했습니다. 고정한 버전이 있었다면 다시 고정하세요`);
  }
  const nextPin = pin === undefined ? state.pin : pin;
  const release = nextPin ?? defaultRelease;
  const save = (next: FfmpegState) => writeState(dir, { ...next, pin: nextPin });

  // 지금 빌드가 실행되지 않으면 새로 받아도 그것을 이전 빌드로 남기지 않는다(다음 기동이 대신 쓸 수 없다)
  let activeBroken = false;
  if (!force) {
    const reused = await reuse(state, release, (file) => io.probe(path.join(dir, file.folder, target.bin)));
    if (reused.kind === "fetch") activeBroken = reused.activeBroken;
    else if (reused.kind === "skipped") return { kind: "skipped", release, notes };
    else {
      // 이전 빌드로 바꾸면 지금 쓰던 빌드가 이전 빌드 자리로 간다
      save(reused.kind === "switched" ? { ...state, active: state.previous, previous: state.active } : state);
      return { kind: reused.kind, release, version: reused.version, notes };
    }
  }
  return installNew({ dir, release, target, io, state, activeBroken, save, notes });
}

/** 받아서 새 버전 폴더에 두고 가리킨다. 이 환경에서 실행되지 않으면 물린 릴리스에 적고 가리킴은 그대로 둔다 */
async function installNew({ dir, release, target, io, state, activeBroken, save, notes }: { dir: string; release: string; target: Target; io: InstallIo; state: FfmpegState; activeBroken: boolean; save: (next: FfmpegState) => void; notes: string[] }): Promise<AlignOutcome> {
  const staging = path.join(dir, `.staging-${io.pid}-${io.now()}`);
  try {
    const got = await fetchBuild(release, target, staging, io);
    if ("reason" in got) {
      // 고정을 바꾸려던 것이면 바꾸지 않는다(기록의 고정 그대로)
      if (got.rejected) writeState(dir, { ...state, rejected: [...new Set([...state.rejected, release])] });
      return { kind: "failed", release, reason: got.reason, notes };
    }
    const folder = `${release}-${io.now()}`;
    fs.mkdirSync(path.join(dir, folder));
    fs.renameSync(got.file, path.join(dir, folder, target.bin));
    const build: FfmpegBuild = { folder, release, asset: got.asset, sha256: got.sha256, version: got.version };
    save({ ...state, active: build, previous: activeBroken ? state.previous : (state.active ?? state.previous), rejected: state.rejected.filter((r) => r !== release) });
    return { kind: "installed", release, version: got.version, from: state.active?.release ?? null, notes };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true, maxRetries: 2 });
  }
}

/**
 * 받지 않고 끝낼 수 있는지 본다. unchanged: 지금 빌드가 목표이고 실행된다, switched: 이전 빌드가 목표이고 실행된다,
 * skipped: 목표가 물린 릴리스다, fetch: 받아야 한다(activeBroken: 지금 빌드가 목표인데 실행되지 않았다)
 */
async function reuse(state: FfmpegState, release: string, probe: (build: FfmpegBuild) => Promise<Probe>): Promise<{ kind: "unchanged" | "switched"; version: string } | { kind: "skipped" } | { kind: "fetch"; activeBroken: boolean }> {
  let activeBroken = false;
  if (state.active?.release === release) {
    const ran = await probe(state.active);
    if (ran.ok) return { kind: "unchanged", version: ran.version };
    activeBroken = true;
  }
  if (state.previous?.release === release) {
    const ran = await probe(state.previous);
    if (ran.ok) return { kind: "switched", version: ran.version };
  }
  if (state.rejected.includes(release)) return { kind: "skipped" };
  return { kind: "fetch", activeBroken };
}

/** 받아서 확인하고 staging 안의 실행 파일 경로를 반환한다. rejected: 받기는 됐지만 이 환경에서 실행되지 않았다 */
async function fetchBuild(release: string, target: Target, staging: string, io: InstallIo): Promise<{ file: string; asset: string; sha256: string; version: string } | { reason: string; rejected: boolean }> {
  const base = `${RELEASES_URL}/${encodeURIComponent(release)}`;
  const checksums = await io.fetchText(`${base}/checksums.sha256`);
  if (checksums === null) return { reason: `${release} 릴리스가 없음(BtbN이 지웠거나 태그가 틀림. 월말 빌드는 2년, 그 외는 2주 보관)`, rejected: false };
  let asset;
  try {
    asset = assetFor(checksums, target, io.key);
  } catch (error) {
    return { reason: (error as Error).message, rejected: false };
  }
  const archive = await io.fetchFile(`${base}/${asset.assetName}`);
  const sha256 = crypto.createHash("sha256").update(archive).digest("hex");
  if (sha256 !== asset.sha256) return { reason: `체크섬 불일치(기대 ${asset.sha256}, 실제 ${sha256})`, rejected: false };
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, asset.assetName), archive);
  const file = await io.extract(asset.assetName, target.bin, staging);
  const ran = await io.probe(file);
  if (!ran.ok) return { reason: `받은 ffmpeg가 이 환경에서 실행되지 않음(${ran.reason})`, rejected: true };
  return { file, asset: asset.assetName, sha256, version: ran.version };
}

export { alignFfmpeg };
export type { AlignOutcome, AlignOptions, InstallIo, Probe };
