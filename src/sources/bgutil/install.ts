// bgutil(POToken 공급자)을 목표 태그와 커밋으로 받는다(설치 스크립트 scripts/install-bgutil이 부른다).
// 받은 빌드는 vendor/bgutil/<태그>-<받은 시각>/에 두고 state.json의 가리킴만 바꾼다. 쓰던 것은 이전 빌드로 남긴다.
// 순서: .staging-<pid>-<시각>/repo에 체크아웃 → 잠금 파일 그대로 설치, 다시 빌드할 것만 빌드 → tsc → 실행 테스트(/ping이 그 버전으로 응답하는지) →
// 잠금 안에서 기록을 새로 읽고 버전 폴더로 옮긴 뒤 가리킴을 쓴다. 가리킴을 쓰기 전에 실패하면 가리킴은 그대로다.
// 받고 빌드하는 몇 분 동안은 잠금을 쥐지 않는다(임시 폴더는 프로세스마다 따로라 겹치지 않는다). 그사이 다른 프로세스가 같은 것을 먼저 옮겼으면 내 것을 버린다.
// 체크아웃, npm, tsc, 실행 테스트는 호출부가 넘긴다(테스트가 실제로 받거나 빌드하지 않게)

import fs from "node:fs";
import path from "node:path";
import { rebuildTargets, rootInstallScripts } from "../../rules/bgutil-install.ts";
import { withLock } from "../../infra/folder-lock.ts";
import { renameRetry } from "../../infra/version-folders.ts";
import { EMPTY_STATE, readState, setAsideBroken, writeState, type BgutilBuild, type BgutilState } from "./state.ts";
import { ENTRY } from "./launch.ts";
import { josa } from "../../infra/josa.ts";
import { L } from "../../infra/log/text.ts";
import { logTextError } from "../../infra/log/log-text.ts";

/**
 * checkout: repoDir(아직 없는 경로)에 태그의 커밋을 받는다. npmCi, npmRebuild, tsc: serverDir에서 실행한다.
 * trial: serverDir의 서버를 띄워 expected 버전으로 응답하는지 본다. log: 진행 한 줄
 */
