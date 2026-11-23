// 종료. 신호를 받으면 세션을 저장하고 음성 연결, 봇, 자식 프로세스를 정리한 뒤 나간다. 게이트웨이를 정상으로 닫으면 디스코드가 봇을 곧바로 음성 채널에서 뺀다.
// 대시보드의 다시 시작도 같은 길로 정리하고 EXIT.restart로 나간다(실행기가 다시 실행한다).
// 핸들러는 기동 맨 앞(POToken 서버를 실행하기 전)에 걸고, 봇은 만든 뒤에 붙인다. 붙이기 전에 끄면 실행한 것만 내리고 깨끗이 끝났다고 적는다.
// 기동이 실패했을 때도 실행한 것을 내리고 나간다.

import readline from "readline";
import { getVoiceConnections } from "@discordjs/voice";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "core" });
import * as procRegistry from "../infra/process-registry.ts";
import { closeLanes } from "../sources/ytdlp-spawn.ts";
import { messageOf } from "../rules/error-kind.ts";
import { EXIT, type ExitCode } from "./exit-codes.ts";
import { runRecord } from "./run-record.ts";
import type { PotStop } from "../sources/youtube/pot-server.ts";
import { finishSessions } from "../dashboard/session-store.ts";
import { beginShutdown } from "../infra/shutdown-state.ts";
import { stopJob } from "../infra/script-job.ts";
import { L } from "../infra/log/text.ts";
import type { LogText } from "../infra/log/log-text.ts";

// 바깥 경계. 테스트는 가짜를 넘긴다
type Boundary = {
  proc: Pick<NodeJS.Process, "on" | "platform" | "stdin" | "stdout">;
  /** 음성 라이브러리가 들고 있는 연결 */
  voiceConnections(): Iterable<readonly [string, { destroy(adapterAvailable?: boolean): unknown }]>;
  /** 남은 자식 프로세스를 내리고 내린 것을 돌려준다 */
  killAll(): Array<{ label: string; pid: number }>;
  /** 실행 중인 설치 작업을 중단하고 그 이름을 반환한다(없으면 null). killAll보다 먼저 호출한다 */
  stopJob(): Promise<string | null>;
  exit(code: number): unknown;
  /** 실행 기록. 끝난 방식을 적는다 */
  record: Pick<typeof runRecord, "end">;
};
const REAL: Boundary = {
  proc: process,
  voiceConnections: () => getVoiceConnections(),
  // 기다리던 yt-dlp가 자식 정리 뒤에 뜨지 않게 줄을 먼저 닫는다
  killAll: () => {
    closeLanes();
    return procRegistry.killAll();
  },
  stopJob,
  exit: (code) => process.exit(code),
  record: runRecord,
};
/** 내릴 POToken 서버, 닫을 로그 파일(없으면 null), 나머지는 바깥 경계(생략하면 실제 구현) */
type ShutdownDeps = { potServer: { stop(): Promise<PotStop> }; logFile: { close(): unknown } | null } & Partial<Boundary>;
/** 종료할 때 세션을 저장하고 음성 연결을 정리할 플레이어 */
type Saver = { persistence: { save(reason: string): Promise<unknown> }; gain?: { checkpoint(): void }; voice: { release(reason: string | LogText): unknown }; updateVoiceStatus(status: string): Promise<unknown> };
// 음성 채널 상태 문구를 지우는 데 기다리는 상한. 넘으면 그대로 끝낸다
const STATUS_CLEAR_MS = 2000;
// 다시 시작 공지를 보내는 데 기다리는 상한(모든 서버 합쳐). 넘으면 보낸 것만 세고 종료를 잇는다
const NOTICE_MS = 3000;
// 디스코드 연결(게이트웨이)을 닫을 때 기다리는 상한. close 프레임이 나가야 디스코드가 봇을 곧바로 음성 채널에서 뺀다. 넘으면 그대로 내린다
const CLIENT_CLOSE_MS = 2000;
// 기동이 실패하면 이만큼 뒤에 나간다. 곧바로 나가면 막 끝난 REST 요청(로그인, 명령 배포)의 핸들 정리와 겹쳐
// Windows에서 libuv 어서션으로 죽는다(Node 24)
const FAILED_START_GRACE_MS = 1000;

