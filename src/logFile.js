"use strict";

// NDJSON 파일 destination — LogManager.destinations에 얹히는 소비자 하나.
//
// 파일 저장을 sink의 destination 계층에 두는 이유: pino가 들어와도(Phase 3) 같은 자리에
// pino.multistream/transport가 앉으므로 호출부와 facade가 무수정으로 살아남는다.
// facade(src/logger.js) 안에 파일 로직을 넣으면 그건 pino 교체 때 통째로 버려진다.
//
// 형식은 가공하지 않은 NDJSON — 한 줄 = 레코드 하나. 사람이 읽기 좋게 정리하는 건 읽는 쪽의 일이다.
// 유일한 가공은 ANSI 제거다(색은 터미널 사정이고, 파일에 남으면 grep이 깨진다).
//
// 샤딩해도 파일을 나누지 않는다 — 분석하려고 파일 여러 개를 여는 건 손해다. 매니저 집계가
// 들어오면(Phase 3) 이 모듈을 매니저 프로세스에 그대로 얹고 샤드 쪽은 ipc destination을 쓴다.
//
// 쓰기는 동기다. 이 파일의 존재 이유가 사후 분석이라 "죽는 순간의 마지막 줄"이 가장 중요한데,
// 스트림 버퍼는 process.exit()·치명적 종료에서 그대로 날아간다. 한 줄이 수백 바이트라
// writeSync는 마이크로초 단위이고, 우리 로그량(초당 몇 줄)에서 이벤트 루프 영향은 무시할 수준이다.
// (pino도 같은 이유로 sync 옵션을 둔다. 처리량이 문제가 되면 그때 sonic-boom에 넘긴다.)

const fs = require("fs");
const path = require("path");

const ANSI_RE = /\x1B(?:[@-Z\-_]|\[[0-?]*[ -/]*[@-~])/g;

// logs/bot.log → logs/bot.3.log (확장자가 없으면 뒤에 붙인다)
function backupPath(file, n) {
  const ext = path.extname(file);
  return ext ? `${file.slice(0, -ext.length)}.${n}${ext}` : `${file}.${n}`;
}

function stripAnsi(s) {
  return typeof s === "string" ? s.replace(ANSI_RE, "") : s;
}

/**
 * 두 설정은 서로 다른 축이고, **각각의 0은 "그 축에 제한 없음"**을 뜻한다.
 *
 *   maxBytes = 0  → 회전하지 않는다. 한 파일에 계속 쓴다(개수 설정은 의미 없음)
 *   keep     = 0  → 회전은 하되 오래된 것을 지우지 않는다. 파일이 계속 쌓인다
 *   둘 다 >0      → maxBytes에서 회전하고 bot.<keep>.log를 넘어가는 것은 버린다
 *
 * 번호는 항상 **1이 가장 최근 백업**이다(회전할 때마다 뒤로 한 칸씩 민다).
 *
 * @param {string} file      기록할 파일 경로(절대)
 * @param {number} maxBytes  이 크기를 넘으면 회전. 0이면 회전 안 함
 * @param {number} keep      보관할 회전본 개수. 0이면 제한 없이 쌓음
 * @returns {{write:(rec:object)=>void, close:()=>void, path:string}}
 */
function createFileDestination({ file, maxBytes, keep }) {
  let fd = null;
  let size = 0;

  // 오류는 한 번만 알리고 조용히 멈춘다 — 여기서 logger를 부르면 이 destination으로 되돌아온다.
  function giveUp(what, err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 이미 닫혔거나 못 닫음 — 어차피 포기하는 길 */
      }
      fd = null;
    }
    process.stderr.write(`[logFile] ${what} — 파일 로그를 중단합니다 (${file}): ${err.message}\n`);
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

  // 이번 회전에서 밀어 올릴 가장 높은 번호.
  // keep>0이면 그 번호가 상한이고, 거기 있던 파일은 덮여서 사라진다(가장 오래된 것을 버린다).
  // keep=0(제한 없음)이면 지금 있는 것 중 가장 높은 번호 + 1 — 아무것도 덮지 않는다.
  function topIndex() {
    if (keep > 0) return keep;
    const base = path.basename(file);
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^${esc(stem)}\\.(\\d+)${esc(ext)}$`);
    let max = 0;
    try {
      for (const name of fs.readdirSync(path.dirname(file))) {
        const m = re.exec(name);
        if (m) max = Math.max(max, Number(m[1]));
      }
    } catch {
      /* 디렉터리를 못 읽으면 1부터 — 최악이라도 기존 백업 하나를 덮을 뿐이다 */
    }
    return max + 1;
  }

  // 회전: fd를 먼저 닫는다 — Windows는 열려 있는 파일을 rename하지 못한다.
  function rotate() {
    const top = topIndex();
    try {
      fs.closeSync(fd);
      fd = null;
      for (let n = top; n >= 1; n--) {
        const from = n === 1 ? file : backupPath(file, n - 1);
        if (fs.existsSync(from)) fs.renameSync(from, backupPath(file, n));
      }
    } catch (err) {
      return giveUp("로그 회전 실패", err);
    }
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

module.exports = { createFileDestination, backupPath, stripAnsi };
