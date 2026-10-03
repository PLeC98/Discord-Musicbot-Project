// 봇 조립. src/index.ts 가 설정 문제를 본 뒤 main() 을 부른다(설정 검사가 구조적으로 먼저 돈다).
// 로그 → 남은 자식 프로세스 정리 → 종료 처리기 → 슬래시 명령 배포 → POToken 서버 → 클라이언트 · 화면 · 대시보드 → 처리기 → 기동 확인 → 로그인.

import { Client, GatewayIntentBits, Events, type ClientEvents, type VoiceState } from "discord.js";
import logSink from "../infra/log/sink.ts";
import logger from "../infra/log/logger.ts";
import config from "../config/index.ts";
import * as audioCache from "../store/audio-cache.ts";
import { logResolved as logResolvedFfmpeg, ffmpegPath, capabilities as ffmpegCapabilities } from "../media/ffmpeg/path.ts";
import { Player } from "../player/player.ts";
import { restoreSavedPlayers, restoreGuild } from "../player/session-restore.ts";
import { adoptLingeringVoice } from "../player/voice-adopt.ts";
import * as voiceChannelStatus from "../player/voice-channel-status.ts";
import * as voiceStatusStore from "../store/voice-status.ts";
import { onVoiceStateUpdate } from "../player/voice-presence.ts";
import { PlayerRegistry } from "../player/registry.ts";
import { createPotServer } from "../sources/youtube/pot-server.ts";
import * as YouTube from "../sources/youtube/index.ts";
import * as ytdlpOptions from "../sources/ytdlp-options.ts";
import { ytdlpBinary } from "../sources/ytdlp-binary.ts";
import { genres } from "../config/genres.ts";
import * as statusConfig from "../config/status.ts";
import * as commandLoader from "./command-loader.ts";
import type { SlashCommand } from "./command-loader.ts";
import type { BotContext } from "./bot-context.ts";
import { EVENTS } from "../discord/events/index.ts";
import { installErrorHandlers } from "./resilience.ts";
import { createGuildFaults } from "./guild-fault.ts";
import { guarded, type OnFault } from "./event-boundary.ts";
import { installShutdown, stopFailedStart } from "./shutdown.ts";
import * as procRegistry from "../infra/process-registry.ts";
import { sweepLeftoverChildren } from "../infra/leftover-children.ts";
import { PROJECT } from "../infra/project-paths.ts";
import path from "path";
import { ALLOWED_MENTIONS } from "../ui/mentions.ts";
import { NowPlayingPanel } from "../ui/now-playing-panel.ts";
import { StatusManager } from "../ui/bot-presence.ts";
import { createFileDestination } from "../infra/log/file.ts";
import { startDashboard } from "../dashboard/index.ts";
import { createPlayerStream } from "../dashboard/player-stream.ts";
import { botJoinedGuild } from "../dashboard/routes/player-events.ts";
import * as playerEvents from "../player/events.ts";
import { sendNotice } from "../ui/player-notices.ts";
import { messageOf } from "../rules/error-kind.ts";
import { failedStartCode } from "./exit-codes.ts";
import { loginWithRetry } from "./login.ts";
import { runRecord } from "./run-record.ts";
import { bestEffort } from "../infra/best-effort.ts";

const log = logger.child({ category: "core" });

type PotServer = ReturnType<typeof createPotServer>;
type LogFile = ReturnType<typeof createFileDestination>;
type Shutdown = ReturnType<typeof installShutdown>;
// 등록부가 적는 자식 프로세스 기록. 다음 기동이 남은 것을 정리한다
const CHILDREN_FILE = path.join(PROJECT.database, "child-processes.json");
/** 이벤트 모듈을 쓸 때의 모양. 이름의 이벤트 인자로 부른다 */
type ClientEvent<K extends keyof ClientEvents> = { name: K; once?: boolean; execute(bot: BotContext, ...args: ClientEvents[K]): unknown };
/** 이벤트 목록(src/discord/events/index)의 한 칸. 이벤트마다 인자가 다르다 */
type AnyClientEvent = { [K in keyof ClientEvents]: ClientEvent<K> }[keyof ClientEvents];
/** 등록할 때 보는 모양. 인자는 이름이 정한다 */
type EventModule = { name: keyof ClientEvents; once?: boolean; execute(bot: BotContext, ...args: unknown[]): unknown };

// 기동을 멈춘다. 까닭은 던지기 전에 로그에 남겼다
class StartupStopped extends Error {}

