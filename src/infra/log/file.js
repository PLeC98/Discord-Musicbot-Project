// NDJSON 파일 destination. LogManager.destinations에 얹히는 소비자 하나.
//
// 파일 로직을 facade(src/infra/log/logger.js)가 아니라 destination 계층에 두면, 나중에 pino로 바꿔도
// 같은 자리에 transport가 앉으므로 호출부가 그대로 살아남는다.
//
// 한 줄에 레코드 하나. 가공은 ANSI 제거뿐이다(색은 터미널 사정이고, 파일에 남으면 grep이 깨진다).
// 샤딩해도 파일을 나누지 않는다. 분석하려고 파일 여러 개를 여는 것은 손해다.
//
// 쓰기는 동기다. 사후 분석이 목적이라 죽는 순간의 마지막 줄이 가장 중요한데, 스트림 버퍼는
// process.exit()이나 치명적 종료에서 그대로 날아간다. 우리 로그량에서 writeSync 비용은 무시할 수준이다.

import fs from "fs";
import path from "path";

const ANSI_RE = /\x1B(?:[@-Z\-_]|\[[0-?]*[ -/]*[@-~])/g;

// 파일명에 박을 시각. 로컬 시간이고 파일명에 못 쓰는 `:`는 `-`로 바꾼다.
//   2026-09-10T14-23-05.123
function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
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
function backupPath(file, at = new Date()) {
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
function nextBackupPath(file, exists = fs.existsSync, at = new Date()) {
  let when = at;
  let target = backupPath(file, when);
  while (exists(target)) {
    when = new Date(when.getTime() + 1);
    target = backupPath(file, when);
  }
  return target;
}

function stripAnsi(s) {
  return typeof s === "string" ? s.replace(ANSI_RE, "") : s;
}

/**
 * 두 설정은 서로 다른 축이고, 각각의 0은 "그 축에 제한 없음"을 뜻한다.
 *
 *   maxBytes = 0  → 회전하지 않는다. 한 파일에 계속 쓴다(개수 설정은 의미 없음)
 *   keep     = 0  → 회전은 하되 오래된 것을 지우지 않는다. 파일이 계속 쌓인다
 *   둘 다 >0      → maxBytes에서 회전하고, 분리된 파일이 keep개를 넘으면 오래된 것부터 지운다
 *
 * 분리된 파일에는 분리한 시각이 붙는다 (bot-2026-09-10T14-23-05.123.log).
 *
 * @param {string} file      기록할 파일 경로(절대)
 * @param {number} maxBytes  이 크기를 넘으면 회전. 0이면 회전 안 함
 * @param {number} keep      보관할 회전본 개수. 0이면 제한 없이 쌓음
 * @returns {{write:(rec:object)=>void, close:()=>void, path:string}}
 */
function createFileDestination({ file, maxBytes, keep }) {
  let fd = null;
  let size = 0;

  // 오류는 한 번만 알리고 조용히 멈춘다. 여기서 logger를 부르면 이 destination으로 되돌아온다.
  function giveUp(what, err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 이미 닫혔거나 못 닫음. 어차피 포기하는 길 */
      }
      fd = null;
    }
    process.stderr.write(`[logFile] ${what}. 파일 로그를 중단합니다 (${file}): ${err.message}\n`);
  }

  function open() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      fd = fs.openSync(file, "a");
    } catch (err) {
      giveUp("파일을 열 수 없습니다", err);
    }
  }

  // 지금까지 분리해 둔 파일들. 이름순이 곧 시간순이다(파일명이 로컬 시각이라).
  function rotatedFiles() {
    const base = path.basename(file);
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^${esc(stem)}-\\d{4}-\\d{2}-\\d{2}T[\\d.-]+${esc(ext)}$`);
    try {
      return fs
        .readdirSync(path.dirname(file))
        .filter((n) => re.test(n))
        .sort();
    } catch {
      return []; // 디렉터리를 못 읽으면 정리를 건너뛴다. 기록은 계속되어야 한다
    }
  }

  // keep을 넘는 오래된 파일 삭제. keep=0이면 제한이 없으므로 아무것도 지우지 않는다.
  function prune() {
    if (keep <= 0) return;
    const old = rotatedFiles();
    for (const name of old.slice(0, Math.max(0, old.length - keep))) {
      try {
        fs.unlinkSync(path.join(path.dirname(file), name));
      } catch {
        /* 지우지 못해도 기록은 계속한다. 다음 회전에서 다시 시도한다 */
      }
    }
  }

  // 회전: fd를 먼저 닫는다. Windows는 열려 있는 파일을 rename하지 못한다.
  // 번호 방식과 달리 rename은 한 번뿐이다(파일 전부를 밀어 올리지 않는다).
  function rotate() {
    try {
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(file, nextBackupPath(file));
    } catch (err) {
      return giveUp("로그 회전 실패", err);
    }
    prune();
    open();
  }

  function write(rec) {
    if (fd === null) return;
    let line;
    try {
      line = `${JSON.stringify({ ...rec, msg: stripAnsi(rec.msg) })}\n`;
    } catch {
      // 순환 참조 등으로 직렬화가 안 되면 최소한 메시지는 남긴다.
      line = `${JSON.stringify({ time: rec.time, level: rec.level, msg: String(stripAnsi(rec.msg)) })}\n`;
    }
    try {
      fs.writeSync(fd, line);
    } catch (err) {
      return giveUp("기록 실패", err);
    }
    size += Buffer.byteLength(line);
    if (maxBytes > 0 && size >= maxBytes) rotate();
  }

  function close() {
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

const exported = { createFileDestination, backupPath, nextBackupPath, stripAnsi, stamp };
export default exported;
export { exported as "module.exports" };
