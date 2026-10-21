// NDJSON 파일 destination. LogManager.destinations에 얹히는 소비자 하나.
//
// 파일 로직을 facade(src/infra/log/logger.ts)가 아니라 destination 계층에 두면, 나중에 pino로 바꿔도
// 같은 위치에 transport가 앉으므로 호출부가 그대로 살아남는다.
//
// 한 줄에 레코드 하나. 가공은 ANSI 제거뿐이다(색은 터미널 사정이고, 파일에 남으면 grep이 깨진다).
// 로그는 한 파일에 모은다. 분석하려고 파일 여러 개를 여는 것은 손해다.
//
// 쓰기는 동기다. 사후 분석이 목적이라 죽는 순간의 마지막 줄이 가장 중요한데, 스트림 버퍼는
// process.exit()이나 치명적 종료에서 그대로 날아간다. 우리 로그량에서 writeSync 비용은 무시할 수준이다.

import fs from "fs";
import path from "path";
import { repeatingFailure } from "../repeating-failure.ts";
import type { LogRecord } from "./sink.ts";

const ANSI_RE = /\x1B(?:[@-Z\-_]|\[[0-?]*[ -/]*[@-~])/g;

// 파일명에 박을 시각. 로컬 시간이고 파일명에 못 쓰는 `:`는 `-`로 바꾼다.
//   2026-09-10T14-23-05.123
function stamp(d: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// logs/bot.log → logs/bot-2026-09-10T14-23-05.123.log (확장자가 없으면 뒤에 붙인다)
//
// 번호(bot.1.log)가 아니라 시각을 박는 이유:
//  - 번호는 회전할 때마다 파일 전부를 rename해야 한다(1→2, 2→3 …). 시각은 rename 한 번이다.
//  - 파일명만 보고 언제 것인지 안다. 번호는 열어봐야 알고, 회전할 때마다 뜻이 바뀐다.
//  - 이름순 정렬이 곧 시간순이다.
// 박는 값은 분리한 시각이다. "언제부터 기록했는지"는 재시작 후 기존 파일에 이어 쓸 때
// 알 수가 없지만(첫 줄을 읽어야 한다), 분리 시각은 그 순간 확실하다.
function backupPath(file: string, at: Date | string = new Date()): string {
  const ext = path.extname(file);
  const tag = typeof at === "string" ? at : stamp(at);
  return ext ? `${file.slice(0, -ext.length)}-${tag}${ext}` : `${file}-${tag}`;
}

/**
 * 비어 있는 분리본 경로. 같은 밀리초에 두 번 회전하면 이름이 겹치므로 시각을 1ms씩 민다.
 *
 * 번호를 덧붙이는 방법(`…407-2.log`)은 쓸 수 없다. `-`(0x2D)가 `.`(0x2E)보다 작아서
 * 번호가 붙은 쪽이 원본보다 앞으로 정렬되고, 이름순=시간순 계약이 깨진다.
 * 시각을 미는 쪽은 이름 모양이 하나로 유지된다.
 */
function nextBackupPath(file: string, exists: (target: string) => boolean = fs.existsSync, at: Date = new Date()): string {
  let when = at;
  let target = backupPath(file, when);
  while (exists(target)) {
    when = new Date(when.getTime() + 1);
    target = backupPath(file, when);
  }
  return target;
}

/** file 에서 떼어 낸 파일들의 이름(같은 폴더). 이름순이 곧 시간순이다(파일명이 로컬 시각이라). 폴더를 못 읽으면 빈 목록 */
function rotatedFilesOf(file: string): string[] {
  const base = path.basename(file);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${esc(stem)}-\\d{4}-\\d{2}-\\d{2}T[\\d.-]+${esc(ext)}$`);
  try {
    return fs
      .readdirSync(path.dirname(file))
      .filter((n) => re.test(n))
      .sort();
  } catch {
    return [];
  }
}

function stripAnsi(s: unknown): unknown {
  return typeof s === "string" ? s.replace(ANSI_RE, "") : s;
}

/**
 * 두 설정은 서로 다른 축이고, 각각의 0은 "그 축에 제한 없음"을 뜻한다.
 *
 *   maxBytes = 0  → 회전하지 않는다. 한 파일에 계속 쓴다(개수 설정은 의미 없음)
 *   keep     = 0  → 회전은 하되 오래된 것을 삭제하지 않는다. 파일이 계속 쌓인다
 *   둘 다 >0      → maxBytes에서 회전하고, 분리된 파일이 keep개를 넘으면 오래된 것부터 삭제한다
 *
 * 분리된 파일에는 분리한 시각이 붙는다 (bot-2026-09-10T14-23-05.123.log).
 *
 * file: 기록할 파일 경로(절대). maxBytes: 이 크기를 넘으면 회전(0이면 회전 안 함). keep: 보관할 회전본 개수(0이면 제한 없이 쌓음)
 */
// 멈춘 파일 로그를 다시 열어 보는 간격
const RETRY_MS = 30_000;

// notice: 파일 로그가 멈추고 풀릴 때 한 줄 알리는 곳(기본은 표준 오류). 로거로 알리면 이 destination 으로 되돌아온다
// retryMs · now: 다시 열어 보는 간격과 시계(테스트가 넘긴다)
function createFileDestination({ file, maxBytes, keep, notice = (line: string) => process.stderr.write(line), retryMs = RETRY_MS, now = Date.now }: { file: string; maxBytes: number; keep: number; notice?: (line: string) => unknown; retryMs?: number; now?: () => number }): { write: (rec: LogRecord) => void; close: () => void; path: string } {
  let fd: number | null = null;
  let size = 0;
  let closed = false;
  // 멈춘 때 · 마지막으로 열어 본 때 · 그동안 남기지 못한 줄 수. 멈추지 않았으면 down 이 null
  let down: number | null = null;
  let lastTry = 0;
  let lost = 0;
  // 처음 한 번 알리고, 같은 까닭은 세기만 하고, 풀리면 한 줄(표준 오류로)
  const failures = repeatingFailure({ error: (line) => notice(`[logFile] ${line}\n`), info: (line) => notice(`[logFile] ${line}\n`) }, `파일 로그(${file})`);

  // 멈춘다. 그동안의 줄은 버리고 retryMs 마다 다시 열어 본다. 여기서 logger를 부르면 이 destination으로 되돌아온다.
  function fail(what: string, err: unknown) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 이미 닫혔거나 못 닫음. 어차피 다시 연다 */
      }
      fd = null;
    }
    down ??= now();
    lastTry = now();
    failures.fail(`${what}: ${(err as Error).message}`);
  }

  function open() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      fd = fs.openSync(file, "a");
      return true;
    } catch (err) {
      fail("파일을 열 수 없습니다", err);
      return false;
    }
  }

  // 멈춘 동안이면 때가 됐을 때 다시 열어 본다. 열리면 멈췄던 동안을 파일에도 한 줄 남긴다(사후 분석은 파일만 본다)
  function ready() {
    if (fd !== null) return true;
    if (closed || down === null || now() - lastTry < retryMs) return false;
    lastTry = now();
    if (!open()) return false;
    failures.ok();
    const gap = `${JSON.stringify({ time: now(), level: 40, category: "log", msg: `파일 로그가 ${Math.round((now() - down) / 1000)}초 동안 멈췄다가 다시 씁니다. 그동안 ${lost}줄을 남기지 못했습니다` })}\n`;
    down = null;
    lost = 0;
    writeLine(gap);
    return fd !== null;
  }

  // keep을 넘는 오래된 파일 삭제. keep=0이면 제한이 없으므로 아무것도 삭제하지 않는다.
  function prune() {
    if (keep <= 0) return;
    const old = rotatedFilesOf(file);
    for (const name of old.slice(0, Math.max(0, old.length - keep))) {
      try {
        fs.unlinkSync(path.join(path.dirname(file), name));
      } catch {
        /* 삭제하지 못해도 기록은 계속한다. 다음 회전에서 다시 시도한다 */
      }
    }
  }

  // 회전: fd를 먼저 닫는다. Windows는 열려 있는 파일을 rename하지 못한다.
  // 번호 방식과 달리 rename은 한 번뿐이다(파일 전부를 밀어 올리지 않는다).
  function rotate() {
    try {
      fs.closeSync(fd as number); // 기록 중에만 회전한다. 그때는 열려 있다
      fd = null;
      fs.renameSync(file, nextBackupPath(file));
    } catch (err) {
      return fail("로그 회전 실패", err);
    }
    prune();
    open();
  }

  // 한 줄 쓴다. 실패하면 멈춘다
  function writeLine(line: string) {
    try {
      fs.writeSync(fd as number, line);
    } catch (err) {
      return fail("기록 실패", err);
    }
    size += Buffer.byteLength(line);
    if (maxBytes > 0 && size >= maxBytes) rotate();
  }

  function write(rec: LogRecord) {
    if (!ready()) {
      if (!closed && down !== null) lost++;
      return;
    }
    let line: string;
    try {
      line = `${JSON.stringify({ ...rec, msg: stripAnsi(rec.msg) })}\n`;
    } catch {
      // 순환 참조 등으로 직렬화가 안 되면 최소한 메시지는 남긴다.
      line = `${JSON.stringify({ time: rec.time, level: rec.level, msg: String(stripAnsi(rec.msg)) })}\n`;
    }
    writeLine(line);
  }

  function close() {
    closed = true;
    if (fd === null) return;
    try {
      fs.closeSync(fd);
    } catch {
      /* 종료 중이므로 무시 */
    }
    fd = null;
  }

  open();
  return { write, close, path: file };
}

export { createFileDestination, backupPath, nextBackupPath, rotatedFilesOf, stripAnsi, stamp };