function main() {
  const logFile = setUpLogging();
  // 직전 실행이 어떻게 끝났나. 짧게 끊긴 실행이 연달아면 이번에는 세션을 되살리지 않는다
  const previous = runRecord.begin();
  log.info({ tags: ["startup"] }, previous.line);
  // 직전 실행이 남긴 자식(POToken 서버 · ffmpeg · yt-dlp)을 내리고 이번 실행의 자식을 적기 시작한다. 남은 POToken 서버가 포트를 쥐지 않게 서버를 띄우기 전에
  sweepLeftoverChildren(CHILDREN_FILE);
  procRegistry.persistTo(CHILDREN_FILE);

  // 유튜브 POToken 서버. 준비를 확인한 뒤 봇을 켠다
  const potServer = createPotServer();
  // 종료 처리기는 POToken 서버를 기다리는 동안에도 받는다. 기다리다 끈 것이 기록 없이 끊김으로 세어지지 않게
  const shutdown = installShutdown({ potServer, logFile });
  deploySlashCommands();
  potServer.start();
  potServer
    .waitReady()
    .then(() => startBot({ potServer, logFile, shutdown, skipRestore: previous.skipRestore }))
    .catch((error: unknown) => {
      // 클라이언트를 만들기 전에 던졌다. 띄운 것을 내리고 나간다
      log.error("봇 기동 실패:", error);
      stopFailedStart(null, { potServer, logFile }, failedStartCode(error, false));
    });
}

// 로그 레벨과 파일. 이보다 앞선 레코드(config 경고 등)는 sink가 모아뒀다가 파일에 재생한다.
// 기본 레벨(info)로 이미 기록된 그것들은 어차피 warn 이상이라 잘려나갈 일이 없다.
function setUpLogging() {
  logger.level = config.logging.level;
  if (config.logging.consoleLevel) logSink.setConsoleLevel(config.logging.consoleLevel);

  const logFile = config.logging.fileEnabled ? createFileDestination(config.logging) : null;
  if (logFile) {
    logSink.addDestination(logFile.write);
    log.info({ tags: ["startup"] }, `로그 파일 저장 경로: ${logFile.path}`);
  }
  return logFile;
}

function deploySlashCommands() {
  log.debug("슬래시 명령어 배포를 시작합니다.");
  commandLoader
    .deployCommands()
    .then((r) => {
      if (r.ok && r.skipped) log.info(`명령어 정의 ${r.count}개가 바뀌지 않았습니다. 등록을 건너뜁니다. (강제 재배포: pnpm run cmddeploy)`);
      else if (r.ok) log.info(`${r.count}개 슬래시 명령어를 ${r.scope === "guild" ? `서버 ${r.guildId}에` : "전역으로"} 배포했습니다.`);
      else commandLoader.deployErrorLines(r).forEach((line) => log.error(line));
    })
    .catch((error: unknown) => log.error("슬래시 명령어 배포 실패:", messageOf(error)));
}

