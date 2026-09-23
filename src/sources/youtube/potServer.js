"use strict";

// bgutil POToken 서버. 유튜브가 요구하는 토큰을 만들어 주는 로컬 HTTP 서버를 띄우고 지킨다.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const log = require("../../infra/log/logger").child({ category: "core" });
const config = require("../../../config");

// ── bgutil POToken server ────────────────────────────────────────────────────
const BGUTIL_SERVER_DIR = path.join(__dirname, "..", "..", "..", "bgutil-ytdlp-pot-provider", "server");
const BGUTIL_ENTRY = path.join(BGUTIL_SERVER_DIR, "build", "main.js");
const BGUTIL_PORT = 4416; // bgutil 서버 기본 포트 (yt-dlp 플러그인 기본값과 동일)

// bgutil이 발급한 토큰을 그대로 로그에 남기지 않는다. 세션 자격증명이다.
// (sink의 레드액션은 access_token 계열 이름만 알아서 poToken은 그냥 통과한다.)
function scrubBgutilLine(line) {
  return String(line)
    .replace(/(Generated IntegrityToken:\s*).*/i, "$1[REDACTED]")
    .replace(/((?:poToken|integrityToken)"?\s*[:=]\s*"?)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]");
}

let bgutilProc = null;
let bgutilStopping = false;

function startBgutilServer() {
  if (bgutilStopping) return;
  const installed = fs.existsSync(BGUTIL_ENTRY);

  // 쓰지 않겠다고 했으면 조용히 넘어간다. 안 쓸 서버가 없다고 떠들어봐야 의미가 없고,
  // 인증 없는 로컬 HTTP 서버를 상시 띄우지 않는 것 자체가 이 토글의 목적이다.
  if (!config.bgutil.enabled) {
    if (installed) log.debug({ sub: "bgutil" }, "bgutil이 설치되어 있지만 BGUTIL_ENABLED가 false입니다. POToken 서버를 실행하지 않고 진행합니다.");
    return;
  }
  // 반대로 쓰겠다고 했는데 없으면 시끄럽게 군다. 조용히 넘어가면 POToken이 없는 줄 모른 채 돈다.
  if (!installed) {
    log.error({ sub: "bgutil" }, "BGUTIL_ENABLED가 true로 설정되어 있으나, 설치되어 있지 않습니다! (pnpm run install:bgutil). POToken 없이 진행합니다");
    return;
  }
  bgutilProc = spawn(process.execPath, ["build/main.js"], {
    cwd: BGUTIL_SERVER_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // 남의 프로세스라 레벨을 직접 붙일 수 없다. 스트림(stdout/stderr)과 문구로 가른다.
  // bgutil의 stdout은 전량 요청 단위 상세(POT 생성·챌린지)라 debug로 내린다. 수명주기(시작·준비
  // 완료·비정상 종료)는 아래 우리 코드가 따로 남기므로 여기서 info로 올릴 것이 없다.
  const emit = (chunk, stream) =>
    chunk
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((raw) => {
        const line = scrubBgutilLine(raw);
        if (stream === "err") {
          if (/could not listen|EADDRINUSE|^\s+at /i.test(line)) log.error({ sub: "bgutil" }, line);
          else log.warn({ sub: "bgutil" }, line);
        } else {
          log.debug({ sub: "bgutil" }, line);
        }
      });
  bgutilProc.stdout.on("data", (d) => emit(d, "out"));
  bgutilProc.stderr.on("data", (d) => emit(d, "err"));
  bgutilProc.on("exit", (code) => {
    bgutilProc = null;
    if (!bgutilStopping) {
      log.warn({ sub: "bgutil" }, `서버 비정상 종료 (code=${code}), 5초 후 재시작합니다`);
      setTimeout(startBgutilServer, 5000);
    }
  });
  log.debug({ sub: "bgutil" }, "POToken 서버 시작");
}

function stopBgutilServer() {
  bgutilStopping = true;
  if (bgutilProc) {
    bgutilProc.kill("SIGTERM");
    bgutilProc = null;
  }
}

// bgutil 서버가 /ping에 응답할 때까지 대기 (최대 timeoutMs) - provider 비활성이면 즉시 통과, 시간 초과 시 경고만
async function waitForBgutilReady(timeoutMs = 30000) {
  if (!bgutilProc) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${BGUTIL_PORT}/ping`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        log.info({ sub: "bgutil" }, `POToken 서버 준비 완료 (포트 ${BGUTIL_PORT})`);
        return true;
      }
    } catch {
      /* 아직 준비 안 됨. 재시도 */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  log.warn({ sub: "bgutil" }, `${timeoutMs / 1000}초 내 응답 없음: POToken 없이 봇을 기동합니다.`);
  return false;
}

module.exports = { startBgutilServer, stopBgutilServer, waitForBgutilReady, scrubBgutilLine, BGUTIL_PORT };
