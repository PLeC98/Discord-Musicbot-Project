// POToken 서버 사용을 켰는데 bgutil이 설치돼 있지 않으면 봇이 알아서 설치한다(설치 스크립트를 작업 실행기로 돌린다. 기동을 막지 않는다).
// 판정은 저장된 켜기 값으로 한다(BGUTIL_ENABLED는 다시 시작해야 적용되는 값이라 설정 객체는 기동 때 값에 머문다).
// 기동, 설정이 바뀜(설정값 저장, 불러오기, 초기화), 작업 자리가 빔, 운영자의 재시도가 같은 판정 하나(ensure)를 부른다.
// 혼자서 하는 설치는 목표마다 한 번이다: 실패했거나 중단했으면 "시도했음"으로 적어 두고 다시 하지 않는다(안 되는 빌드를 끝없이 되풀이하지 않게).
// 다시 하는 것은 운영자가 재시도할 때, 켜기나 목표가 바뀔 때, 다음 기동 때뿐이다. 설치돼 있지만 목표와 다른 것은 혼자서 받지 않는다(카드가 알린다).
// 끄면 켜기 때문에 시작한 설치를 중단한다.
// 운영자가 "설치 후 다시 시작"을 고르면 다시 시작을 예약해 두고 설치가 끝나면 다시 시작한다. 실패, 중단, 끄기면 예약이 풀린다(닫은 화면이 남긴 예약이 나중에 몰래 실행되지 않게 취소도 받는다)

import path from "node:path";
import fs from "node:fs";
import logger from "../../infra/log/logger.ts";
import { PROJECT } from "../../infra/project-paths.ts";
import { cancelJob, startJob, type ScriptJobInfo, type ScriptJobSpec, type StartResult } from "../../infra/script-job.ts";
import { stripScriptPrefix } from "../../infra/script-line.ts";
import { toolEnv } from "../../config/tool-env.ts";
import config from "../../config/index.ts";
import { BGUTIL_COMMIT, BGUTIL_VERSION } from "../../config/vendor-versions.ts";
import { bgutilPin } from "../../rules/bgutil-install.ts";
import * as tunables from "../../store/tunables.ts";
import { readState } from "./state.ts";
import { ENTRY } from "./launch.ts";
import { missingNeeds } from "./tools.ts";
import type { BgutilNeed } from "./status-types.ts";
const log = logger.child({ category: "core", sub: "bgutil" });

/** 설치 스크립트의 시간 상한(ms). 체크아웃(11분)과 npm ci(10분), 다시 빌드(5분), tsc(3분)를 더한 것 */
const INSTALL_MS = 30 * 60_000;
/** 실패 사유에 붙이는 출력의 마지막 줄 수 */
const TAIL_LINES = 5;

/** 테스트가 교체하는 것 */
type Deps = {
  /** 저장된 POToken 서버 사용 */
  savedEnabled(): boolean;
  /** 기록에 지금 빌드가 있고 실행 파일이 있다 */
  installed(): boolean;
  /** 받을 태그와 커밋(설정이 틀렸으면 error) */
  target(): { tag: string; commit: string } | { error: string };
  needs(): Promise<BgutilNeed[]>;
  start(spec: Omit<ScriptJobSpec, "onEnd">, onEnd: (info: ScriptJobInfo) => void): StartResult;
  cancel(id: number): Promise<unknown>;
  now(): number;
};

function installedNow(dir: string): boolean {
  const read = readState(dir);
  return read.kind === "ok" && read.state.active !== null && fs.existsSync(path.join(dir, read.state.active.folder, "server", ENTRY));
}

const REAL: Deps = {
  // 저장된 값이 없으면 기본값(끔)
  savedEnabled: () => tunables.view().values.BGUTIL_ENABLED === "true",
  installed: () => installedNow(PROJECT.bgutil),
  target: () => bgutilPin(config.bgutil.version, config.bgutil.commit, { version: BGUTIL_VERSION, commit: BGUTIL_COMMIT }),
  needs: () => missingNeeds(PROJECT.bgutil),
  start: (spec, onEnd) => startJob({ ...spec, onEnd }),
  cancel: (id) => cancelJob(id),
  now: () => Date.now(),
};

/** 왜 부르나. manual: 운영자의 재시도(시도 기록을 무시한다) */
type Why = "startup" | "settings" | "idle" | "manual";

class BgutilAutoInstall {
  deps: Deps;
  /** 실패했거나 중단한 목표(`태그@커밋`). 혼자서는 다시 받지 않는다 */
  attempted = new Set<string>();
  /** 도는 설치 작업의 id */
  running: number | null = null;
  /** 다른 작업이 도는 중이라 뒤로 미뤘다 */
  queued = false;
  failure: { reason: string; at: number } | null = null;
  missing: BgutilNeed[] | null = null;
  /** 지난 판정 때의 저장된 켜기 값(꺼졌다 켜지면 시도 기록을 지운다) */
  wasEnabled: boolean | null = null;
  /** 판정이 겹치지 않게(도구 확인을 기다리는 사이 다시 불리면 앞의 것이 끝난 뒤 한 번 더) */
  checking: Promise<void> | null = null;
  again = false;
  /** 설치가 끝나면 부를 다시 시작(운영자가 예약했다) */
  reserved: (() => void) | null = null;

  constructor(deps: Deps = REAL) {
    this.deps = deps;
  }

