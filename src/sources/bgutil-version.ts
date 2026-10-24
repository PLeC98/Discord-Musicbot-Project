// bgutil(POToken 공급자)의 설치된 버전 · 목표(BGUTIL_VERSION) · 최신 릴리스. 기동 때와 하루 한 번 최신을 보고, 옮길 것이 있으면 한 줄 남긴다.
// 설치는 하지 않는다(봇을 끄고 pnpm run update:bgutil. 의존성을 갈아 끼우므로 돌고 있는 POToken 서버와 같이 못 간다). 봇 상태 탭이 셋을 보인다

import fs from "fs";
import path from "path";
import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import { bestEffort } from "../infra/best-effort.ts";
import { PROJECT } from "../infra/project-paths.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import { newerRelease } from "../rules/vendor-updates.ts";
import { latestReleaseTag } from "./github-release.ts";
const log = logger.child({ category: "core", sub: "bgutil" });

const REPO = "Brainicism/bgutil-ytdlp-pot-provider";
const DAY_MS = 24 * 60 * 60 * 1000;
// 확인이 실패하면 이만큼 뒤에 다시 본다
const RETRY_MS = 60 * 60 * 1000;

/** 디스크 · 네트워크 · 시계. 테스트가 가짜를 넘긴다 */
type Io = { installed(): string | null; latest(): Promise<string>; now(): number };

/** 체크아웃의 서버 버전(태그와 같은 글자). 설치돼 있지 않으면 null */
function readInstalled() {
  try {
    const { version } = JSON.parse(fs.readFileSync(path.join(PROJECT.bgutil, "server", "package.json"), "utf8")) as { version?: unknown };
    return typeof version === "string" && version ? version : null;
  } catch (error) {
    if (codeOf(error) !== "ENOENT") log.debug(`bgutil 설치 버전 읽기 실패: ${messageOf(error)}`);
    return null;
  }
}

const REAL: Io = { installed: readInstalled, latest: () => latestReleaseTag(REPO), now: () => Date.now() };

class BgutilVersion {
  io: Io;
  installed: string | null = null;
  latest: string | null = null;
  checkedAt: number | null = null;
  timer: NodeJS.Timeout | null = null;

  constructor(io: Io = REAL) {
    this.io = io;
  }

  /** 상태 탭. newer: 목표보다 새 릴리스(없으면 null). 설치돼 있지 않으면 null */
  state() {
    if (!this.installed) return null;
    const target = config.bgutil.version;
    return { installed: this.installed, target, newer: newerRelease(this.latest, target), checkedAt: this.checkedAt };
  }

  /** 기동. 설치돼 있을 때만 본다 */
  async start() {
    this.installed = this.io.installed();
    if (!this.installed) return;
    const target = config.bgutil.version;
    // 코드를 받아 목표가 올랐는데 다시 설치하지 않은 경우. 최신을 묻지 않아도 안다
    if (this.installed !== target) log.warn(`bgutil 이 설정한 버전이 아닙니다: 설치 ${this.installed} · 설정 ${target}. 봇을 끄고 pnpm run update:bgutil 로 옮기세요`);
    await this._tick();
  }

  async _tick() {
    let failed = false;
    try {
      this.latest = await this.io.latest();
      this.checkedAt = this.io.now();
      const target = config.bgutil.version;
      const newer = newerRelease(this.latest, target);
      if (newer) log.info(`bgutil 에 새 버전이 있습니다: ${target} → ${newer}. .env 의 BGUTIL_VERSION 을 올리고 봇을 끈 뒤 pnpm run update:bgutil`);
    } catch (error) {
      failed = true;
      log.warn(`bgutil 새 버전 조회 실패: ${messageOf(error)}`);
    }
    this._schedule(failed ? RETRY_MS : DAY_MS);
  }

  _schedule(delayMs: number) {
    this.stop();
    this.timer = setTimeout(() => {
      bestEffort(log, this._tick(), "bgutil 새 버전 조회");
    }, delayMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

const bgutilVersion = new BgutilVersion();

export { bgutilVersion, BgutilVersion };
export type { Io as BgutilVersionIo };
