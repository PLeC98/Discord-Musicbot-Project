/**
 * ffmpeg를 목표 릴리스에 맞춘다. BtbN/FFmpeg-Builds의 빌드를 받아 vendor/ffmpeg/의 버전 폴더에 두고 state.json이 가리키게 한다(media/ffmpeg/install).
 * 봇은 기동 때 인자 없이 이 스크립트를 자식 프로세스로 실행한다. 직접 실행하는 것은 버전을 고정하거나 풀 때, 받은 것을 다시 받을 때다.
 *   pnpm run install:ffmpeg                 고정(없으면 코드의 기본값)으로 맞춘다
 *   pnpm run install:ffmpeg --pin <릴리스>  그 릴리스로 맞추고 성공하면 고정한다
 *   pnpm run install:ffmpeg --unpin         고정을 풀고 기본값으로 맞춘다
 *   --force                                 이미 있어도, 물린 릴리스여도 새로 받는다
 * .env의 FFMPEG_PATH를 쓰는 동안은 무엇도 받지 않는다(봇이 그것만 쓴다).
 *
 * 가리키는 빌드가 바뀌지 않는 autobuild 태그만 받는다(`latest`는 이름이 같은 채로 내용물이 바뀐다). 기본값은 src/config/vendor-versions.ts의 월말 빌드다.
 * macOS와 지원하지 않는 아키텍처는 BtbN이 빌드를 제공하지 않아 건너뛴다. PATH의 ffmpeg나 .env의 FFMPEG_PATH를 쓴다.
 * 태그 목록: https://github.com/BtbN/FFmpeg-Builds/releases
 */
import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env를 읽는다(없으면 만든다)
import config from "../src/config/index.ts";
import { toolEnv } from "../src/config/tool-env.ts";
import { FFMPEG_RELEASE } from "../src/config/vendor-versions.ts";
import { acquireInstanceLock } from "../src/infra/instance-lock.ts";
import { PROJECT } from "../src/infra/project-paths.ts";
import { runTool } from "../src/infra/tool-run.ts";
import { messageOf } from "../src/rules/error-kind.ts";
import { TARGETS } from "../src/media/ffmpeg/release.ts";
import { alignFfmpeg, type AlignOutcome, type InstallIo, type Probe } from "../src/media/ffmpeg/install.ts";
import { parseInstallArgs } from "../src/media/ffmpeg/cli-args.ts";
import { download } from "./download.ts";
import { scriptLine } from "../src/infra/script-line.ts";
import { asText } from "../src/infra/log/log-text.ts";
import { josa } from "../src/infra/josa.ts";
import path from "node:path";

const say = scriptLine("ffmpeg");

// 명령마다의 시간 상한(ms): tar 한 번, 다운로드한 ffmpeg의 실행 확인(백신이 처음 보는 실행 파일을 검사하느라 늦을 수 있다)
const TAR_MS = 2 * 60_000;
const PROBE_MS = 30_000;
// 외부 도구(tar, 다운로드한 ffmpeg)에는 봇의 비밀값 환경 변수를 뺀 환경을 넘긴다
const env = toolEnv();

/**
 * 아카이브를 읽을 수 있는 tar 후보들.
 * 윈도우는 System32의 bsdtar를 먼저 본다. zip은 bsdtar만 풀 수 있고, PATH에 Git Bash 등의 GNU tar가 앞서 있으면 그쪽이 잡혀 실패한다. 리눅스는 PATH의 tar면 된다(.tar.xz는 xz 필요).
 */
function tarCandidates() {
  const candidates = [];
  if (process.platform === "win32" && process.env.SystemRoot) candidates.push(path.join(process.env.SystemRoot, "System32", "tar.exe"));
  candidates.push("tar");
  return candidates;
}

/**
 * 아카이브에서 ffmpeg 실행 파일 하나만 꺼낸다.
 * 경로는 전부 상대 경로로 넘기고 cwd로 위치를 잡는다. GNU tar는 `-f C:\...`의 콜론을 원격 호스트 지정으로 해석해 실패한다.
 */
async function extractBinary(archiveName: string, binName: string, cwd: string) {
  const errors: string[] = [];
  for (const tar of tarCandidates()) {
    const run = (args: string[]) => runTool(tar, args, { cwd, env, label: tar, timeoutMs: TAR_MS, capture: true });
    let listed: string;
    try {
      listed = await run(["-tf", archiveName]);
    } catch (error) {
      errors.push(messageOf(error).split("\n")[0] ?? "");
      continue;
    }
    const member = listed.split(/\r?\n/).find((entry) => entry.endsWith(`/bin/${binName}`));
    if (!member) throw new Error(`아카이브에서 bin/${binName}을 찾지 못했습니다`);
    await run(["-xf", archiveName, member]);
    return path.join(cwd, member);
  }
  throw new Error(`아카이브를 열 수 있는 tar가 없습니다 (.tar.xz는 xz-utils 필요)\n  ${errors.join("\n  ")}`);
}

