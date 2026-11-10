/**
 * yt-dlp 를 목표 버전(.env 의 YTDLP_CHANNEL, YTDLP_VERSION)으로 맞춘다. 실제 처리는 src/sources/ytdlp-binary.ts 가 한다.
 *
 * 설치가 안 돼 있으면 설정과 상관없이 목표 버전을 설치한다(네트워크).
 * 설치 뒤(postinstall): 이미 설치돼 있고 YTDLP_UPDATE=off 면 그대로 둔다. 실패해도 설치를 깨지 않는다(봇 기동이 다시 해 본다).
 * 사람이 부르면(update:ytdlp): YTDLP_UPDATE 와 상관없이 목표 버전으로 다운로드하고, 실패하면 1 로 끝난다.
 * --skip-signature: 이 실행에서만 yt-dlp 릴리스의 서명 확인을 건너뛴다(체크섬은 본다). yt-dlp 가 서명 키를 바꿨고 그것을 확인했을 때만 쓴다.
 * 봇 모듈을 부르면 로거가 콘솔을 가로채므로 콘솔이 아니라 로거로 남긴다(봇과 같은 모양).
 */
import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env 를 읽는다(없으면 만든다)
import config from "../src/config/index.ts";
import logger from "../src/infra/log/logger.ts";
import { ytdlpBinary, describe } from "../src/sources/ytdlp-binary.ts";
import { messageOf } from "../src/rules/error-kind.ts";

const postinstall = process.env.npm_lifecycle_event === "postinstall";
// pnpm 이 -- 를 넘겨도 맞게 인자 어디에 있든 본다
const skipSignature = process.argv.includes("--skip-signature");

const log = logger.child({ category: "ytdlp" });
const say = (level: "info" | "warn", line: string) => log[level](line);

try {
  if (skipSignature) say("warn", "이번 실행은 yt-dlp 릴리스의 서명을 확인하지 않습니다(--skip-signature, 체크섬은 확인)");
  const { version, outcome: first } = await ytdlpBinary.prepare({ force: true, skipSignature });
  const outcome = first ?? (postinstall && config.ytdlp.update === "off" ? null : await ytdlpBinary.check({ force: true, skipSignature }));
  if (!outcome) say("info", `지금 버전을 씁니다(${version ?? "없음"}, YTDLP_UPDATE=off)`);
  else {
    const { level, line } = describe(outcome);
    say(level, line);
    if ((outcome.kind === "installed" || outcome.kind === "reused") && outcome.from && !postinstall) say("info", "돌고 있는 봇은 다음 확인(하루 안) 때나 다시 시작할 때 새 버전을 씁니다");
    if (level === "warn" && !postinstall) process.exitCode = 1;
  }
} catch (error) {
  say("warn", `버전을 맞추지 못했습니다: ${messageOf(error)}`);
  if (!postinstall) process.exitCode = 1;
}