  /** 판정. 켜져 있고 설치돼 있지 않으면 설치를 시작한다. 예외를 던지지 않는다 */
  ensure(why: Why): Promise<void> {
    if (this.checking) {
      this.again ||= why !== "idle" || this.queued;
      return this.checking;
    }
    this.checking = this._ensure(why)
      .catch((error: unknown) => log.warn(`bgutil 자동 설치 판정 실패: ${(error as Error).message}`))
      .finally(() => {
        this.checking = null;
        if (this.again) {
          this.again = false;
          void this.ensure("settings");
        }
      });
    return this.checking;
  }

  async _ensure(why: Why) {
    const enabled = this.deps.savedEnabled();
    const turnedOn = enabled && this.wasEnabled === false;
    this.wasEnabled = enabled;
    if (!enabled) {
      // 미뤄 두기만 한 설치는 작업이 끝나는 일이 없으니 여기서 예약을 푼다(도는 설치는 중단하면 끝에서 풀린다)
      if (this.queued && this.running === null) this.unreserve("POToken 서버 사용을 끔");
      this.queued = false;
      // 켜기 때문에 시작한 설치를 중단한다(중단한 목표는 시도 기록에 남는다)
      if (this.running !== null) await this.deps.cancel(this.running);
      return;
    }
    if (turnedOn) this.attempted.clear();
    if (this.deps.installed()) {
      this.queued = false;
      return;
    }
    const target = this.deps.target();
    if ("error" in target) {
      this.failure = { reason: target.error, at: this.deps.now() };
      return;
    }
    const key = `${target.tag}@${target.commit}`;
    if (why === "manual") this.attempted.delete(key);
    if (this.running !== null || this.attempted.has(key)) return;
    if (why === "idle" && !this.queued) return;
    const missing = await this.deps.needs();
    this.missing = missing;
    if (missing.length) {
      this.attempted.add(key);
      this.failure = { reason: `설치에 필요한 것이 없음: ${missing.join(", ")}`, at: this.deps.now() };
      log.error(`bgutil 설치 못 함(POToken 없이 진행): ${missing.map(needText).join(", ")}. 설치한 뒤 대시보드 업데이트 탭에서 재시도하거나 봇을 다시 시작하세요`);
      return;
    }
    this._start(target.tag, key);
  }

  _start(tag: string, key: string) {
    const started = this.deps.start({ name: "bgutil-install", script: path.join(PROJECT.root, "scripts", "install-bgutil.ts"), args: [], cwd: PROJECT.root, env: toolEnv(), timeoutMs: INSTALL_MS, succeeded: () => this.deps.installed() }, (info) => this._ended(info, key));
    if (!started.ok) {
      // 다른 작업(ffmpeg 맞추기 등)이 돌고 있다. 자리가 비면 한다. 종료 중이면 하지 않는다
      this.queued = started.reason === "busy";
      if (this.queued) log.info(`bgutil 설치를 다른 작업(${started.running?.name ?? "?"}) 뒤로 미룸`);
      else this.unreserve("봇 종료 중");
      return;
    }
    this.queued = false;
    this.running = started.id;
    this.failure = null;
    log.info(`bgutil ${tag} 설치 시작(POToken 서버 사용이 켜져 있는데 설치돼 있지 않음)`);
  }

  _ended(info: ScriptJobInfo, key: string) {
    this.running = null;
    if (info.state === "succeeded") {
      this.failure = null;
      const restart = this.reserved;
      this.reserved = null;
      log.info(restart ? "bgutil 설치 완료. 예약한 다시 시작 실행" : "bgutil 설치 완료. 다시 시작하면 POToken 서버가 켜짐");
      restart?.();
      return;
    }
    this.unreserve(info.reason === "cancelled" ? "설치 중단" : "설치 실패");
    this.attempted.add(key);
    const tail = info.output.slice(-TAIL_LINES).map(stripScriptPrefix).join(" | ");
    const reason = info.reason === "cancelled" ? "중단" : `${info.reason ?? "?"}${info.exitCode !== null ? `, 종료 코드 ${info.exitCode}` : ""}${tail ? `: ${tail}` : ""}`;
    this.failure = { reason, at: this.deps.now() };
    if (info.reason === "cancelled") log.info("bgutil 설치 중단(POToken 서버 사용을 끔)");
    else log.error(`bgutil 설치 실패(POToken 없이 진행): ${reason}. 대시보드 업데이트 탭에서 재시도하세요`);
  }

  /** 설치가 끝나면 restart를 부르도록 예약한다. 설치 작업이 돌거나 미뤄져 있지 않으면 예약하지 않는다 */
  reserve(restart: () => void): boolean {
    if (this.job() === null) return false;
    this.reserved = restart;
    return true;
  }

  /** 예약을 푼다. 예약이 있었으면 true */
  unreserve(why: string): boolean {
    if (!this.reserved) return false;
    this.reserved = null;
    log.info(`설치 뒤 다시 시작 예약 취소(${why})`);
    return true;
  }

  /** 설치 작업이 도는 중이거나 미뤄졌는가 */
  job(): "running" | "queued" | null {
    if (this.running !== null) return "running";
    return this.queued ? "queued" : null;
  }
}

const NEED_TEXT: Record<BgutilNeed, string> = { git: "git 없음", npm: "npm 없음", folder: "vendor/bgutil에 쓸 수 없음" };
const needText = (need: BgutilNeed) => NEED_TEXT[need];

const bgutilAutoInstall = new BgutilAutoInstall();

export { bgutilAutoInstall, BgutilAutoInstall };
export type { Deps as BgutilAutoDeps };
