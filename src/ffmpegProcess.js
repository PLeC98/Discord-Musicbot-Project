"use strict";

const { spawn } = require("child_process");
const { ffmpegPath } = require("./ffmpegPath");
const procRegistry = require("./infra/processRegistry");
const log = require("./infra/log/logger").child({ category: "ffmpeg" });

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
 * @param {string[]} args 완전한 ffmpeg 인자. 출력 대상까지 호출부가 지정한다.
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

  // 소비자(@discordjs/voice)가 stdout을 파괴하면 ffmpeg는 write에서 막힌 채 남는다.
  // prism의 _cleanup()이 하던 일을 여기서 대신한다.
  // 파일로 출력하는 캐시 변환 경로는 stdout을 소비하지 않으므로 이 정리를 걸지 않는다(조기 종료 방지).
  // 우리가 손을 떼서 죽인 것인지 표시. 프로세스가 아직 살아 있는데 stdout이 닫혔다면
  // 닫은 쪽은 소비자, 즉 우리다(무지연 전환에서 옛 소스를 버릴 때가 그렇다).
  // 이때 ffmpeg는 파이프 쓰기가 실패해 스스로 죽는데(Windows에서는 EINVAL → 종료 코드 -22),
  // 그건 사고가 아니라 우리가 시킨 정리다. 경고로 올리면 안 된다.
  let closedByUs = false;
  if (killOnStdoutClose) {
    child.stdout.on("close", () => {
      if (child.exitCode === null && child.signalCode === null) {
        closedByUs = true;
        child.kill("SIGKILL");
      }
    });
  }

  child.on("error", (err) => {
    release();
    log.error(`ffmpeg(${label}) 실행 실패: ${err.message} (경로: ${bin})`);
  });

  child.on("exit", (code, signal) => {
    release();
    const detail = stderrTail.trim() ? `: ${stderrTail.trim()}` : "";
    if (CRASH_SIGNALS.has(signal)) {
      log.error(`ffmpeg(${label}) 비정상 종료: ${signal}${detail}`);
    } else if (closedByUs) {
      // 종료 코드는 남긴다. 조사할 때 "정리로 죽은 것"과 "정리 직전에 이미 이상했던 것"을 가른다.
      log.debug(`ffmpeg(${label}) 정리 완료 (종료 코드 ${code ?? signal})`);
    } else if (code !== 0 && code !== null) {
      log.warn(`ffmpeg(${label}) 종료 코드 ${code}${detail}`);
    }
  });

  return child;
}

/**
 * ffmpeg가 파일을 열어 내놓는 안내문에서 우리가 쓰는 세 가지를 뽑는다.
 * 파싱만 한다. 프로세스를 띄우지 않으므로 테스트가 실물 파일 없이 고정할 수 있다.
 *
 * 비트레이트는 스트림 줄에 적힌 값이 있으면 그쪽을 쓴다. `Duration:` 줄의 값은 컨테이너 전체지만
 * 오디오 전용 파일에서는 둘이 거의 같고 스트림 줄에 없는 형식도 많아 폴백으로 쓴다.
 *
 * @returns {{durationSec: number|null, codec: string|null, bitrateKbps: number|null}}
 */
function parseProbeOutput(text) {
  const out = { durationSec: null, codec: null, bitrateKbps: null };
  const str = String(text || "");

  const dur = str.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (dur) {
    const sec = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + parseFloat(dur[3]);
    if (Number.isFinite(sec) && sec > 0) out.durationSec = Math.round(sec);
  }

  const stream = str.match(/Audio:\s*([A-Za-z0-9_.-]+)([^\r\n]*)/);
  if (stream) {
    out.codec = stream[1].toLowerCase();
    const perStream = stream[2].match(/,\s*(\d+)\s*kb\/s/);
    if (perStream) out.bitrateKbps = Number(perStream[1]);
  }
  // 컨테이너 값은 영상이 섞여 있으면 오디오 비트레이트가 아니다. 모르는 채로 두는 편이 낫다.
  // 부르는 쪽이 "상한을 넘음"으로 보고 멀쩡한 opus 를 다시 굽기 때문이다.
  if (out.bitrateKbps === null && !/Stream #\d+:\d+[^\r\n]*:\s*Video:/.test(str)) {
    const container = str.match(/Duration:[^\r\n]*?bitrate:\s*(\d+)\s*kb\/s/);
    if (container) out.bitrateKbps = Number(container[1]);
  }
  if (!(out.bitrateKbps > 0)) out.bitrateKbps = null;

  return out;
}

/**
 * 로컬 오디오 파일 안에 무엇이 들었는지 묻는다. 열지 못하면 전부 null.
 *
 * `-c copy -f null -`은 디코딩 없이 헤더만 읽어 100ms대에 끝난다. 길이·코덱·비트레이트가
 * 한 번에 나오므로 따로 물어볼 일이 없다.
 */
function probeAudio(file) {
  return new Promise((resolve) => {
    const unknown = { durationSec: null, codec: null, bitrateKbps: null };
    let child;
    try {
      child = spawnFfmpeg(["-hide_banner", "-i", file, "-c", "copy", "-f", "null", "-"], "probe", { killOnStdoutClose: false });
    } catch {
      return resolve(unknown);
    }

    let out = "";
    child.stderr.on("data", (chunk) => {
      out = (out + chunk.toString()).slice(-4000);
    });
    child.on("error", () => resolve(unknown));
    child.on("exit", () => resolve(parseProbeOutput(out)));
  });
}

/**
 * 로컬 오디오 파일의 실제 길이(초). 알아낼 수 없으면 null.
 *
 * 직접 링크는 Content-Length로 길이를 추정하는데 VBR에서 양방향으로 크게 어긋난다
 * (실측: 241초 파일이 비트레이트에 따라 137초 또는 509초로 나왔다).
 */
async function probeDurationSec(file) {
  return (await probeAudio(file)).durationSec;
}

module.exports = { spawnFfmpeg, probeAudio, probeDurationSec, _internals: { CRASH_SIGNALS, parseProbeOutput } };
