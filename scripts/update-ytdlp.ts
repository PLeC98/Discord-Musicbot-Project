/**
 * yt-dlp 를 목표 버전(.env 의 YTDLP_CHANNEL · YTDLP_VERSION)으로 맞춘다. 일은 src/sources/ytdlp-binary.ts 가 한다.
 *
 * 설치 뒤(postinstall): YTDLP_UPDATE=off 면 설치 때 다운로드한 것을 옮겨 두기만 한다. 실패해도 설치를 깨지 않는다.
 * 사람이 부르면(update:ytdlp): YTDLP_UPDATE 와 상관없이 목표 버전으로 다운로드하고, 실패하면 1 로 끝난다.
 * 봇 모듈을 부르면 로거가 콘솔을 가로채므로 콘솔이 아니라 로거로 남긴다(봇과 같은 모양).
 */
import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env 를 읽는다(없으면 만든다)
import config from "../src/config/index.ts";
import logger from "../src/infra/log/logger.ts";
import { ytdlpBinary, describe } from "../src/sources/ytdlp-binary.ts";
import { messageOf } from "../src/rules/error-kind.ts";

const postinstall = process.env.npm_lifecycle_event === "postinstall";

const log = logger.child({ category: "ytdlp" });
const say = (level: "info" | "warn", line: string) => log[level](line);

try {
  const { version, seeded } = await ytdlpBinary.prepare();
  if (seeded) say("info", `설치 때 다운로드한 버전을 vendor/bin/yt-dlp 로 옮겼습니다(${version})`);
  if (postinstall && config.ytdlp.update === "off") {
    say("info", `지금 버전을 씁니다(${version}, YTDLP_UPDATE=off)`);
  } else {
    const outcome = (await ytdlpBinary.check({ force: true }))!;
    const { level, line } = describe(outcome);
    say(level, line);
    if ((outcome.kind === "installed" || outcome.kind === "reused") && !postinstall) say("info", "돌고 있는 봇은 다음 확인(하루 안) 때나 다시 시작할 때 새 버전을 씁니다");
    if (level === "warn" && !postinstall) process.exitCode = 1;
  }
} catch (error) {
  say("warn", `버전을 맞추지 못했습니다: ${messageOf(error)}`);
  if (!postinstall) process.exitCode = 1;
}