function startBot({ potServer, logFile, shutdown, skipRestore }: { potServer: PotServer; logFile: LogFile | null; shutdown: Shutdown; skipRestore: boolean }) {
  const client = new Client({
    // GuildMembers 는 부르는 곳이 없어 보여도 대시보드가 기댄다. 권한 판정 · 서버 목록이 멤버를 캐시에서 먼저 보는데,
    // 역할 · 별명 변경(GUILD_MEMBER_UPDATE)과 나간 멤버(GUILD_MEMBER_REMOVE)는 이 인텐트가 있어야 캐시에 온다
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
    // 외부에서 온 트랙 제목·파일명이 content에 실려도 멘션이 발동하지 않게 (src/ui/mentions.ts)
    allowedMentions: ALLOWED_MENTIONS,
  });
  const players = new PlayerRegistry(); // 등록·해제를 로그로 남기는 Collection
  players.followDisposals(); // 버려진 플레이어는 등록부가 스스로 뺀다
  const panels = new NowPlayingPanel(client, players);
  // 명령은 기동 확인 뒤 init 이 채운다
  const commands = new Map<string, SlashCommand>();
  const bot: BotContext = { client, players, panels, commands };
  const stream = createPlayerStream();
  startDashboard(bot, { stream, deployCommands: commandLoader.deployCommands });
  listenToPlayers(panels, stream);
  // 봇이 새 서버에 들면 대시보드 서버 목록 연결을 연 사람들이 그 서버의 신호도 받게 한다
  client.on(Events.GuildCreate, (guild) => {
    bestEffort(log, botJoinedGuild(stream, guild), "새 서버의 대시보드 구독자 가져오기");
  });

  // 서버 하나 다시 켜기. 이벤트 처리기 경계와 새어 나온 오류 처리기가 서버를 알면 여기로 보낸다
  const fault = createGuildFaults({ players, restore: (guildId) => restoreGuild(client, players, Player, guildId) });
  const onFault: OnFault = (error, guildId, where) => {
    if (guildId) fault(guildId, error, where).catch((e: unknown) => log.error(`서버 ${guildId} 오류 처리 실패:`, e));
    else log.error(`처리기 오류 (${where}):`, error);
  };

  client.once(Events.ClientReady, (ready) => {
    onReady(ready, bot, skipRestore).catch((error: unknown) => log.error("기동 마무리(세션 복원 · 패널) 실패:", error));
  });
  // 음성 채널 상태는 REST로 읽을 수 없다. 게이트웨이 패킷에서만 알 수 있어 여기서 따라간다.
  // (기동 시 GUILD_CREATE가 현재 값을, 이후 VOICE_CHANNEL_STATUS_UPDATE가 변경을 알려 준다)
  client.on(Events.Raw, (packet) => voiceChannelStatus.consumePacket(packet));
  // 음성 상태 변화: 강제 퇴장 · 채널 이동 · 음소거 · 혼자 남음
  client.on(
    Events.VoiceStateUpdate,
    guarded("음성 상태", (oldState: VoiceState, newState: VoiceState) => onVoiceStateUpdate(client, players, oldState, newState), onFault),
  );
  // 새어 나온 오류 · 거부 · 예외를 가려 표적 복구하거나 안전 종료한다
  installErrorHandlers(client, { players, fault });

  // 실패는 init 이 받아 기동 실패로 내린다
  bestEffort(log, init(bot, { commands, potServer, logFile, shutdown, onFault }), "기동");
}

// 플레이어의 알림을 화면과 대시보드에 잇는다
function listenToPlayers(panels: NowPlayingPanel, stream: ReturnType<typeof createPlayerStream>) {
  playerEvents.on("refresh", (player) => panels.updatePlaying(player));
  playerEvents.on("ended", (player, reason, cause) => panels.drawEndedPanel(player, { reason, cause }));
  playerEvents.on("started", (player) => player.currentTrack && panels.postPlaying(player, player.currentTrack));
  playerEvents.on("released", (_player, textChannelId) => panels.deleteWebhookCache(textChannelId));
  playerEvents.on("notice", (player, code, detail) => sendNotice(player, code, detail));
  playerEvents.on("touched", (guildId) => stream.notify(guildId));
  playerEvents.on("leaving", (player, leavesAt) => panels.updateIdleLeave(player, leavesAt));
}

async function onReady(client: Client<true>, { players, panels }: BotContext, skipRestore: boolean) {
  log.info({ tags: ["startup"] }, `${client.user.tag} 준비 완료`);
  log.info(`서버 ${client.guilds.cache.size}개에서 대기 중`);
  new StatusManager(client).start(); // 활동 문구

  // 캐시 정리는 복원 앞에. 정리는 이전 실행이 남긴 것(받다 만 행 · 고아 파일)을 다루는데, 복원이 곡을 틀기 시작한 뒤에 돌면
  // 이번 실행이 받기 시작한 행까지 받다 만 것으로 되돌린다. 복원될 곡은 퇴거 · 고아 청소 모두 저장된 세션을 보고 지킨다
  await cleanupAudioCache();
  log.debug("세션 복원 시작");
  const touched = await restoreSavedPlayers(client, players, Player, { skip: skipRestore });
  // 세션 없이 음성 채널에 남아 있던 봇(곡 없이 끔)을 이어받는다. 복원이 손댄 서버는 건드리지 않는다
  await adoptLingeringVoice(client, players, Player, { touched });
  // 기록된 패널을 지금 상태로. 세션을 복원한 서버는 이미 새로 올렸다
  await panels.restorePanels();
  log.info({ tags: ["startup"] }, "저장된 세션 복원 완료");
}

// 기동 시 오디오 캐시 정리(중단된 받기 · 고아 파일 · 퇴거)
async function cleanupAudioCache() {
  try {
    await audioCache.onStartup();
  } catch (error) {
    log.error("오디오 캐시 기동 정리 실패:", messageOf(error));
  }
}

