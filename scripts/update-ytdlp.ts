/**
 * yt-dlp 를 목표 버전으로 맞춘다. 목표는 유튜브 탭의 yt-dlp 카드가 정한 채널과 고정(설정 DB)이고, 설정 DB 가 없으면(첫 설치) 기본값이다.
 * 실제 처리는 src/sources/ytdlp-binary.ts 가 한다.
 *
 * 설치 뒤(postinstall): 깔려 있으면 그대로 두고, 없으면 목표 버전을 설치한다. 실패해도 설치를 깨지 않는다(봇 기동이 다시 해 본다).
 * 사람이 부르면(update:ytdlp): 모드와 상관없이 목표 버전으로 다운로드하고, 실패하면 1 로 끝난다.
 *   설정 DB 가 있는데 읽지 못하면 다운로드하지 않고 1 로 끝난다(저장해 둔 고정을 무시하고 채널의 최신을 다운로드하지 않게).
 * --skip-signature: 이 실행에서만 yt-dlp 릴리스의 서명 확인을 건너뛴다(체크섬은 본다). yt-dlp 가 서명 키를 바꿨고 그것을 확인했을 때만 쓴다.
 * 봇 모듈을 부르면 로거가 콘솔을 가로채므로 콘솔이 아니라 로거로 남긴다(봇과 같은 모양).
 */
import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env 를 읽는다(없으면 만든다)
import path from "node:path";
import logger from "../src/infra/log/logger.ts";
import { PROJECT } from "../src/infra/project-paths.ts";
import { ytdlpBinary, describe } from "../src/sources/ytdlp-binary.ts";
import { messageOf } from "../src/rules/error-kind.ts";

const postinstall = process.env.npm_lifecycle_event === "postinstall";
// pnpm 이 -- 를 넘겨도 맞게 인자 어디에 있든 본다
const skipSignature = process.argv.includes("--skip-signature");

const log = logger.child({ category: "ytdlp" });
const say = (level: "info" | "warn", line: string) => log[level](line);

// 설정 DB 의 채널, 고정을 설정 객체에 올린다. 읽지 못했으면 false.
// 설정 DB 모듈은 여기서 불러온다. 설치 뒤 스크립트(postinstall)에서 그 모듈(네이티브)을 불러오지 못해도 기본값으로 yt-dlp 설치를 계속한다
async function loadTarget(): Promise<boolean> {
  try {
    const tunables = await import("../src/store/tunables.ts");
    tunables.loadReadOnly(path.join(PROJECT.database, "settings.db"), { strict: true });
    return true;
  } catch (error) {
    say("warn", `설정 DB에서 yt-dlp 설정을 읽지 못했습니다: ${messageOf(error)}`);
    return false;
  }
}

try {
  if (skipSignature) say("warn", "이번 실행은 yt-dlp 릴리스의 서명을 확인하지 않습니다(--skip-signature, 체크섬은 확인)");
  const loaded = await loadTarget();
  if (!loaded && !postinstall) throw new Error("설정 DB(database/settings.db)에서 채널과 버전 고정을 읽지 못해 다운로드하지 않습니다");
  if (!loaded) say("warn", "yt-dlp가 없으면 기본 채널의 최신 버전을 설치합니다");
  const { version, outcome: first } = await ytdlpBinary.prepare({ force: true, skipSignature });
  const outcome = first ?? (postinstall ? null : await ytdlpBinary.check({ force: true, skipSignature }));
  if (!outcome) say("info", `설치된 yt-dlp를 그대로 씁니다(${version ?? "없음"})`);
  else {
    const { level, line } = describe(outcome);
    say(level, line);
    if ((outcome.kind === "installed" || outcome.kind === "reused") && outcome.from && !postinstall) say("info", "실행 중인 봇은 다음 yt-dlp 실행부터 바뀐 버전을 씁니다");
    if (level === "warn" && !postinstall) process.exitCode = 1;
  }
} catch (error) {
  say("warn", `버전을 맞추지 못했습니다: ${messageOf(error)}`);
  if (!postinstall) process.exitCode = 1;
}
