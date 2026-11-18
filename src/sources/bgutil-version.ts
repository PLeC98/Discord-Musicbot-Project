// bgutil(POToken 공급자)의 설치된 버전, 목표(BGUTIL_VERSION), 최신 릴리스. 기동 시와 하루 한 번 최신을 보고, 옮길 것이 있으면 한 줄 남긴다.
// 설치는 하지 않는다(pnpm run install:bgutil. 새 폴더에 받으므로 봇이 켜져 있어도 되고, 다시 시작하면 적용된다). 봇 상태 탭이 세 버전을 보여 준다

import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/error-kind.ts";
import { bgutilBundle } from "./bgutil/bundle.ts";
import { newerRelease } from "../rules/vendor-updates.ts";
import { latestReleaseTag } from "./github-release.ts";
const log = logger.child({ category: "core", sub: "bgutil" });

const REPO = "Brainicism/bgutil-ytdlp-pot-provider";
const DAY_MS = 24 * 60 * 60 * 1000;
// 확인이 실패하면 이만큼 뒤에 다시 본다
const RETRY_MS = 60 * 60 * 1000;

/** 디스크, 네트워크, 시계. 테스트가 가짜를 넘긴다 */
type Io = { installed(): string | null; latest(): Promise<string>; now(): number };

/** 기동 시 정한 빌드의 서버 버전(태그와 같은 글자, sources/bgutil/bundle). 설치돼 있지 않으면 null */
const readInstalled = () => bgutilBundle()?.version ?? null;

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
    // 코드를 업데이트해 목표가 올랐는데 다시 설치하지 않은 경우. 최신을 조회하지 않아도 안다
    if (this.installed !== target) log.warn(`bgutil 설치 버전이 설정값과 다름: 설치 ${this.installed}, 설정 ${target}. pnpm run install:bgutil로 버전을 맞추고 봇을 다시 시작하세요`);
    await this._tick();
  }

  async _tick() {
    let failed = false;
    try {
      this.latest = await this.io.latest();
      this.checkedAt = this.io.now();
      const target = config.bgutil.version;
      const newer = newerRelease(this.latest, target);
      if (newer) log.info(`bgutil 새 버전 있음: ${target} → ${newer}. 봇을 업데이트하면 기본값이 따라 오르고, 먼저 쓰려면 .env에 BGUTIL_VERSION과 그 태그의 커밋(BGUTIL_COMMIT)을 적은 뒤 봇을 종료하고 pnpm run update:bgutil 실행`);
    } catch (error) {
      failed = true;
      log.warn(`bgutil 새 버전 조회 실패: ${messageOf(error)}`);
    }
    this._schedule(failed ? RETRY_MS : DAY_MS);
  }

  _schedule(delayMs: number) {
    this.stop();
    this.timer = setTimeout(() => {
      void this._tick().catch((error: unknown) => {
        const frames = error instanceof Error ? (error.stack ?? "").split("\n") : [];
        const at = frames.find((line) => line.trimStart().startsWith("at "))?.trim();
        log.warn(`bgutil 버전 확인 타이머 실패(재예약 안 됨, 주기 확인 중단): ${messageOf(error)}${at ? ` | ${at}` : ""}`);
      });
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