/**
 * 종료할 때 쓰는 것. 디스코드 클라이언트(서버 이름, 내리기)와 서버마다의 플레이어.
 * restartNotices: 다시 시작 공지를 서버마다 보내기 시작하고 그 끝을 돌려준다(보냈으면 true. 거절하지 않는다). 조립(app/main)이 붙인다
 */
type ShutdownBot = { client: { guilds: { cache: { get(id: string): { name?: string } | undefined } }; destroy(): unknown }; players: Iterable<readonly [string, Saver | null]>; stay?: { stop(): unknown }; restartNotices?: () => Promise<boolean>[] };

/** 종료 신호에 핸들러를 건다. 돌려주는 attach로 봇을 붙인다 */
function installShutdown({ potServer, logFile, ...boundary }: ShutdownDeps) {
  const { proc, voiceConnections, killAll, stopJob, exit, record } = { ...REAL, ...boundary };

  let bot: ShutdownBot | null = null;
  let shuttingDown = false;
  // why: 로그, 연결 정리에 적는 원인. restart면 다시 시작 코드로 나간다. announce: 다시 시작 전에 재생 중인 서버에 알린다
  const gracefulShutdown = async (why: string | LogText, restart = false, announce = false) => {
    // Windows 콘솔의 Ctrl+C는 프로세스 신호와 입력 쪽 신호로 두 번 들어온다. 한 번만 한다
    if (shuttingDown) return;
    shuttingDown = true;
    // 새 음성 연결과 새 작업을 시작하지 않게 한다(막는 곳은 infra/shutdown-state)
    beginShutdown();
    const client = bot?.client ?? null;
    const reason = restart ? L.core.shutdownRestartReason({ why }) : L.core.shutdownExitReason({ why });
    log.info(L.core.shutdownStarted({ reason }));
    // 상주 모드가 재접속을 예약하거나 플레이어 정리 때 상주 설정을 지우지 않게 세션 저장 전에 멈춘다
    bot?.stay?.stop();
    // 공지는 세션을 저장하기 전에(저장하면서 음성 연결을 정리한다). announce는 다시 시작(restart)으로만 들어온다
    if (announce) await announceRestart(bot?.restartNotices);
    if (bot) await savePlayers(bot.players, reason);

    destroyLeftovers(voiceConnections(), client, reason);
    record.end(restart ? "restart" : "shutdown");
    await release(client, { potServer, logFile, killAll, stopJob });
    exit(restart ? EXIT.restart : EXIT.stopped);
  };

  // 종료가 중간에 예외를 던져도 나간다. 못 한 정리는 프로세스와 함께 닫힌다(다시 시작이었으면 그래도 다시 실행하게 같은 코드로)
  const stop = (why: string | LogText, restart = false, announce = false) => {
    gracefulShutdown(why, restart, announce).catch((error: unknown) => {
      log.error(L.core.shutdownError(), error);
      exit(restart ? EXIT.restart : EXIT.stopped);
    });
  };
  const onSignal = (signal: string) => stop(signal);
  proc.on("SIGINT", () => onSignal("SIGINT"));
  proc.on("SIGTERM", () => onSignal("SIGTERM"));
  proc.on("SIGHUP", () => onSignal("SIGHUP")); // 터미널 닫힘, SSH 끊김

  // Windows 콘솔의 Ctrl+C는 프로세스 신호로 안 오는 때가 있어 입력 쪽에서도 받는다
  if (proc.platform === "win32" && proc.stdin.isTTY) {
    readline.createInterface({ input: proc.stdin, output: proc.stdout }).on("SIGINT", () => onSignal("SIGINT"));
  }

  return {
    /** 봇(클라이언트, 플레이어)을 붙인다. 이제부터 끄면 세션을 저장하고 연결, 봇까지 정리한다 */
    attach(next: ShutdownBot) {
      bot = next;
    },
    /** 정리하고 다시 시작 코드로 나간다. 실행기가 다시 실행한다. by: 누가(로그). announce: 재생 중인 서버에 다시 시작한다고 알린다 */
    restart(by: string | LogText, { announce = false }: { announce?: boolean } = {}) {
      stop(by, true, announce);
    },
  };
}

