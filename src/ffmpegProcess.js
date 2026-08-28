"use strict";

const { spawn } = require("child_process");
const { ffmpegPath } = require("./ffmpegPath");
const procRegistry = require("./ChildProcessRegistry");
const log = require("./logger").child({ category: "ffmpeg" });

/**
 * ffmpeg 자식 프로세스 생성.
 *
 * prism.FFmpeg는 쓰지 않는다(prism-media@1.3.5). `command` 옵션을 무시하고 자체 탐색한 바이너리를
 * 쓰며, stderr를 배수하지 않아 로그를 켜면 파이프 버퍼가 차서 멈추고, `'close'`가 Duplex로 가버려
 * 프로세스 종료와 어긋난다.
 */

// SIGKILL/SIGTERM은 스킵·정지·종료에서 우리가 보내는 것이므로 크래시가 아니다.
const CRASH_SIGNALS = new Set(["SIGSEGV", "SIGABRT", "SIGBUS", "SIGILL", "SIGFPE"]);

/**
 * @param {string[]} args 완전한 ffmpeg 인자 — **출력 대상까지 호출부가 지정한다.**
 *   재생은 `pipe:1`, 캐시 변환은 `-y <파일>`이라 여기서 임의로 붙일 수 없다.
 * @param {string} label 로그·레지스트리 표기용 ("stream" | "playback" | "download")
 * @param {{killOnStdoutClose?: boolean}} opts stdout을 소비하는 경로(재생)에서만 true
 * @returns {import("child_process").ChildProcess}
 */
function spawnFfmpeg(args, label, { killOnStdoutClose = true } = {}) {
  const bin = ffmpegPath();
  const child = spawn(bin, args, { windowsHide: true });

  // 봇이 강제 종료돼도 고아로 남지 않도록 등록(라이브 스트리밍은 스스로 끝나지 않는다).
  const release = procRegistry.register(child, `ffmpeg:${label}`);

  // 정상 운용에서는 조용하도록 모아두기만 하고, 비정상 종료일 때만 함께 내보낸다.
  let stderrTail = "";
  child.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-1000);
  });
  child.stderr.on("error", () => {
    /* 종료 중 파이프 오류는 무시 */
  });

  // ffmpeg가 먼저 죽으면 stdin 쓰기가 EPIPE로 터진다. 잡지 않으면 uncaughtException이 된다.
  child.stdin.on("error", () => {
    /* 소비자 쪽에서 종료를 감지해 처리한다 */
  });

  // 소비자(@discordjs/voice)가 stdout을 파괴하면 ffmpeg는 write에서 막힌 채 남는다 —
  // prism의 _cleanup()이 하던 일을 여기서 대신한다.
  // 파일로 출력하는 캐시 변환 경로는 stdout을 소비하지 않으므로 이 정리를 걸지 않는다(조기 종료 방지).
  if (killOnStdoutClose) {
    child.stdout.on("close", () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
  }

  child.on("error", (err) => {
    release();
    log.error(`❌ ffmpeg(${label}) 실행 실패: ${err.message} (경로: ${bin})`);
  });

  child.on("exit", (code, signal) => {
    release();
    const detail = stderrTail.trim() ? ` — ${stderrTail.trim()}` : "";
    if (CRASH_SIGNALS.has(signal)) {
      log.error(`❌ ffmpeg(${label}) 비정상 종료: ${signal}${detail}`);
    } else if (code !== 0 && code !== null) {
      log.warn(`⚠️ ffmpeg(${label}) 종료 코드 ${code}${detail}`);
    }
  });

  return child;
}

module.exports = { spawnFfmpeg, _internals: { CRASH_SIGNALS } };
