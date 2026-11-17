/**
 * yt-dlp를 목표 버전으로 맞춘다. 목표는 업데이트 탭의 yt-dlp 카드가 정한 채널과 고정(설정 DB)이고, 설정 DB가 없으면(첫 설치) 기본값이다.
 * 실제 처리는 src/sources/ytdlp-binary.ts가 한다. 대시보드를 쓸 수 없을 때(봇이 켜지지 않음, 새 버전 때문에 추출이 깨짐)를 위한 길이다.
 *
 * 설치 뒤(postinstall): 깔려 있으면 그대로 두고, 없으면 목표 버전을 설치한다. 실패해도 설치를 깨지 않는다(봇 기동이 재시도한다).
 * 직접 실행하면(update:ytdlp): 모드와 상관없이 목표 버전으로 다운로드하고, 실패하면 1로 끝난다.
 *   설정 DB가 있는데 읽지 못하면 다운로드하지 않고 1로 끝난다(저장해 둔 고정을 무시하고 채널의 최신을 다운로드하지 않게).
 * --pin <태그>: 그 버전을 받고 고정한다. --unpin: 고정을 풀고 채널의 최신을 받는다(src/sources/ytdlp-cli-args).
 *   받은 뒤에 고정을 저장한다(받지 못하면 설정은 그대로). 봇이 켜져 있으면 하지 않는다: 켜진 봇은 설정을 메모리에 들고 있어
 *   여기서 settings.db를 고쳐도 모르고, 자동 모드면 하루 확인 때 고정을 무른다(그때는 대시보드의 업데이트 탭에서 바꾼다).
 *   그동안 봇 실행 잠금을 쥐어 봇이 켜지지 않게 한다.
 * --skip-signature: 이 실행에서만 yt-dlp 릴리스의 서명 확인을 건너뛴다(체크섬은 본다). yt-dlp가 서명 키를 바꿨고 그것을 확인했을 때만 쓴다.
 * 봇 모듈을 부르면 로거가 콘솔을 가로채므로 콘솔이 아니라 로거로 남긴다(봇과 같은 모양).
 */
import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env를 읽는다(없으면 만든다)
import path from "node:path";
import logger from "../src/infra/log/logger.ts";
import config from "../src/config/index.ts";
import { PROJECT } from "../src/infra/project-paths.ts";
import { acquireInstanceLock } from "../src/infra/instance-lock.ts";
import { ytdlpBinary, describe, type YtdlpOutcome } from "../src/sources/ytdlp-binary.ts";
import { parseUpdateArgs } from "../src/sources/ytdlp-cli-args.ts";
import { messageOf } from "../src/rules/error-kind.ts";

const postinstall = process.env.npm_lifecycle_event === "postinstall";
const SETTINGS_DB = path.join(PROJECT.database, "settings.db");

const log = logger.child({ category: "ytdlp" });
const say = (level: "info" | "warn", line: string) => log[level](line);

// 설정 DB의 채널, 고정을 설정 객체에 올린다. 읽지 못했으면 false.
// 설정 DB 모듈은 여기서 불러온다. 설치 뒤 스크립트(postinstall)에서 그 모듈(네이티브)을 불러오지 못해도 기본값으로 yt-dlp 설치를 계속한다
async function loadTarget(): Promise<boolean> {
  try {
    const tunables = await import("../src/store/tunables.ts");
    tunables.loadReadOnly(SETTINGS_DB, { strict: true });
    return true;
  } catch (error) {
    say("warn", `설정 DB에서 yt-dlp 설정을 읽지 못했습니다: ${messageOf(error)}`);
    return false;
  }
}

// 설정대로(또는 바꾼 고정으로) 맞춘다. 결과 줄을 남기고 맞췄는지 돌려준다
async function converge(skipSignature: boolean): Promise<boolean> {
  const { version, outcome: first } = await ytdlpBinary.prepare({ force: true, skipSignature });
  const outcome: YtdlpOutcome | null = first ?? (postinstall ? null : await ytdlpBinary.check({ force: true, skipSignature }));
  if (!outcome) {
    say("info", `설치된 yt-dlp를 그대로 씁니다(${version ?? "없음"})`);
    return true;
  }
  const { level, line } = describe(outcome);
  say(level, line);
  if ((outcome.kind === "installed" || outcome.kind === "reused") && outcome.from && !postinstall) say("info", "실행 중인 봇은 다음 yt-dlp 실행부터 바뀐 버전을 씁니다");
  return outcome.kind === "installed" || outcome.kind === "reused" || outcome.kind === "current";
}

// --pin, --unpin: 봇이 꺼져 있을 때만. 설정 DB를 쓰기로 열고, 그 고정으로 받은 뒤 저장한다
async function changePin(pin: string | null, skipSignature: boolean): Promise<boolean> {
  const held = await acquireInstanceLock(PROJECT.database);
  if (!held.ok) throw new Error(`봇이 실행 중이라(${held.holder ? `PID ${held.holder}` : "PID 모름"}) 버전 고정을 바꾸지 않습니다. 대시보드 운영자 패널의 업데이트 탭에서 바꾸거나, 봇을 끄고 다시 실행하세요`);
  const { settingsDb } = await import("../src/store/settings-db.ts");
  const tunables = await import("../src/store/tunables.ts");
  try {
    settingsDb.open(SETTINGS_DB);
    tunables.load();
    const was = config.ytdlp.version;
    config.ytdlp.version = pin;
    if (!(await converge(skipSignature))) {
      say("warn", `받지 못해 버전 고정은 그대로 둡니다(${was ?? "없음"})`);
      return false;
    }
    tunables.saveCard({ YTDLP_VERSION: pin });
    say("warn", `터미널에서 yt-dlp 고정 버전 변경: ${was ?? "없음"} → ${pin ?? "없음"}`);
    return true;
  } finally {
    settingsDb.close();
    await held.release();
  }
}

try {
  const args = parseUpdateArgs(process.argv);
  if ("error" in args) throw new Error(args.error);
  if (args.skipSignature) say("warn", "이번 실행은 yt-dlp 릴리스의 서명을 확인하지 않습니다(--skip-signature, 체크섬은 확인)");
  if (args.pin !== undefined && !postinstall) {
    if (!(await changePin(args.pin, args.skipSignature))) process.exitCode = 1;
  } else {
    const loaded = await loadTarget();
    if (!loaded && !postinstall) throw new Error("설정 DB(database/settings.db)에서 채널과 버전 고정을 읽지 못해 다운로드하지 않습니다");
    if (!loaded) say("warn", "yt-dlp가 없으면 기본 채널의 최신 버전을 설치합니다");
    if (!(await converge(args.skipSignature)) && !postinstall) process.exitCode = 1;
  }
} catch (error) {
  say("warn", `버전을 맞추지 못했습니다: ${messageOf(error)}`);
  if (!postinstall) process.exitCode = 1;
}