// 다시 시작 공지를 상한(NOTICE_MS)까지 기다린다. 실패는 여기서 삼킨다(공지 때문에 세션 저장을 건너뛰지 않게)
async function announceRestart(notices: (() => Promise<boolean>[]) | undefined) {
  if (!notices) return;
  let sending: Promise<boolean>[];
  try {
    sending = notices();
  } catch (error) {
    return void log.warn(L.core.restartNoticeFailed({ error: messageOf(error) }));
  }
  if (!sending.length) return;
  let sent = 0;
  let pending = sending.length;
  const counted = sending.map((one) =>
    one
      .then(
        (ok) => void (ok && sent++),
        () => undefined,
      )
      .finally(() => pending--),
  );
  let cap: NodeJS.Timeout | undefined;
  await Promise.race([Promise.all(counted), new Promise((done) => (cap = setTimeout(done, NOTICE_MS)))]);
  clearTimeout(cap);
  log.info(L.core.restartNoticesSent({ total: sending.length, sent, pending, seconds: NOTICE_MS / 1000 }));
}

// 레지스트리에 없던 연결도 나가기 요청 없이 정리한다
function destroyLeftovers(connections: ReturnType<Boundary["voiceConnections"]>, client: ShutdownBot["client"] | null, reason: LogText) {
  for (const [guildId, connection] of connections) {
    const name = client?.guilds.cache.get(guildId)?.name ?? guildId;
    try {
      connection.destroy(false);
      log.info(L.core.voiceConnectionCleaned({ guild: name, reason }));
    } catch (error) {
      log.error(L.core.voiceConnectionCleanFailed({ guild: name }), error);
    }
  }
}

// 플레이어의 세션을 저장하고, 음성 채널 상태 문구를 지우고, 나가기 요청 없이 연결을 정리한다
async function savePlayers(players: ShutdownBot["players"], reason: LogText) {
  const saves = [];
  for (const [guildId, player] of players) {
    if (!player) continue;
    // 볼륨 정규화의 재생 중 측정값도 지금 저장해 둔다. 이 뒤에는 DB가 닫힌다
    player.gain?.checkpoint();
    saves.push(
      player.persistence.save("shutdown").then(
        () => true,
        (err: unknown) => (log.error(L.core.sessionSaveFailed({ guildId }), err), false),
      ),
    );
  }
  const saved = (await Promise.all(saves)).filter(Boolean).length;
  if (saved) log.info(L.core.sessionsSaved({ count: saved }));

  // 상태 문구는 채널에 붙어 봇이 빠져도 남는다. 재생 중이던 곡 이름이 소리 없이 떠 있지 않게 지운다
  let cleared = 0;
  let pending = 0;
  const clears = [];
  for (const [, player] of players) {
    if (!player) continue;
    pending++;
    clears.push(
      player
        .updateVoiceStatus("")
        .then(
          () => void cleared++,
          (error: unknown) => log.warn(L.core.voiceStatusClearFailed({ error: messageOf(error) })),
        )
        .finally(() => pending--),
    );
  }
  let cap: NodeJS.Timeout | undefined;
  await Promise.race([Promise.all(clears), new Promise((done) => (cap = setTimeout(done, STATUS_CLEAR_MS)))]);
  clearTimeout(cap);
  if (cleared) log.info(L.core.voiceStatusCleared({ count: cleared }));
  if (pending) log.warn(L.core.voiceStatusClearTimedOut({ seconds: STATUS_CLEAR_MS / 1000, count: pending }));

  // 이 쪽 연결만 정리한다. 리스너를 먼저 떼므로 "연결이 끊겼으니 복구"로 받지 않는다
  for (const [, player] of players) player?.voice.release(reason);
}

