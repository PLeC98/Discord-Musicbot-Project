import youtubedl from "youtube-dl-exec";
import type { Flags } from "youtube-dl-exec";
import type { SpawnOptions } from "child_process";
import * as procRegistry from "../infra/process-registry.ts";
import { currentJob } from "../infra/guild-context.ts";
import * as errors from "./youtube/errors.ts";
import { ytdlpBinary } from "./ytdlp-binary.ts";

const IS_WIN = process.platform === "win32";

// POSIX: 자체 프로세스 그룹으로 실행해야 yt-dlp가 spawn한 ffmpeg까지 한 번에 정리된다.
// Windows: taskkill /T가 트리를 처리하므로 detached는 콘솔 분리 부작용만 남긴다.
const SPAWN_OPTS = IS_WIN ? {} : { detached: true };

/** yt-dlp 플래그(camelCase). 라이브러리 타입에 없는 것 중 우리가 쓰는 필드를 더한다 */
type YtDlpFlags = Flags & { cookiesFromBrowser?: string; extractorArgs?: string; pluginDirs?: string; fragmentRetries?: number; concurrentFragments?: number };

/** yt-dlp 가 실패했을 때 던지는 것. message 는 stderr 와 같고, 어떤 실패인지 code 로 구분해 붙인다 */
type YtDlpError = Error & { stderr?: string; stdout?: string; exitCode?: number; code?: string };

// 라이브러리가 내보내지만 타입에는 없는 것
const { isJSON } = youtubedl as typeof youtubedl & { isJSON(text: string): boolean };

/** yt-dlp 프로세스를 실행하는 것(라이브러리의 exec). 약속은 stdout · stderr 를 준다 */
type Exec = typeof youtubedl.exec;
// 테스트는 useExec 로 가짜를 넘긴다(기본은 진짜). 응답 · 오류 모양 맞추기는 그대로 돈다
let fake: Exec | null = null;
function useExec(exec: Exec | null) {
  fake = exec;
}

// 파일로 다운로드하지 않는 호출(정보 · 검색 · 재생목록 · 스트림 주소)의 한도. 멈춘 yt-dlp 가 곡 넣기를 끝없이 붙잡지 않게 넘으면 내린다.
// 곡 넣기 하나가 yt-dlp 를 여러 번 불러도 운영 로그(25일)에서 길어야 54초였다. 다운로드는 곡 길이만큼 걸려 걸지 않는다
const INFO_TIMEOUT_MS = 90_000;
let infoTimeoutMs = INFO_TIMEOUT_MS;
/** 테스트가 한도를 줄인다. null 이면 원래대로 */
function useInfoTimeout(ms: number | null) {
  infoTimeoutMs = ms ?? INFO_TIMEOUT_MS;
}

// 실행할 때마다 지금 버전의 경로를 묻는다. 버전이 바뀌면(ytdlpBinary) 다음 호출부터 새 버전이 실행되고, 돌고 있던 것은 옛 버전으로 끝난다
let bound: { file: string; exec: Exec } | null = null;
function execNow(): Exec {
  if (fake) return fake;
  const file = ytdlpBinary.path();
  if (bound?.file !== file) bound = { file, exec: youtubedl.create(file).exec };
  return bound.exec;
}

/**
 * youtube-dl-exec의 드롭인 대체. 반환·예외 계약은 원본과 같다(성공 시 JSON이나 문자열, 실패 시 stderr를 담은 Error).
 * 원본은 Promise만 돌려줘 pid를 잡을 수 없어서, pid가 나오는 `.exec()`로 우회해 레지스트리에 등록한다.
 * yt-dlp 는 이것으로만 부른다. youtube-dl-exec 를 바로 부르면 실행한 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
 *
 * @param {string} url
 * @param {object} flags yt-dlp 플래그(camelCase)
 * @param {object} opts child_process.spawn 옵션
 */
async function run(url: string, flags: YtDlpFlags = {}, opts: SpawnOptions = {}): Promise<unknown> {
  const sub = execNow()(url, flags, { ...SPAWN_OPTS, ...opts });
  // 일은 문맥에서(다음 곡 미리 다운로드), 없으면 파일로 다운로드하는 것은 재생, 나머지는 곡 찾기
  const release = procRegistry.register(sub, "yt-dlp", { group: !IS_WIN, job: currentJob() ?? (flags.output ? "play" : "lookup") });
  let timedOut = false;
  const limit = flags.output
    ? undefined
    : setTimeout(() => {
        timedOut = true;
        procRegistry.kill(sub);
      }, infoTimeoutMs);
  try {
    const { stdout, stderr } = await sub;
    const out: unknown = isJSON(stdout) ? JSON.parse(stdout) : stdout;
    // 성공해도 stderr에 경고가 실려 온다("이 클라이언트는 POToken이 필요하다" 등).
    // 호출부가 볼 수 있게 얹어 준다. 열거 불가라 직렬화·스프레드에는 안 섞인다.
    if (stderr && out && typeof out === "object") Object.defineProperty(out, "_stderr", { value: stderr, enumerable: false });
    return out;
  } catch (error) {
    // 한도에서 내렸다. 플랫폼이 답하지 않은 것으로 보고 다른 클라이언트로 다시 묻지 않는다(stderr 를 싣지 않아 클라이언트 탓으로 읽히지 않는다)
    if (timedOut) throw Object.assign(new Error(`yt-dlp 가 ${infoTimeoutMs / 1000}초 안에 끝나지 않아 내렸습니다`), { code: "network-error" }) satisfies YtDlpError;
    // tinyspawn의 오류를 youtube-dl-exec와 같은 모양(message = stderr)으로 맞춘다.
    // spawn 자체가 실패하면(ENOENT 등) stderr가 없으므로 원래 message를 쓴다.
    // 어떤 실패인지는 여기서 한 번 구분해 code 로 붙인다. 부르는 쪽은 글이 아니라 code 를 본다.
    const failed = error as { stderr?: string; stdout?: string; exitCode?: number; message?: string; code?: string };
    const shaped: YtDlpError = Object.assign(new Error(failed.stderr || failed.message), {
      stderr: failed.stderr,
      stdout: failed.stdout,
      exitCode: failed.exitCode,
    });
    shaped.code = errors.codeOf(shaped) || failed.code;
    throw shaped;
  } finally {
    clearTimeout(limit);
    release();
  }
}

export default run;
export { useExec, useInfoTimeout };
/** yt-dlp 실행 함수. 테스트가 가짜를 넘기는 곳의 모양 */
type RunYtDlp = typeof run;
export type { YtDlpFlags, YtDlpError, RunYtDlp, Exec };
