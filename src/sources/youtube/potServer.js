// bgutil POToken 서버. 유튜브가 요구하는 토큰을 만들어 주는 로컬 HTTP 서버를 띄우고 지킨다.
// 조립(index.js)이 하나 만들어 기동 때 띄우고 종료 때 내린다.

import childProcess from "child_process";
import fs from "fs";
import path from "path";
import logger from "../../infra/log/logger.js";
const log = logger.child({ category: "core" });
import config from "../../../config.js";

const SERVER_DIR = path.join(import.meta.dirname, "..", "..", "..", "bgutil-ytdlp-pot-provider", "server");
const ENTRY = path.join(SERVER_DIR, "build", "main.js");
const PORT = 4416; // bgutil 서버 기본 포트 (yt-dlp 플러그인 기본값과 동일)
const RESTART_MS = 5000; // 비정상 종료 뒤 다시 띄우기까지

// bgutil이 발급한 토큰을 그대로 로그에 남기지 않는다. 세션 자격증명이다.
// (sink의 레드액션은 access_token 계열 이름만 알아서 poToken은 그냥 통과한다.)
function scrubBgutilLine(line) {
  return String(line)
    .replace(/(Generated IntegrityToken:\s*).*/i, "$1[REDACTED]")
    .replace(/((?:poToken|integrityToken)"?\s*[:=]\s*"?)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]");
}

// 남의 프로세스라 레벨을 직접 붙일 수 없다. 스트림(stdout/stderr)과 문구로 가른다.
// bgutil의 stdout은 전량 요청 단위 상세(POT 생성·챌린지)라 debug로 내린다. 수명주기(시작·준비
// 완료·비정상 종료)는 아래 우리 코드가 따로 남기므로 여기서 info로 올릴 것이 없다.
function relay(chunk, stream) {
  for (const raw of chunk.toString().split("\n").filter(Boolean)) {
    const line = scrubBgutilLine(raw);
    if (stream === "out") log.debug({ sub: "bgutil" }, line);
    else if (/could not listen|EADDRINUSE|^\s+at /i.test(line)) log.error({ sub: "bgutil" }, line);
    else log.warn({ sub: "bgutil" }, line);
  }
}

/**
 * spawn · exists · fetch: 바깥 경계. 생략하면 진짜
 */
function createPotServer({ spawn = childProcess.spawn, exists = fs.existsSync, fetch = (url, init) => globalThis.fetch(url, init) } = {}) {
  let proc = null;
  let stopping = false;

  function start() {
    if (stopping) return;
    const installed = exists(ENTRY);

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
    proc = spawn(process.execPath, ["build/main.js"], { cwd: SERVER_DIR, stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (d) => relay(d, "out"));
    proc.stderr.on("data", (d) => relay(d, "err"));
    proc.on("exit", (code) => {
      proc = null;
      if (stopping) return;
      log.warn({ sub: "bgutil" }, `서버 비정상 종료 (code=${code}), 5초 후 재시작합니다`);
      setTimeout(start, RESTART_MS);
    });
    log.debug({ sub: "bgutil" }, "POToken 서버 시작");
  }

  function stop() {
    stopping = true;
    if (proc) {
      proc.kill("SIGTERM");
      proc = null;
    }
  }

  // /ping 에 응답할 때까지 기다린다(최대 timeoutMs). 띄운 것이 없으면 바로 통과, 시간을 넘기면 경고만
  async function waitReady(timeoutMs = 30000) {
    if (!proc) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/ping`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          log.info({ sub: "bgutil" }, `POToken 서버 준비 완료 (포트 ${PORT})`);
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

  return { start, stop, waitReady };
}

const exported = { createPotServer, scrubBgutilLine, PORT };
export default exported;
export { exported as "module.exports" };