async function init(bot: BotContext, { commands, potServer, logFile, shutdown, onFault }: { commands: Map<string, SlashCommand>; potServer: PotServer; logFile: LogFile | null; shutdown: Shutdown; onFault: OnFault }) {
  const { client, players } = bot;
  try {
    log.info({ tags: ["startup"] }, "봇 구동을 시작합니다.");
    checkBeforeLogin();
    loadCommands(commands);
    loadEvents(bot, onFault);
    // 이제부터 끄면 세션을 저장하고 연결 · 봇까지 정리한다
    shutdown.attach({ client, players });
    await loginWithRetry(client, config.discord.token);
  } catch (error) {
    const stopped = error instanceof StartupStopped;
    if (!stopped) log.error("봇 기동 실패:", error);
    stopFailedStart(client, { potServer, logFile }, failedStartCode(error, stopped));
  }
}

// 로그인 전에 확인할 것. 하나라도 안 되면 멈춘다
function checkBeforeLogin() {
  // 재생·캐시 변환이 모두 ffmpeg에 의존하므로 여기서 확정하고 기록한다. 못 찾으면 여기서 기동을 멈춘다
  stopIfThrows(() => logResolvedFfmpeg());
  // 능력 확인(spawnSync 셋)도 여기서 해 둔다. 처음 곡을 틀 때 부르면 그동안 이벤트 루프가 멈춰 다른 서버의 음성이 밀린다
  ffmpegCapabilities();
  // yt-dlp 도 재생과 같은 ffmpeg 를 쓴다
  ytdlpOptions.useFfmpeg(ffmpegPath);
  // 캐시 DB 구조가 이 버전과 맞지 않으면 여기서 멈춘다
  stopIfThrows(() => audioCache.initialize());
  // 음성 채널 상태 중 우리가 쓴 것. 재시작 전에 쓴 것도 계속 고치려면 게이트웨이에 붙기 전에 읽어 둔다
  voiceChannelStatus.keepIn(voiceStatusStore);

  // 지금 무엇으로 유튜브에 붙는지 한 줄. 이걸 안 남겨서 bgutil이 3개월간 죽어 있는 걸 몰랐다.
  YouTube.logAuthMode();
  // yt-dlp 버전을 한 줄 남기고 설정대로 새 버전을 본다. 기동을 막지 않는다(그동안은 설치 때 받은 것으로 돈다)
  bestEffort(log, ytdlpBinary.start(), "yt-dlp 버전 맞추기");

  // 자동재생 설정을 여기서 한 번 읽는다. 읽는 쪽이 자동재생을 쓸 때뿐이라 그대로 두면
  // 잘못된 설정이 "켰더니 아무 일도 안 일어난다"로 나타나고, 키가 빠진 소스 경고도
  // 그때서야 나와 기동 로그에 안 남는다.
  stopIfThrows(() => genres(), "config/genres.yaml 을 고친 뒤 다시 실행하세요.");
  // 활동 문구 설정도 여기서 본다. 틀린 채로 뜨면 쓸 설정이 없다(돌던 중에 틀리면 직전 설정으로 돈다)
  stopIfThrows(() => statusConfig.status(), "config/status.yaml 을 고친 뒤 다시 실행하세요.");
}

function stopIfThrows(check: () => unknown, hint: string | null = null) {
  try {
    check();
  } catch (error) {
    log.error(messageOf(error));
    if (hint) log.error(hint);
    throw new StartupStopped(messageOf(error), { cause: error });
  }
}

function loadCommands(commands: Map<string, SlashCommand>) {
  const enabled = commandLoader.enabledCommands();
  for (const command of enabled) commands.set(command.data.name, command);
  log.info({ tags: ["startup"] }, `슬래시 명령어 ${enabled.length}개 준비 완료`);
}

function loadEvents(bot: BotContext, onFault: OnFault) {
  const { client } = bot;
  const events = EVENTS as readonly EventModule[];
  for (const event of events) {
    const register = <K extends keyof ClientEvents>(name: K, listener: (...args: ClientEvents[K]) => unknown) => (event.once ? client.once(name, listener) : client.on(name, listener));
    // 처리기마다 서버 경계로 감싼다(app/event-boundary). 새어 나온 오류는 그 서버의 오류로 받는다
    register(
      event.name,
      guarded(event.name, (...args: unknown[]) => event.execute(bot, ...args), onFault),
    );
  }
  log.info({ tags: ["startup"] }, `이벤트 핸들러 ${events.length}개 등록 완료`);
}

export { main };
export type { ClientEvent, AnyClientEvent };