/** 기동이 실패했다. 실행한 것을 내리고 잠시 뒤 code(설정, 토큰이 틀림 또는 일시적 실패)로 나간다 */
function stopFailedStart(client: { destroy(): unknown } | null, { potServer, logFile, ...boundary }: ShutdownDeps, code: ExitCode, graceMs = FAILED_START_GRACE_MS) {
  const { killAll, stopJob, exit, record } = { ...REAL, ...boundary };
  log.info(L.core.shutdownAfterStartupFailed());
  record.end("startup-failed");
  void release(client, { potServer, logFile, killAll, stopJob })
    .catch((error: unknown) => log.error(L.core.shutdownError(), error))
    .finally(() => setTimeout(() => exit(code), graceMs));
}

// 봇이 실행한 것을 내린다. 클라이언트, POToken 서버, 자식 프로세스, 로그 파일. 내린 것마다 한 줄, 다 마쳤으면 끝 줄(없으면 정리 도중에 죽은 것)
async function release(client: { destroy(): unknown } | null, { potServer, logFile, killAll, stopJob }: Pick<ShutdownDeps, "potServer" | "logFile"> & Pick<Boundary, "killAll" | "stopJob">) {
  if (client) await closeClient(client);
  const pot = await potServer.stop();
  if (pot === "stopped") log.info(L.core.potServerStopped());
  else if (pot === "timeout") log.warn(L.core.potServerKilled());

  const job = await stopJob();
  if (job) log.info(L.core.installJobStopped({ job }));

  // 진행 중이던 yt-dlp/FFmpeg를 자손까지 정리한다.
  // 정리하지 않으면 Windows에서는 봇만 죽고 ffmpeg가 남아 (라이브 등) 무한 다운로드를 계속한다.
  const killed = killAll();
  if (killed.length) log.info(L.core.childProcessesKilled({ count: killed.length, labels: countByLabel(killed) }));

  // 끊었지만 삭제하지 못한 로그인 세션을 마지막으로 다시 삭제해 보고, 여전히 남으면 그 수와 다시 시작할 때 일어날 일을 로그에 남긴다
  finishSessions();

  log.info(L.core.shutdownDone());
  if (logFile) logFile.close();
}

// 디스코드 연결을 닫고 close 프레임이 나가기를 상한까지 기다린다
async function closeClient(client: { destroy(): unknown }) {
  let cap: NodeJS.Timeout | undefined;
  const closing = Promise.resolve()
    .then(() => client.destroy())
    .then(
      () => "closed" as const,
      (error: unknown) => (log.warn(L.core.discordCloseFailed({ error: messageOf(error) })), "failed" as const),
    );
  const how = await Promise.race([closing, new Promise<"timeout">((done) => (cap = setTimeout(done, CLIENT_CLOSE_MS, "timeout")))]);
  clearTimeout(cap);
  if (how === "closed") log.info(L.core.discordClosed());
  else if (how === "timeout") log.warn(L.core.discordCloseTimedOut({ seconds: CLIENT_CLOSE_MS / 1000 }));
}

// 라벨별 개수. 예: "ffmpeg:playback 2 · yt-dlp 1"
function countByLabel(killed: Array<{ label: string }>) {
  const counts = new Map<string, number>();
  for (const { label } of killed) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts].map(([label, n]) => `${label} ${n}`).join(" · ");
}

export { installShutdown, stopFailedStart };
export type { Boundary as ShutdownBoundary };