async function probe(file: string): Promise<Probe> {
  try {
    const out = await runTool(file, ["-version"], { env, label: "ffmpeg -version", timeoutMs: PROBE_MS, capture: true });
    const version = /ffmpeg version (\S+)/i.exec(out)?.[1];
    return version ? { ok: true, version } : { ok: false, reason: "버전을 읽지 못함" };
  } catch (error) {
    return { ok: false, reason: messageOf(error).split("\n")[0] ?? "" };
  }
}

const io: InstallIo = {
  key: `${process.platform}-${process.arch}`,
  fetchText: async (url) => {
    try {
      return (await download(url)).toString("utf8");
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
  },
  fetchFile: (url) => download(url),
  extract: extractBinary,
  probe,
  now: () => Date.now(),
  pid: process.pid,
};

/**
 * 이 폴더의 봇. none: 꺼져 있다, parent: 이 스크립트를 띄운 봇이다(기동 때 맞추기), other: 따로 켜져 있다(PID를 모르면 이것으로 본다).
 * 봇은 실행 잠금을 쥔 채로 이 스크립트를 셸 없이 직접 띄우므로 잠금을 쥔 프로세스가 부모면 그 봇이다
 */
async function botNow(): Promise<"none" | "parent" | "other"> {
  const held = await acquireInstanceLock(PROJECT.database);
  if (held.ok) {
    await held.release();
    return "none";
  }
  return held.holder === process.ppid ? "parent" : "other";
}

function report(outcome: AlignOutcome, bot: "none" | "parent" | "other"): number {
  for (const note of outcome.notes) say("warn", note);
  // 따로 켜져 있는 봇은 기동 때 정한 ffmpeg를 계속 쓴다
  const restart = () => bot === "other" && say("warn", "켜져 있는 봇을 다시 시작하세요(다시 시작해야 새 버전 적용)");
  switch (outcome.kind) {
    case "unchanged":
      say("info", `이미 ${outcome.release}(${outcome.version}) 사용 중`);
      return 0;
    case "switched":
      say("info", `받아 둔 ${outcome.release}(${outcome.version})${josa(outcome.version, "으로")} 교체`);
      restart();
      return 0;
    case "installed":
      say("info", `${outcome.release}(${outcome.version}) 설치 완료${outcome.from ? `(이전 ${outcome.from})` : ""}`);
      restart();
      return 0;
    case "skipped":
      say("warn", `${outcome.release}: 이 환경에서 실행되지 않았던 릴리스라 받지 않음. 다시 받으려면 pnpm run install:ffmpeg --force로 실행하세요`);
      return 1;
    case "failed":
      say("error", `${outcome.release} 설치 실패(지금 쓰는 ffmpeg 그대로): ${asText(outcome.reason)}`);
      return 1;
    case "busy":
      say("error", `설치 건너뜀: 다른 프로세스(${outcome.holder ? `PID ${outcome.holder}` : "PID 모름"})가 vendor/ffmpeg 사용 중`);
      return 1;
  }
}

async function main(): Promise<number> {
  const args = parseInstallArgs(process.argv.slice(2));
  if ("error" in args) {
    say("error", args.error);
    return 1;
  }
  const bot = await botNow();
  // 고정은 다음 기동부터 쓰인다. 켜진 봇은 기동 때 정한 ffmpeg를 그대로 써서 고정을 바꿔도 알 수 없다
  if (args.pin !== undefined && bot !== "none") {
    say("error", "봇이 실행 중이라 버전 고정 안 함. 봇을 끄고 다시 실행하세요");
    return 1;
  }
  // 봇은 FFMPEG_PATH가 있으면 그것만 쓰므로 받아도 쓰이지 않는다. 비우면 다음 기동이 받는다
  if (config.ffmpeg.path) {
    say("info", `.env의 FFMPEG_PATH(${config.ffmpeg.path}) 사용 중이라 받지 않음. 받은 ffmpeg를 쓰려면 .env의 FFMPEG_PATH를 비우세요`);
    return 0;
  }
  if (!TARGETS[io.key]) {
    say("info", `${io.key}용 빌드 없음. ffmpeg를 직접 설치해 PATH에 두거나 .env의 FFMPEG_PATH로 지정하세요${process.platform === "darwin" ? "(brew install ffmpeg)" : ""}`);
    return 0;
  }
  const outcome = await alignFfmpeg({ dir: PROJECT.ffmpeg, defaultRelease: FFMPEG_RELEASE, pin: args.pin, force: args.force, io });
  const code = report(outcome, bot);
  if (code === 0 && args.pin !== undefined) say("info", args.pin ? `${args.pin} 릴리스로 고정(기본값 ${FFMPEG_RELEASE}). 풀려면 --unpin` : `고정 해제(기본값 ${FFMPEG_RELEASE})`);
  return code;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // fetch는 네트워크 오류를 "fetch failed" 하나로 내고 원인을 cause에 싣는다
    const cause = (error as { cause?: unknown }).cause;
    say("error", `설치 실패(지금 쓰는 ffmpeg 그대로): ${messageOf(error)}${cause ? `(${messageOf(cause)})` : ""}`);
    process.exit(1);
  },
);
