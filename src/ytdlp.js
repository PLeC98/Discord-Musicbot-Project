"use strict";

const youtubedl = require("youtube-dl-exec");
const procRegistry = require("./ChildProcessRegistry");

const IS_WIN = process.platform === "win32";

// POSIX: 자체 프로세스 그룹으로 띄워야 yt-dlp가 spawn한 ffmpeg(손자)까지 한 번에 정리할 수 있다.
//        (SIGTERM은 원래 자식에게 전달되지 않으므로 그룹킬 외엔 방법이 없다.)
// Windows: taskkill /T가 트리를 처리하므로 detached는 불필요 — 콘솔 분리 부작용만 남는다.
const SPAWN_OPTS = IS_WIN ? {} : { detached: true };

/**
 * youtube-dl-exec의 드롭인 대체.
 *
 * 호출 계약은 원본과 동일하게 유지한다 — 성공 시 JSON(또는 문자열), 실패 시 stderr를 담은 Error.
 * (YouTube.isAgeRestrictedError / isVideoUnavailableError가 error.stderr를 읽는다.)
 *
 * 원본 `youtubedl(url, flags)`는 Promise만 돌려줘 pid를 잡을 수 없다. 그래서 pid를 노출하는
 * `.exec()`로 우회해 ChildProcessRegistry에 등록하고, 봇 종료 시 자손까지 확실히 정리한다.
 *
 * @param {string} url
 * @param {object} flags yt-dlp 플래그(camelCase)
 * @param {object} opts child_process.spawn 옵션
 */
async function run(url, flags = {}, opts = {}) {
  const sub = youtubedl.exec(url, flags, { ...SPAWN_OPTS, ...opts });
  const release = procRegistry.register(sub, "yt-dlp", { group: !IS_WIN });
  try {
    const { stdout, stderr } = await sub;
    const out = youtubedl.isJSON(stdout) ? JSON.parse(stdout) : stdout;
    // 성공해도 stderr에 경고가 실려 온다("이 클라이언트는 POToken이 필요하다" 등).
    // 지금까지는 여기서 버려져 아무도 못 봤다. 호출부가 훑을 수 있게 얹어 준다 —
    // 객체면 속성으로(열거 불가라 JSON 직렬화·스프레드에 안 섞인다), 문자열이면 못 얹으므로 포기.
    if (stderr && out && typeof out === "object") Object.defineProperty(out, "_stderr", { value: stderr, enumerable: false });
    return out;
  } catch (error) {
    // tinyspawn의 ChildProcessError를 youtube-dl-exec와 같은 모양(message = stderr)으로 정규화.
    // spawn 자체가 실패한 경우(ENOENT 등)는 stderr가 없으므로 원래 message를 쓴다.
    throw Object.assign(new Error(error.stderr || error.message), {
      stderr: error.stderr,
      stdout: error.stdout,
      exitCode: error.exitCode,
    });
  } finally {
    release();
  }
}

module.exports = run;
