"use strict";

const { spawnSync } = require("node:child_process");
const log = require("./logger").child({ category: "proc" });

const IS_WIN = process.platform === "win32";

/**
 * 외부 프로세스(yt-dlp / FFmpeg) 생명주기 레지스트리.
 *
 * 왜 필요한가 — yt-dlp는 라이브/HLS 다운로드를 ffmpeg에 위임한다. 즉 ffmpeg는 봇의 "손자" 프로세스다.
 * Windows에는 프로세스 그룹이 없어 부모가 죽어도 자식·손자는 그대로 살아남고, POSIX에서도 SIGTERM은
 * 자식에게 전달되지 않는다. 실제로 라이브 방송이 잘못 매칭돼 캐시 다운로드가 시작되면 봇을 내려도
 * ffmpeg가 남아 끝나지 않는 방송을 계속 받아쓴다 — 파일 핸들을 물고 있어 삭제도 안 되고 용량만
 * 무한히 불어나며, 작업관리자로 직접 죽이는 것 외엔 방법이 없다(2026-08-27 실측).
 *
 * 그래서 spawn한 프로세스를 전부 등록하고, 종료 시 "트리 전체"를 죽인다.
 *  - Windows: `taskkill /T`가 자손까지 처리한다.
 *  - POSIX  : detached로 띄워 자체 프로세스 그룹을 만든 뒤 그룹(-pid)에 시그널을 보낸다.
 *
 * kill은 process("exit") 훅에서도 돌아야 하므로 전부 동기(spawnSync/process.kill)로 구현한다.
 *
 * ⚠️ 안전 규칙 두 가지 — 둘 다 없으면 무관한 프로세스를 죽일 수 있다.
 *  1. pid는 1보다 큰 정수일 때만 시그널한다. pid 0이면 `-0`이 되어 *우리 자신의* 프로세스 그룹을 죽인다.
 *  2. 이미 종료한 자식은 건너뛴다. PID는 OS가 재사용하므로, 종료된 pid에 kill을 쏘면
 *     그 번호를 물려받은 남의 프로세스가 죽는다. child 객체의 exitCode/signalCode로 판정한다.
 */

/** @type {Map<number, {pid:number, label:string, group:boolean, child:import("node:child_process").ChildProcess}>} */
const active = new Map();
let hooksInstalled = false;

/**
 * exit 훅 설치 — 첫 register 시점에 한 번만.
 * SIGINT/SIGTERM/SIGHUP은 index.js의 gracefulShutdown이 killAll을 명시 호출하고,
 * 여기 exit 훅은 uncaughtException·정상 종료 등 나머지 경로를 위한 백스톱이다.
 */
function install() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  process.on("exit", () => killAll("exit"));
}

/**
 * 자식 프로세스를 등록하고 등록 해제 함수를 돌려준다.
 * @param {import("node:child_process").ChildProcess|{pid?:number}} child spawn된 프로세스(또는 pid/kill을 가진 래퍼)
 * @param {string} label 로그용 이름
 * @param {{group?:boolean}} options group=true면 detached로 띄워 자체 프로세스 그룹을 가진 경우
 * @returns {() => void} 등록 해제 함수 — 프로세스가 정상 종료하면 반드시 호출할 것
 */
function register(child, label = "child", { group = false } = {}) {
  const pid = child && child.pid;
  if (!Number.isInteger(pid) || pid <= 1) return () => {};
  install();
  active.set(pid, { pid, label, group, child });
  return () => active.delete(pid);
}

/** 자식이 아직 살아있는가 — 종료했으면 PID 재사용 위험이 있으므로 시그널을 보내면 안 된다. */
function _isAlive(child) {
  if (!child) return false;
  // ChildProcess는 종료 시 exitCode 또는 signalCode 중 하나가 채워진다(그 전엔 둘 다 null).
  return child.exitCode === null && child.signalCode === null;
}

/**
 * 프로세스와 그 자손을 강제 종료. 이미 종료된 프로세스는 건드리지 않는다.
 * @param {{pid:number, group:boolean, child:any}} entry
 * @returns {boolean} 실제로 kill을 시도했는가
 */
function killTree(entry) {
  const { pid, group, child } = entry;
  if (!Number.isInteger(pid) || pid <= 1) return false; // pid 0 → -0 = 자기 그룹 자살 방지
  if (!_isAlive(child)) return false; // PID 재사용된 남의 프로세스 보호

  if (IS_WIN) {
    // /T = 자손 포함, /F = 강제. yt-dlp가 띄운 ffmpeg는 이 경로에서만 잡힌다.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return true;
  }

  try {
    // detached로 띄웠으면 그룹 전체(-pid) — 손자 ffmpeg까지 같이 죽는다.
    process.kill(group ? -pid : pid, "SIGKILL");
  } catch {
    // ESRCH(이미 종료) 또는 그룹이 없는 경우 — 직접 pid로 한 번 더.
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* 이미 없음 */
    }
  }
  return true;
}

/**
 * 등록된 모든 프로세스를 트리째 종료한다. 멱등 — 두 번 불러도 안전하다.
 * @param {string} reason 로그용
 * @returns {number} 실제로 종료를 시도한 프로세스 수
 */
function killAll(reason = "shutdown") {
  if (active.size === 0) return 0;
  const entries = [...active.values()];
  active.clear();

  const killed = [];
  for (const entry of entries) {
    try {
      if (killTree(entry)) killed.push(`${entry.label}#${entry.pid}`);
    } catch {
      /* 종료 경로에서는 실패해도 더 할 수 있는 일이 없다 */
    }
  }
  if (killed.length) log.warn(`🧹 외부 프로세스 ${killed.length}개 정리 (${reason}): ${killed.join(", ")}`);
  return killed.length;
}

/** 현재 추적 중인 프로세스 수 */
function size() {
  return active.size;
}

module.exports = { register, killAll, size, install, _internals: { active, killTree, _isAlive } };