type InstallIo = {
  checkout(repoDir: string, tag: string, commit: string): Promise<void>;
  npmCi(serverDir: string): Promise<void>;
  npmRebuild(serverDir: string, names: string[]): Promise<void>;
  tsc(serverDir: string): Promise<void>;
  trial(serverDir: string, expected: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  now(): number;
  pid: number;
  log(line: string): void;
};

/**
 * unchanged: 이미 그 태그와 커밋이다(다른 프로세스가 먼저 옮긴 경우 포함). installed: 받아서 가리킴을 바꿨다.
 * failed: 받거나 빌드하지 못했거나 실행 테스트를 통과하지 못했다(가리킴은 그대로). busy: 다른 프로세스가 폴더 잠금을 풀지 않았다. notes: 운영자에게 알릴 줄(깨진 기록을 옮긴 경우)
 */
type InstallOutcome = ({ kind: "unchanged"; tag: string; version: string } | { kind: "installed"; tag: string; version: string; from: string | null } | { kind: "failed"; tag: string; reason: string } | { kind: "busy"; holder: number | null }) & { notes: string[] };

/** 기록의 빌드가 이 태그와 커밋이고 실행 파일이 있으면 그 빌드, 아니면 null */
const sameBuild = (dir: string, build: BgutilBuild | null, tag: string, commit: string): BgutilBuild | null => (build && build.tag === tag && build.commit === commit && fs.existsSync(path.join(dir, build.folder, "server", ENTRY)) ? build : null);

/** 체크아웃한 server 폴더에서 설치, 빌드, 실행 테스트까지. 서버 버전을 반환한다. 실패하면 예외를 던진다 */
async function build(serverDir: string, io: InstallIo): Promise<string> {
  if (!fs.existsSync(serverDir)) throw new Error("체크아웃에 server 폴더가 없음");
  const pkg = JSON.parse(fs.readFileSync(path.join(serverDir, "package.json"), "utf8")) as { version?: unknown; scripts?: Record<string, unknown> };
  // npm ci --ignore-scripts가 건너뛰는 루트 설치 스크립트가 생겼으면 사람이 무엇을 하는지 본다
  const rootScripts = rootInstallScripts(pkg);
  if (rootScripts.length) throw new Error(`server/package.json에 설치 스크립트(${rootScripts.join(", ")})가 생김. 무엇을 하는지 확인한 뒤 설치 스크립트를 고쳐야 함`);
  if (typeof pkg.version !== "string" || !pkg.version) throw new Error("server/package.json에 버전이 없음");
  const targets = rebuildTargets(JSON.parse(fs.readFileSync(path.join(serverDir, "package-lock.json"), "utf8")));
  if (!targets.ok) throw logTextError(targets.why === "bad-name" ? L.bgutil.lockBadName({ key: targets.key }) : L.bgutil.lockDevOverlap({ names: targets.names.join(", ") }));
  const rebuild = targets.names;
  io.log("의존성 설치(npm ci --ignore-scripts)");
  await io.npmCi(serverDir);
  if (rebuild.length) {
    io.log(`설치 스크립트가 있는 실행 의존성만 다시 빌드(npm rebuild ${rebuild.join(" ")})`);
    await io.npmRebuild(serverDir, rebuild);
  }
  io.log("서버 빌드(tsc)");
  await io.tsc(serverDir);
  io.log(`실행 테스트(/ping이 ${pkg.version}${josa(pkg.version, "으로")} 응답하는지)`);
  const tried = await io.trial(serverDir, pkg.version);
  if (!tried.ok) throw new Error(`실행 테스트 실패: ${tried.reason}`);
  return pkg.version;
}

/** 잠금 안에서 기록을 새로 읽고, 같은 것이 이미 있으면 버리고, 아니면 버전 폴더로 옮겨 가리킴을 쓴다 */
async function publish({ dir, tag, commit, version, repoDir, io, notes, force, lockWaitMs }: { dir: string; tag: string; commit: string; version: string; repoDir: string; io: InstallIo; notes: string[]; force: boolean; lockWaitMs?: number }): Promise<InstallOutcome> {
  const held = await withLock(
    dir,
    async (): Promise<InstallOutcome> => {
      const read = readState(dir);
      if (read.kind === "broken") {
        const aside = setAsideBroken(dir, io.now());
        notes.push(`bgutil 기록(state.json)을 읽지 못해(${read.error}) ${path.basename(aside)} 파일로 옮기고 새로 기록했습니다`);
      }
      const state: BgutilState = read.kind === "ok" ? read.state : EMPTY_STATE;
      // 받는 사이 다른 프로세스(터미널과 봇의 받기)가 같은 것을 먼저 옮겼다. 이전 빌드가 지금 빌드의 쌍둥이가 되지 않게 내 것을 버린다
      // --force는 같은 것이 있어도 새로 받으려는 것이라 대조하지 않는다
      const same = force ? null : sameBuild(dir, state.active, tag, commit);
      if (same) return { kind: "unchanged", tag, version: same.version, notes };
      const folder = `${tag}-${io.now()}`;
      if (!(await renameRetry(repoDir, path.join(dir, folder)))) return { kind: "failed", tag, reason: "체크아웃한 폴더를 버전 폴더로 옮기지 못함(안의 파일이 열려 있음)", notes };
      writeState(dir, { active: { folder, tag, commit, version }, previous: state.active ?? state.previous });
      return { kind: "installed", tag, version, from: state.active?.tag ?? null, notes };
    },
    lockWaitMs,
  );
  return held.ok ? held.value : { kind: "busy", holder: held.holder, notes };
}

/**
 * dir(vendor/bgutil)에 tag, commit을 받는다. tag는 isPlainTag, commit은 isCommitSha를 통과한 것이어야 한다.
 * force: 이미 그 태그와 커밋이어도 새 폴더에 다시 받는다(망가진 설치를 고칠 때). lockWaitMs: 옮길 때 다른 프로세스의 잠금을 기다리는 상한(테스트용, 기본 15분)
 */
async function installBgutil({ dir, tag, commit, force = false, io, lockWaitMs }: { dir: string; tag: string; commit: string; force?: boolean; io: InstallIo; lockWaitMs?: number }): Promise<InstallOutcome> {
  const notes: string[] = [];
  const read = readState(dir);
  const same = !force && read.kind === "ok" ? sameBuild(dir, read.state.active, tag, commit) : null;
  if (same) return { kind: "unchanged", tag, version: same.version, notes };
  const staging = path.join(dir, `.staging-${io.pid}-${io.now()}`);
  // checkoutPinned는 아직 없는 경로에 클론한다(있는데 .git이 없으면 거절한다)
  const repoDir = path.join(staging, "repo");
  try {
    fs.mkdirSync(staging, { recursive: true });
    io.log(`체크아웃(${tag}, ${commit.slice(0, 12)})`);
    await io.checkout(repoDir, tag, commit);
    const version = await build(path.join(repoDir, "server"), io);
    return await publish({ dir, tag, commit, version, repoDir, io, notes, force, lockWaitMs });
  } catch (error) {
    return { kind: "failed", tag, reason: (error as Error).message, notes };
  } finally {
    // 옮겼으면 빈 임시 폴더만 남는다. 실패했으면 받은 것(node_modules 포함)을 지운다. 지우지 못한 것은 봇의 기동 정리가 지운다(만든 프로세스가 끝난 임시 폴더)
    await fs.promises.rm(staging, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
  }
}

export { installBgutil };
export type { InstallIo, InstallOutcome };
