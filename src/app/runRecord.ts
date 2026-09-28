// 실행 기록(database/run-state.json). 봇이 어떻게 끝났는지 다음 기동이 알게 한다.
//
// 기동이 begin() 으로 {시작 시각} 을 적고, 돌아 있는 동안 "마지막으로 살아 있던 시각"을 고쳐 적는다. 끝낼 때 end() 가 끝난 방식을 적는다.
// 끝난 방식이 없으면 기록 없이 끊긴 것이다(창 닫기 · 강제 종료 · 네이티브 충돌 · 정전). 가동 시간은 마지막으로 살아 있던 시각까지로 본다.
// 짧게 끊긴 실행(기록 없이 끊김 · 전역 폭주)이 연달아 두 번이면 이번 기동은 세션을 되살리지 않는다. 세션이 끊김의 까닭이면 켤 때마다 다시 끊긴다.
// begin() 전에는 아무것도 쓰지 않는다(시험 · 스크립트가 실제 기록을 건드리지 않게).

import fs from "fs";
import path from "path";

type Ending = "shutdown" | "startup-failed" | "global-flood";
type Run = { startedAt: number; aliveAt: number; ended: { how: Ending; at: number } | null; shortStreak: number };
/** 기동이 알게 되는 것 */
type Previous = { line: string; skipRestore: boolean; shortStreak: number };

const FILE = path.join(import.meta.dirname, "..", "..", "database", "run-state.json");
const ALIVE_MS = 30_000; // 살아 있던 시각을 고쳐 적는 간격
const SHORT_RUN_MS = 10 * 60_000; // 이보다 짧게 끊긴 실행을 센다
const SKIP_RESTORE_STREAK = 2;

const ENDINGS: Record<Ending, string> = { shutdown: "깨끗이 끝남", "startup-failed": "기동 실패", "global-flood": "전역 폭주로 내림" };

function span(ms: number) {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return `${Math.max(0, Math.round(ms / 1000))}초`;
  if (min < 60) return `${min}분`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

class RunRecord {
  file: string;
  now: () => number;
  run: Run | null = null;
  timer: NodeJS.Timeout | null = null;

  constructor(file = FILE, now = () => Date.now()) {
    this.file = file;
    this.now = now;
  }

  _read(): Run | null {
    try {
      const run = JSON.parse(fs.readFileSync(this.file, "utf8")) as Run;
      return typeof run.startedAt === "number" && typeof run.aliveAt === "number" ? run : null;
    } catch {
      return null;
    }
  }

  // 읽다 만 파일이 남지 않게 옆에 쓰고 옮긴다
  _write() {
    if (!this.run) return;
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(this.run));
    fs.renameSync(temp, this.file);
  }

  /** 기동. 직전 실행을 읽어 한 줄로 알려 주고 이번 실행을 적기 시작한다 */
  begin(): Previous {
    const previous = this._read();
    const at = this.now();
    let shortStreak = 0;
    let line = "직전 실행 기록 없음";
    if (previous) {
      const end = previous.ended?.at ?? previous.aliveAt;
      const uptime = end - previous.startedAt;
      const cut = !previous.ended || previous.ended.how === "global-flood";
      if (cut && uptime < SHORT_RUN_MS) shortStreak = previous.shortStreak + 1;
      const how = previous.ended ? ENDINGS[previous.ended.how] : "기록 없이 끊김";
      line = `직전 실행: ${how} | 가동 ${span(uptime)}${previous.ended ? "" : "(마지막으로 살아 있던 때까지)"}`;
      if (shortStreak > 0) line += ` | 짧게 끊긴 실행 ${shortStreak}번 연달아`;
    }
    this.run = { startedAt: at, aliveAt: at, ended: null, shortStreak };
    this._write();
    this.timer = setInterval(() => this._alive(), ALIVE_MS);
    this.timer.unref?.();
    return { line, shortStreak, skipRestore: shortStreak >= SKIP_RESTORE_STREAK };
  }

  _alive() {
    if (!this.run || this.run.ended) return;
    this.run.aliveAt = this.now();
    try {
      this._write();
    } catch {
      // 다음 간격에 다시 적는다. 못 적어도 끝난 방식은 end() 가 적는다
    }
  }

  /** 끝난 방식을 적는다. begin() 전이면 아무것도 안 한다 */
  end(how: Ending) {
    if (!this.run || this.run.ended) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const at = this.now();
    this.run = { ...this.run, aliveAt: at, ended: { how, at } };
    try {
      this._write();
    } catch {
      // 끝나는 중이다. 못 적으면 다음 기동이 "기록 없이 끊김"으로 본다
    }
  }
}

/** 봇의 실행 기록 하나 */
const runRecord = new RunRecord();

export { runRecord, RunRecord, SHORT_RUN_MS, ALIVE_MS };
export type { Ending as RunEnding };
