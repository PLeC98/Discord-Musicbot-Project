"use strict";

const youtubedl = require("youtube-dl-exec");
const procRegistry = require("./infra/processRegistry");

const IS_WIN = process.platform === "win32";

// POSIX: 자체 프로세스 그룹으로 띄워야 yt-dlp가 spawn한 ffmpeg까지 한 번에 정리된다.
// Windows: taskkill /T가 트리를 처리하므로 detached는 콘솔 분리 부작용만 남긴다.
const SPAWN_OPTS = IS_WIN ? {} : { detached: true };

/**
 * youtube-dl-exec의 드롭인 대체. 반환·예외 계약은 원본과 같다(성공 시 JSON이나 문자열, 실패 시 stderr를 담은 Error).
 * 원본은 Promise만 돌려줘 pid를 잡을 수 없어서, pid가 나오는 `.exec()`로 우회해 레지스트리에 등록한다.
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
    // 호출부가 볼 수 있게 얹어 준다. 열거 불가라 직렬화·스프레드에는 안 섞인다.
    if (stderr && out && typeof out === "object") Object.defineProperty(out, "_stderr", { value: stderr, enumerable: false });
    return out;
  } catch (error) {
    // tinyspawn의 오류를 youtube-dl-exec와 같은 모양(message = stderr)으로 맞춘다.
    // spawn 자체가 실패하면(ENOENT 등) stderr가 없으므로 원래 message를 쓴다.
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
