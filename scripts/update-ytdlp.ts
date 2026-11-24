/**
 * yt-dlp를 목표 버전으로 맞춘다. 목표는 업데이트 탭의 yt-dlp 카드가 정한 채널과 고정(설정 DB)이고, 설정 DB가 없으면(첫 설치) 기본값이다.
 * 실제 처리는 src/sources/ytdlp-binary.ts가 한다. 대시보드를 쓸 수 없을 때(봇이 켜지지 않음, 새 버전 때문에 추출이 깨짐)를 위한 길이다.
 *
 * 모드와 상관없이 목표 버전으로 다운로드하고, 실패하면 종료 코드 1로 끝난다. 처음 설치는 봇이 기동할 때 한다(없으면 받는다).
 *   설정 DB가 있는데 읽지 못하면 다운로드하지 않고 1로 끝난다(저장해 둔 고정을 무시하고 채널의 최신을 다운로드하지 않게).
 * --pin <태그>: 그 버전을 받고 고정한다. --unpin: 고정을 풀고 채널의 최신을 받는다. --channel <채널>: 채널을 바꾸고 그 채널로 받는다(src/sources/ytdlp-cli-args).
 *   받은 뒤에 고정과 채널을 저장한다(받지 못하면 설정은 그대로). 봇이 켜져 있으면 하지 않는다: 켜진 봇은 설정을 메모리에 들고 있어
 *   여기서 settings.db를 고쳐도 모르고, 자동 모드면 일일 확인 때 고정을 무른다(그때는 대시보드의 업데이트 탭에서 바꾼다).
 *   그동안 봇 실행 잠금을 쥐어 봇이 켜지지 않게 한다.
 *   고정이 있는데 채널만 바꾸면 거절한다(고정한 태그는 지금 채널의 릴리스다. 대시보드도 고정 중에는 채널을 바꾸지 못한다). --channel과 --pin, --unpin은 함께 쓴다.
 * --skip-signature: 이 실행에서만 yt-dlp 릴리스의 서명 확인을 건너뛴다(체크섬은 본다). yt-dlp가 서명 키를 바꿨고 그것을 확인했을 때만 쓴다.
 * 봇 모듈을 부르면 로거가 콘솔을 가로채므로 콘솔이 아니라 로거로 남긴다(봇과 같은 모양).
 */
import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env를 읽는다(없으면 만든다)
import path from "node:path";
import logger from "../src/infra/log/logger.ts";
import { asText, logTextError, type LogText } from "../src/infra/log/log-text.ts";
import config from "../src/config/index.ts";
import { PROJECT } from "../src/infra/project-paths.ts";
import { acquireInstanceLock } from "../src/infra/instance-lock.ts";
import { ytdlpBinary, describe, type YtdlpOutcome } from "../src/sources/ytdlp-binary.ts";
import { parseUpdateArgs } from "../src/sources/ytdlp-cli-args.ts";
import type { YtdlpChannelName } from "../src/rules/ytdlp-tag.ts";
import { messageOf } from "../src/rules/error-kind.ts";
import { L } from "../src/infra/log/text.ts";

const SETTINGS_DB = path.join(PROJECT.database, "settings.db");

const log = logger.child({ category: "ytdlp" });
const say = (level: "info" | "warn", line: string | LogText) => log[level](line);

// 설정 DB의 채널과 버전 고정을 설정 객체에 올린다. 읽지 못했으면 false
async function loadTarget(): Promise<boolean> {
  try {
    const tunables = await import("../src/store/tunables.ts");
    tunables.loadReadOnly(SETTINGS_DB, { strict: true });
    return true;
  } catch (error) {
    say("warn", L.ytdlp.settingsUnread({ error: messageOf(error) }));
    return false;
  }
}

// 설정대로(또는 바꾼 고정으로) 맞춘다. 결과 줄을 남기고 맞췄는지 돌려준다
async function converge(skipSignature: boolean): Promise<boolean> {
  const { version, outcome: first } = await ytdlpBinary.prepare({ force: true, skipSignature });
  const outcome: YtdlpOutcome | null = first ?? (await ytdlpBinary.check({ force: true, skipSignature }));
  if (!outcome) {
    say("info", L.ytdlp.installedKept({ version: version ?? null }));
    return true;
  }
  const { level, line } = describe(outcome);
  say(level, line);
  if ((outcome.kind === "installed" || outcome.kind === "reused") && outcome.from) say("info", L.ytdlp.botUsesNextRun());
  return outcome.kind === "installed" || outcome.kind === "reused" || outcome.kind === "current";
}

/** 바꿀 것. pin: undefined면 고정 그대로, channel: undefined면 채널 그대로 */
type Change = { pin: string | null | undefined; channel: YtdlpChannelName | undefined };

// --pin, --unpin, --channel: 봇이 꺼져 있을 때만. 설정 DB를 쓰기로 열고, 바꾼 설정으로 받은 뒤 저장한다
async function changeSettings(change: Change, skipSignature: boolean): Promise<boolean> {
  const held = await acquireInstanceLock(PROJECT.database);
  if (!held.ok) throw logTextError(L.ytdlp.settingsBotRunning({ holder: held.holder }));
  const { settingsDb } = await import("../src/store/settings-db.ts");
  const tunables = await import("../src/store/tunables.ts");
  try {
    settingsDb.open(SETTINGS_DB);
    tunables.load();
    const was = { pin: config.ytdlp.version, channel: config.ytdlp.channel };
    const pin = change.pin === undefined ? was.pin : change.pin;
    const channel = change.channel ?? was.channel;
    if (change.pin === undefined && was.pin && channel !== was.channel) throw logTextError(L.ytdlp.channelChangeWhilePinned({ pin: was.pin }));
    Object.assign(config.ytdlp, { version: pin, channel });
    if (!(await converge(skipSignature))) {
      say("warn", L.ytdlp.settingsKept({ pin: was.pin ?? null, channel: was.channel }));
      return false;
    }
    // 채널은 고정과 함께 저장한다(고정이 잠그는 값이라 카드 저장이 둘을 같이 받는다)
    tunables.saveCard({ YTDLP_VERSION: pin, ...(channel !== was.channel ? { YTDLP_CHANNEL: channel } : {}) });
    if (pin !== was.pin) say("warn", L.ytdlp.pinChanged({ from: was.pin ?? null, to: pin ?? null }));
    if (channel !== was.channel) say("warn", L.ytdlp.channelChanged({ from: was.channel, to: channel }));
    return true;
  } finally {
    settingsDb.close();
    await held.release();
  }
}

try {
  const args = parseUpdateArgs(process.argv);
  if ("error" in args) throw new Error(asText(args.error));
  if (args.skipSignature) say("warn", L.ytdlp.signatureSkipped());
  if (args.pin !== undefined || args.channel !== undefined) {
    if (!(await changeSettings({ pin: args.pin, channel: args.channel }, args.skipSignature))) process.exitCode = 1;
  } else {
    const loaded = await loadTarget();
    if (!loaded) throw logTextError(L.ytdlp.settingsUnreadNoDownload());
    if (!(await converge(args.skipSignature))) process.exitCode = 1;
  }
} catch (error) {
  say("warn", L.ytdlp.alignFailed({ error: messageOf(error) }));
  process.exitCode = 1;
}
