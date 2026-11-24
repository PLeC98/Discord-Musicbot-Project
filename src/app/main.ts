// 봇 조립. src/index.ts가 설정 문제를 본 뒤 main()을 부른다(설정 검사가 구조적으로 먼저 돈다).
// 로그 → 실행 기록 → 남은 자식 프로세스 정리 → 종료 핸들러 → DB, 설정 → 슬래시 명령 배포 → POToken 서버 → 전체 백업의 오디오 캐시 → 클라이언트, 화면, 대시보드 → 핸들러 → 기동 확인 → 로그인.

import { Client, Events, GatewayCloseCodes, RESTEvents, type ClientEvents, type GatewayIntentBits, type VoiceState } from "discord.js";
import logSink from "../infra/log/sink.ts";
import logger from "../infra/log/logger.ts";
import * as processPriority from "../infra/process-priority.ts";
import config from "../config/index.ts";
import * as audioCache from "../store/audio-cache.ts";
import * as stores from "../store/stores.ts";
import * as snapshots from "../store/snapshots.ts";
import { applyStagedUsers } from "../store/users-db.ts";
import * as fullReset from "../store/full-reset.ts";
import * as archive from "../dashboard/settings-archive.ts";
import type { ArchiveItem } from "../dashboard/contract/settings-archive.ts";
import * as serviceKeys from "../store/service-keys.ts";
import { uploadedIds, keepUploaded, addUploaded } from "../store/app-emoji-records.ts";
import * as tunables from "../store/tunables.ts";
import * as settingsDocs from "../store/settings-docs.ts";
import * as documents from "../config/documents.ts";
import { fetchIfMissing } from "../config/ai-model-info.ts";
import { onTunablesChanged } from "../config/tunables-changed.ts";
import { applyLogLevels } from "./log-levels.ts";
import fs from "fs";
import * as aiKeys from "../store/ai-keys.ts";
import * as cookieJar from "../store/cookie-jar.ts";
import { logResolved as logResolvedFfmpeg, ffmpegPath, capabilities as ffmpegCapabilities, settleRejected as settleRejectedFfmpeg } from "../media/ffmpeg/path.ts";
import { measureQueue } from "../media/loudness-measure.ts";
import { encodePool } from "../media/encode-pool.ts";
import { Player } from "../player/player.ts";
import { restoreSessions, restoreGuild } from "../player/session-restore.ts";
import * as ageGate from "../sources/age-gate.ts";
import { adoptLingeringVoice } from "../player/voice-adopt.ts";
import * as voiceChannelStatus from "../player/voice-channel-status.ts";
import * as voiceStatusStore from "../store/voice-status.ts";
import { onVoiceStateUpdate } from "../player/voice-presence.ts";
import { PlayerRegistry } from "../player/registry.ts";
import { createPotServer } from "../sources/youtube/pot-server.ts";
import * as youtubeSource from "../sources/youtube/index.ts";
import * as embeddedArt from "../sources/embedded-art.ts";
import * as spotifySource from "../sources/spotify.ts";
import * as ytdlpOptions from "../sources/ytdlp-options.ts";
import { ytdlpBinary } from "../sources/ytdlp-binary.ts";
import { cpuLimit as ytdlpCpuLimit } from "../sources/ytdlp-spawn.ts";
import { warnOffTarget } from "../sources/bgutil/version.ts";
import { bgutilAutoInstall } from "../sources/bgutil/auto-install.ts";
import { onJobIdle } from "../infra/script-job.ts";
import { genres } from "../config/genres.ts";
import * as statusConfig from "../config/status.ts";
import * as commandLoader from "./command-loader.ts";
import type { SlashCommand } from "./command-loader.ts";
import type { BotContext } from "./bot-context.ts";
import { EVENTS } from "../discord/events/index.ts";
import { installErrorHandlers, logRejection } from "./resilience.ts";
import { createGuildFaults } from "./guild-fault.ts";
import { guarded, type OnFault } from "./event-boundary.ts";
import { installShutdown, stopFailedStart } from "./shutdown.ts";
import * as procRegistry from "../infra/process-registry.ts";
import { sweepLeftoverChildren } from "../infra/leftover-children.ts";
import { PROJECT } from "../infra/project-paths.ts";
import { enableFatalReport } from "../infra/fatal-report.ts";
import path from "path";
import { ALLOWED_MENTIONS } from "../ui/mentions.ts";
import { NowPlayingPanel } from "../ui/now-playing-panel.ts";
import { BotPresence } from "../ui/bot-presence.ts";
import { createFileDestination } from "../infra/log/file.ts";
import { startDashboard } from "../dashboard/index.ts";
import { prepareStartup } from "./startup-prepare.ts";
import { watchGateway } from "../dashboard/status/gateway.ts";
import { createPlayerStream } from "../dashboard/player-stream.ts";
import { restartNotices } from "../dashboard/discord-notice.ts";
import { botJoinedGuild, botLeftGuild, guildBack } from "../dashboard/routes/player-events.ts";
import { watchGoneGuilds } from "../discord/gone-guilds.ts";
import { watchGatewaySessions } from "../infra/gateway-sessions.ts";
import * as staySeats from "../store/stay-seats.ts";
import { createStayKeeper } from "./stay-keeper.ts";
import { startAppOwners } from "../usecases/app-owners.ts";
import * as playerEvents from "../player/events.ts";
import { botLanguage, languagesNow, publicText } from "../ui/language.ts";
import { sendNotice } from "../ui/player-notices.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import { choosePrivilegedIntents, onRefusedWhileRunning, refusedAtLogin } from "./privileged-intents.ts";
import { loadApp, readApp } from "./app-info.ts";
import { EXIT, LAUNCHER_ENV, failedStartCode } from "./exit-codes.ts";
import { loginWithRetry } from "./login.ts";
import { runRecord } from "./run-record.ts";
import { bestEffort } from "../infra/best-effort.ts";
import { welcomeGuild } from "./welcome.ts";
import { nudgeOnSettingsChange } from "./settings-nudge.ts";
import * as guildSettings from "../store/guild-settings.ts";
import { AppEmojis, apiOf } from "./app-emojis.ts";
import { missingText } from "../ui/text/index.ts";
import { errorText, missingRuleText } from "../rules/text/index.ts";
import { missingLogText } from "../infra/log/text.ts";
import { asText, type LogText } from "../infra/log/log-text.ts";
import { BASE_LANGUAGE } from "../rules/languages.ts";
import { L } from "../infra/log/text.ts";

const log = logger.child({ category: "core" });

type PotServer = ReturnType<typeof createPotServer>;
type LogFile = ReturnType<typeof createFileDestination>;
type Shutdown = ReturnType<typeof installShutdown>;
// 레지스트리가 적는 자식 프로세스 기록(실행마다 파일 하나). 다음 기동이 남은 것을 정리한다
const CHILDREN_DIR = path.join(PROJECT.database, "child-processes");
/** 이벤트 모듈을 쓸 때의 형식. 이름의 이벤트 인자로 부른다 */
type ClientEvent<K extends keyof ClientEvents> = { name: K; once?: boolean; execute(bot: BotContext, ...args: ClientEvents[K]): unknown };
/** 이벤트 목록(src/discord/events/index)의 한 항목. 이벤트마다 인자가 다르다 */
type AnyClientEvent = { [K in keyof ClientEvents]: ClientEvent<K> }[keyof ClientEvents];
/** 등록할 때 보는 형식. 인자는 이름이 정한다 */
type EventModule = { name: keyof ClientEvents; once?: boolean; execute(bot: BotContext, ...args: unknown[]): unknown };

// 기동을 멈춘다. 원인은 예외를 던지기 전에 로그에 남겼다
class StartupStopped extends Error {}

function main() {
  const logFile = setUpLogging();
  // 자식 프로세스, 워커를 띄우기 전에 봇 우선순위를 올린다
  for (const { level, text } of processPriority.describe(processPriority.raiseSelf())) log[level]({ tags: ["startup"] }, text);
  // 이전 실행이 어떻게 끝났나. 짧게 끊긴 실행이 이어졌으면 이번에는 세션을 복원하지 않는다
  const previous = runRecord.begin();
  log.info({ tags: ["startup"] }, previous.line);
  // 이전 실행이 남긴 자식(POToken 서버, ffmpeg, yt-dlp)을 내리고 이번 실행의 자식을 적기 시작한다. 남은 POToken 서버가 포트를 쥐지 않게 서버를 실행하기 전에
  sweepLeftoverChildren(CHILDREN_DIR);
  procRegistry.persistTo(CHILDREN_DIR);

  // 유튜브 POToken 서버. 준비를 확인한 뒤 봇을 켠다
  const potServer = createPotServer();
  // 종료 핸들러는 POToken 서버를 기다리는 동안에도 받는다. 기다리다 끈 것이 기록 없이 끊김으로 세어지지 않게
  const shutdown = installShutdown({ potServer, logFile });
  // 설정(운영 설정값, 키)은 DB에 있다. POToken 서버, 명령 배포, 대시보드가 설정을 읽기 전에 연다
  if (!openSettings({ potServer, logFile })) return;
  // 앱 설정을 먼저 읽어 앱 ID를 넣는다. 명령 배포, 초대 링크, 대시보드 로그인과 쿠키 이름이 쓴다(.env에 두지 않는다)
  loadApp(() => readApp(config.discord.token))
    .then((app) => {
      // 같은 응답으로 봇 운영자와 초대 권한을 정한다(대시보드가 첫 요청을 받기 전). 그 뒤 다시 받는다
      startAppOwners(app, () => readApp(config.discord.token));
      deploySlashCommands();
      void potServer.start();
      // 기동 준비(업데이트 뒤의 화면 빌드, ffmpeg 맞추기)는 POToken 서버를 기다리는 동안 병렬로 실행하고, 대시보드를 열고 ffmpeg 경로를 정하기 전에 끝낸다
      return (
        Promise.all([potServer.waitReady(), prepareStartup()])
          .then(() => restoreAudioCache())
          // 개발자 포털에서 켜진 특권 인텐트만 요청한다(꺼진 것에 기대는 기능만 끈다)
          .then(() => startBot({ potServer, logFile, shutdown, skipRestore: previous.skipRestore, intents: choosePrivilegedIntents(app) }))
      );
    })
    .catch((error: unknown) => {
      // 클라이언트를 만들기 전에 멈췄다. 실행한 것을 내리고 나간다
      const stopped = error instanceof StartupStopped;
      if (!stopped) log.error(L.core.startupFailed(), error);
      stopFailedStart(null, { potServer, logFile }, failedStartCode(error, stopped));
    });
}

/**
 * DB를 열고 설정을 설정 객체에 올린다. 어느 DB든 구조가 맞지 않거나 못 열면 멈춘다(무엇을 하면 되는지 안내한다).
 * 내용이 틀린 것(설정값, 복호화하지 못하는 키)은 멈추지 않고 그 필드만 기본값이다. 고칠 대시보드가 떠야 한다
 */
function openSettings({ potServer, logFile }: { potServer: PotServer; logFile: LogFile | null }) {
  let restored: string | null;
  try {
    // 대시보드에서 봇 전체 초기화를 예약했으면 열기 전에 지운다(스냅샷, .env, 로그, 이번 실행의 기록은 남는다)
    if (fullReset.applyRequested()) log.warn(L.core.fullResetDone());
    // 대시보드에서 선택한 스냅샷, 풀어 둔 전체 백업이 예약되어 있으면 열기 전에 교체한다(지금 것은 backups에 남는다)
    restored = snapshots.applyStaged(PROJECT.database);
    if (restored) log.warn(L.core.settingsDbRestored({ source: restored }));
    if (applyStagedUsers(PROJECT.database)) log.warn(L.core.usersDbReplaced());
    stores.open();
  } catch (error) {
    log.error(L.core.startupAborted({ error: messageOf(error) }));
    if ((error as { dbFile?: string }).dbFile === "settings.db") log.error(L.core.settingsDbRestoreHowTo());
    stopFailedStart(null, { potServer, logFile }, EXIT.badSetup);
    return false;
  }
  snapshots.startDaily();
  tunables.load();
  // 로그 수준: 올린 운영 설정값으로, 그 뒤 바뀔 때마다(실시간 로그 탭의 설정 창)
  applyLogLevels();
  onTunablesChanged(applyLogLevels);
  // 로그 스트림의 하트비트는 로그 계층이라 알림을 직접 듣지 않는다(설정 알림이 로그를 부른다)
  onTunablesChanged(() => logSink.syncHeartbeat(config.dashboard.sse.heartbeatMs));
  // 장르, 상태 문구, AI 설정, 프롬프트. 설정 계층이 메모리에 들고, 저장할 때 settings.db에 쓴다
  // 예전 기본값 그대로인 AI 줄 형식, 프롬프트는 지금 기본값(영어)으로 바꿔 둔다(config/ai-upgrade)
  const upgraded = documents.attach(settingsDocs);
  if (upgraded.length) log.info(L.core.aiDefaultsUpgraded({ lineFormat: upgraded.includes("ai"), prompt: upgraded.includes("ai-prompt") }));
  // 복원한 설정이 AI를 켜 두었는데 이 폴더에 받은 모델 정보가 없을 수 있다(전체 백업은 모델 정보를 담지 않는다)
  if (restored) fetchIfMissing();
  warnLegacyConfigFiles();
  serviceKeys.load();
  staySeats.load();
  aiKeys.warnLegacyFile();
  // 쿠키는 실행마다 파일로 복호화했다가 삭제한다. 비정상 종료로 남은 것을 치운다
  cookieJar.sweep();
  cookieJar.warnLegacyFile();
  return true;
}

// 전체 백업(pnpm run backup)의 오디오 캐시 번들을 합친다(캐시 상한이 운영 값으로 올라온 뒤, 정기 퇴거, 기동 정리, 대시보드보다 먼저). 실패해도 기동은 이어 간다
async function restoreAudioCache() {
  try {
    const done = await archive.applyStagedAudio(PROJECT.database);
    if (done) log.info(L.core.backupAudioCacheMerged({ items: (Object.entries(done.added ?? {}) as Array<[ArchiveItem, number]>).map(([item, n]) => `${asText(archive.ITEM_LABELS[item])} ${n}`).join(", ") || null }));
  } catch (error) {
    log.warn(L.core.backupAudioCacheMergeFailed({ error: messageOf(error) }));
  }
}

// 옛 설정 파일(config/*.yaml, ai-prompt.chatml)이 남아 있으면 한 줄. 읽지도 삭제하지도 않는다(보며 옮길 수 있게)
function warnLegacyConfigFiles() {
  const left = ["genres.yaml", "status.yaml", "ai.yaml", "ai-prompt.chatml"].filter((name) => fs.existsSync(path.join(PROJECT.config, name)));
  if (left.length) log.warn(L.core.legacyConfigFilesLeft({ files: left.join(", ") }));
}

// 로그 레벨과 파일. 이보다 앞선 레코드(config 경고 등)는 sink가 모아뒀다가 파일에 재생한다.
// 기본 레벨(info)로 이미 기록된 앞선 레코드는 어차피 warn 이상이라 잘려나갈 일이 없다.
function setUpLogging() {
  // 설정 DB를 열기 전이라 기본 수준이다. 운영 설정값을 올린 뒤 다시 넣는다(openSettings)
  applyLogLevels();

  const logFile = config.logging.fileEnabled ? createFileDestination(config.logging) : null;
  if (logFile) {
    logSink.addDestination(logFile.write);
    log.info({ tags: ["startup"] }, L.core.logFilePath({ file: logFile.path }));
  }
  // 치명적 오류로 죽을 때의 진단 보고서는 로그 파일과 같은 폴더에 남긴다
  const reportDir = path.dirname(config.logging.file);
  const reportFailure = enableFatalReport(reportDir);
  if (reportFailure) log.warn({ tags: ["startup"] }, L.core.fatalReportDirFailed({ dir: reportDir, error: reportFailure }));
  return logFile;
}

function deploySlashCommands() {
  log.debug(L.core.commandDeployStarted());
  commandLoader
    .deployCommands()
    .then((r) => {
      if (r.ok && r.skipped) log.info(L.core.commandDeploySkipped({ count: r.count }));
      else if (r.ok) log.info(L.core.commandsDeployed({ count: r.count, toGuild: r.scope === "guild", guildId: r.guildId }));
      else commandLoader.deployErrorLines(r).forEach((line) => log.error(line));
    })
    .catch((error: unknown) => log.error(L.core.commandDeployFailed({ error: messageOf(error) })));
}

function startBot({ potServer, logFile, shutdown, skipRestore, intents }: { potServer: PotServer; logFile: LogFile | null; shutdown: Shutdown; skipRestore: boolean; intents: GatewayIntentBits[] }) {
  const client = new Client({
    // 특권 둘은 개발자 포털에서 켜진 것만(app/privileged-intents). GuildMembers는 부르는 곳이 없어 보여도 대시보드가 기댄다.
    // 권한 판정, 서버 목록이 멤버를 캐시에서 먼저 보는데, 역할, 별명 변경(GUILD_MEMBER_UPDATE)과 나간 멤버(GUILD_MEMBER_REMOVE)는 이 인텐트가 있어야 캐시에 온다
    intents,
    // 외부에서 온 곡 제목, 파일명이 content에 실려도 멘션이 발동하지 않게 (src/ui/mentions.ts)
    allowedMentions: ALLOWED_MENTIONS,
    // 거절된 요청이 이만큼 쌓일 때마다 알린다(listenToLibrary)
    rest: { invalidRequestWarningInterval: 500 },
  });
  const players = new PlayerRegistry(); // 등록, 해제를 로그로 남기는 Collection
  players.followDisposals(); // 버려진 플레이어는 레지스트리가 자동으로 뺀다
  const panels = new NowPlayingPanel(client, players);
  // 명령은 기동 확인 뒤 init이 채운다
  const commands = new Map<string, SlashCommand>();
  const stay = createStayKeeper({ client, players });
  const bot: BotContext = { client, players, panels, commands, stay };
  // 연령 제한 콘텐츠의 서버 판정이 볼 곳: 봇이 지금 든 음성 채널(옮겨져도 따라간다), 음성 밖이면 곡 추가가 넘긴, 봇이 들어갈 채널. 둘 다 없으면 모른다
  ageGate.usePlace((guildId, target) => {
    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.members.me?.voice?.channel ?? (target ? guild?.channels.cache.get(target) : null);
    return channel?.isVoiceBased() ? channel.nsfw : null;
  });
  const stream = createPlayerStream();
  // 다시 시작은 다시 실행해 줄 실행기(pnpm start)가 있을 때만 연다
  const restart = process.env[LAUNCHER_ENV] === "1" ? (by: string | LogText, options?: { announce?: boolean }) => shutdown.restart(by, options) : null;
  // 실행 중에 포털에서 특권 인텐트를 끄면 게이트웨이가 4014로 연결을 끊고 재연결하지 않는다. 실행기가 있으면 다시 시작해 켜진 것만 요청한다
  client.on(Events.ShardDisconnect, (event) => {
    if (event.code === GatewayCloseCodes.DisallowedIntents) onRefusedWhileRunning(restart);
  });
  startDashboard(bot, { stream, deployCommands: commandLoader.deployCommands, restart });
  listenToPlayers(panels, stream, players);
  followLanguages(panels);
  playerEvents.on("disposed", (player, _reason, end) => stay.onDisposed(player, end));
  // 캐시 파일의 볼륨을 측정했으면 그 곡을 트는 모든 서버가 새 고정 게인으로 램프한다(같은 곡을 여러 서버가 틀 수 있다)
  measureQueue.onMeasured((audioKey) => {
    for (const player of players.values()) player.gain.valueArrived(audioKey);
  });
  playerEvents.on("started", (player) => stay.wake(player.guild.id));
  // 디스코드 명령, 대시보드, 초기화 어느 쪽에서 서버 설정이 바뀌든 그 서버를 보는 대시보드 화면이 설정을 다시 읽는다
  nudgeOnSettingsChange(guildSettings.onChanged, playerEvents.touched);
  // 봇이 새 서버에 들면 대시보드 서버 목록 연결을 연 사람들이 그 서버의 신호도 받게 한다
  client.on(Events.GuildCreate, (guild) => {
    bestEffort(log, botJoinedGuild(stream, guild), L.core.newGuildSubscribersFetch(), "warn");
    bestEffort(log, welcomeGuild(guild), L.core.newGuildWelcome({ guildId: guild.id }), "warn");
  });
  // 게이트웨이에 재연결해 서버를 다시 쓸 수 있게 되면(멤버 캐시를 다시 받는다) 그 서버를 보던 연결의 사람을 다시 가져온다
  client.on(Events.GuildAvailable, (guild) => {
    bestEffort(log, guildBack(stream, guild), L.core.returnedGuildSubscribersFetch(), "warn");
    stay.onGuildAvailable(guild);
  });
  // 봇이 서버에서 나가면 그 서버 멤버였던 사람들의 서버 목록, 초대 화면이 다시 읽게 한다
  client.on(Events.GuildDelete, (guild) => botLeftGuild(stream, guild));

  // 서버 하나 다시 시작. 이벤트 핸들러 경계와 새어 나온 오류 핸들러가 서버를 알면 여기로 보낸다
  const fault = createGuildFaults({ players, restore: (guildId) => restoreGuild(client, players, Player, guildId) });
  const onFault: OnFault = (error, guildId, where) => {
    // 디스코드가 거절한 요청은 다시 시작해도 똑같이 거절된다. 로그만 남긴다
    if (logRejection(error, guildId, where)) return;
    if (guildId) fault(guildId, error, where).catch((e: unknown) => log.error(L.core.guildFaultHandleFailed({ guildId }), e));
    else log.error(L.core.handlerError({ where }), error);
  };

  client.once(Events.ClientReady, (ready) => {
    onReady(ready, bot, skipRestore).catch((error: unknown) => log.error(L.core.startupFinishFailed(), error));
  });
  // 음성 채널 상태는 REST로 읽을 수 없다. 게이트웨이 패킷에서만 알 수 있어 여기서 따라간다.
  // (기동 시 GUILD_CREATE가 현재 값을, 이후 VOICE_CHANNEL_STATUS_UPDATE가 변경을 알려 준다)
  client.on(Events.Raw, (packet) => voiceChannelStatus.consumePacket(packet));
  // 음성 상태 변화: 강제 퇴장, 채널 이동, 음소거, 혼자 남음
  client.on(
    Events.VoiceStateUpdate,
    guarded(L.core.voiceStateEvent(), (oldState: VoiceState, newState: VoiceState) => onVoiceStateUpdate(client, players, oldState, newState), onFault),
  );
  // 새어 나온 오류, 거부, 예외를 구분해 표적 복구하거나 안전 종료한다
  installErrorHandlers(client, { players, fault });
  listenToLibrary(client);

  // 실패는 init이 받아 기동 실패로 내린다
  bestEffort(log, init(bot, { commands, potServer, logFile, shutdown, onFault }), L.core.startupInit(), "error");
}

// 라이브러리(discord.js, REST)가 알리는 경고, 진행. 게이트웨이의 끊김, 연결 오류는 dashboard/status/gateway가 끊김 하나에 한 줄로 남긴다
function listenToLibrary(client: Client) {
  const dlog = logger.child({ category: "discord" });
  watchGateway(client);
  watchGoneGuilds(client);
  watchGatewaySessions(client);
  client.on(Events.Warn, (message) => dlog.warn(L.discord.libraryWarning({ text: message })));
  // 하트비트마다 나오는 양이라 trace
  client.on(Events.Debug, (message) => dlog.trace(L.discord.libraryDebug({ text: message })));
  // 경로마다의 제한은 라이브러리가 줄 세워 기다리는 정상 흐름이다. 전역 제한은 봇 전체가 멈추니 운영자가 알아야 한다
  client.rest.on(RESTEvents.RateLimited, (info) => {
    const line = L.discord.rateLimited({ method: info.method.toUpperCase(), route: info.route, ms: info.timeToReset, global: info.global });
    if (info.global) dlog.warn(line);
    else dlog.debug(line);
  });
  // 거절된 요청(401, 403, 429)이 10분에 1만 번을 넘으면 디스코드가 IP를 한동안 막는다
  client.rest.on(RESTEvents.InvalidRequestWarning, ({ count, remainingTime }) => dlog.warn(L.discord.invalidRequestWarning({ count, seconds: Math.round(remainingTime / 1000) })));
  client.rest.on(RESTEvents.Debug, (message) => dlog.trace(L.discord.restDebug({ text: message })));
}

// 서버 언어가 바뀌면 재생 패널을 다시 그린다. 서버가 고른 언어는 그 서버만, 봇 기본 언어나 쓸 수 있는 언어(테스트 언어 스위치)가 바뀌면 모든 서버
function followLanguages(panels: NowPlayingPanel) {
  guildSettings.onChanged((guildId, fields) => {
    if (fields.includes("language")) void bestEffort(log, panels.redrawLanguage([guildId]), L.core.guildLanguagePanelRedraw(), "warn");
  });
  const shapeOf = () => `${botLanguage()}|${languagesNow().length}`;
  let shape = shapeOf();
  onTunablesChanged(() => {
    const now = shapeOf();
    if (now === shape) return;
    shape = now;
    void bestEffort(log, panels.redrawLanguage(), L.core.botLanguagePanelRedraw(), "warn");
  });
}

// 플레이어의 알림을 화면과 대시보드에 잇는다. 감사 로그 사유는 그 서버의 언어로. 직접 링크 곡의 파일 태그를 찾으면 그 곡을 가진 플레이어마다 반영한다
function listenToPlayers(panels: NowPlayingPanel, stream: ReturnType<typeof createPlayerStream>, players: PlayerRegistry) {
  embeddedArt.onFound((audioKey, found) => {
    for (const player of players.values()) player.takeFileTags(audioKey, found);
  });
  playerEvents.on("refresh", (player) => panels.updatePlaying(player));
  playerEvents.on("ended", (player, reason, cause) => panels.drawEndedPanel(player, { reason, cause }));
  playerEvents.on("started", (player) => player.currentTrack && panels.postPlaying(player, player.currentTrack));
  playerEvents.on("released", (_player, textChannelId) => panels.deleteWebhookCache(textChannelId));
  playerEvents.on("notice", (player, code, detail) => sendNotice(player, code, detail));
  playerEvents.on("touched", (guildId) => stream.notify(guildId));
  playerEvents.on("leaving", (player, leavesAt) => panels.updateIdleLeave(player, leavesAt));
  playerEvents.writeAuditReason((guildId, why) => publicText(guildId).audit[why]());
}

async function onReady(client: Client<true>, bot: BotContext, skipRestore: boolean) {
  const { players, panels, stay } = bot;
  log.info({ tags: ["startup"] }, L.core.botReady({ tag: client.user.tag }));
  log.info(L.core.guildsWaiting({ count: client.guilds.cache.size }));
  new BotPresence(client).start(); // 활동 문구
  // 스포티파이 익명 상태와 토큰(첫 자동완성이 스포티파이를 쓰게). 저장해 둔 것이 쓸 만하면 요청하지 않는다
  void spotifySource.prepareAnonymous();

  // 앱 이모지(아이콘): 목록 하나로 이름 → id를 패널을 그리는 무엇보다 먼저 싣는다(세션 복원도 재생 패널을 올린다).
  // 늦으면 패널이 유니코드로 올라갔다가 다음 갱신에 앱 이모지로 바뀐다. 실패하면 경고만 남기고 유니코드로 간다
  // 아이콘 id가 바뀌면(운영자 색) 대기 패널과 음성 채널 상태를 다시 그린다. 옛 것을 지우기 전이라 옛 id를 가리키는 것이 남지 않는다
  const redrawEmojis = async () => {
    for (const player of players.values()) player.refreshVoiceStatus();
    await panels.redrawIdlePanels();
  };
  const appEmojis = new AppEmojis(apiOf(client), { onChanged: redrawEmojis, protectedIds: uploadedIds, forget: keepUploaded, remember: addUploaded });
  bot.appEmojis = appEmojis;
  await appEmojis.loadKnown();
  // 캐시 정리는 복원 앞에. 정리는 이전 실행이 남긴 것(다운로드하다 만 행, 고아 파일)을 다루는데, 복원이 곡을 틀기 시작한 뒤에 돌면
  // 이번 실행이 다운로드하기 시작한 행까지 다운로드하다 만 것으로 되돌린다. 복원될 곡은 퇴거, 고아 청소 모두 저장된 세션을 보고 지킨다
  await cleanupAudioCache();
  log.debug(L.core.sessionRestoreStarted());
  const touched = await restoreSessions(client, players, Player, { skip: skipRestore });
  // 세션 없이 음성 채널에 남아 있던 봇(곡 없이 끔)을 이어받는다. 복원이 손댄 서버는 건드리지 않는다
  await adoptLingeringVoice(client, players, Player, { touched });
  // 24/7 자리에 붙어 있지 않은 서버를 하나씩. 패널 복원보다 먼저(자리에서 기다리는 끝난 패널을 정지 모양으로 덮지 않게)
  await stay.boot({ skip: skipRestore });
  // 기록된 패널을 지금 상태로. 세션을 복원한 서버는 이미 새로 올렸다
  await panels.restorePanels({ skip: skipRestore });
  // 이미지 비교, 업로드, 삭제는 백그라운드에서(운영자 색이 바뀌면 다시)
  appEmojis.start();
  log.info({ tags: ["startup"] }, L.core.sessionRestoreDone());
}

// 기동 시 오디오 캐시 정리(중단된 다운로드, 고아 파일, 퇴거)
async function cleanupAudioCache() {
  try {
    await audioCache.onStartup();
  } catch (error) {
    log.error(L.core.audioCacheStartupCleanFailed({ error: messageOf(error) }));
  }
}

// 언어 모듈에서 빠졌거나 형식이 맞지 않아 기준 언어로 채운 문구(봇 ui/text, 규칙 rules/text, 로그 infra/log/text). 저장소의 언어는 타입 검사가 막아 비어 있다.
// 로그 문구 진입점은 로그를 부르지 않으므로(빠진 문구를 알리면 그 글이 다시 진입점을 부른다) 기동 때 여기서 알린다
function warnMissingText() {
  [missingText(), missingRuleText(), missingLogText()].forEach((missing, kind) => {
    for (const [language, keys] of missing) {
      log.warn({ tags: ["startup"] }, L.core.textFilledFromBase({ language, kind: [L.core.textKindBot(), L.core.textKindRule(), L.core.textKindLog()][kind], count: keys.length, base: BASE_LANGUAGE, keys: keys.slice(0, 10).join(", "), rest: keys.length - 10 }));
    }
  });
}

async function init(bot: BotContext, { commands, potServer, logFile, shutdown, onFault }: { commands: Map<string, SlashCommand>; potServer: PotServer; logFile: LogFile | null; shutdown: Shutdown; onFault: OnFault }) {
  const { client, players } = bot;
  try {
    log.info({ tags: ["startup"] }, L.core.startupStarted());
    warnMissingText();
    checkBeforeLogin();
    await startEncoding();
    loadCommands(commands);
    commandLoader.followEnabledCommands(() => loadCommands(commands), deploySlashCommands);
    loadEvents(bot, onFault);
    // 이제부터 끄면 세션을 저장하고 연결, 봇까지 정리한다
    shutdown.attach({ client, players, stay: bot.stay, restartNotices: () => restartNotices(bot) });
    await loginWithRetry(client, config.discord.token);
  } catch (error) {
    const stopped = error instanceof StartupStopped;
    if (!stopped) log.error(L.core.startupFailed(), error);
    if (codeOf(error) === "DisallowedIntents") log.error(refusedAtLogin());
    stopFailedStart(client, { potServer, logFile }, failedStartCode(error, stopped));
  }
}

// 로그인 전에 확인할 것. 하나라도 안 되면 멈춘다
function checkBeforeLogin() {
  // 재생, 캐시 변환이 모두 ffmpeg에 의존하므로 여기서 확정하고 기록한다. 못 찾으면 여기서 기동을 멈춘다
  stopIfThrows(() => logResolvedFfmpeg());
  // 지금 설치본이 실행되지 않아 이전 설치본으로 떴으면 기록을 되돌린다(다음 기동 때 같은 빌드를 다시 받지 않게)
  void bestEffort(log, settleRejectedFfmpeg(), L.core.ffmpegRecordRevert(), "warn");
  // 능력 확인(spawnSync 셋)도 여기서 해 둔다. 처음 곡을 틀 때 부르면 그동안 이벤트 루프가 멈춰 다른 서버의 음성이 밀린다
  ffmpegCapabilities();
  // yt-dlp도 재생과 같은 ffmpeg를 쓴다
  ytdlpOptions.useFfmpeg(ffmpegPath);
  // 캐시 폴더와 정기 퇴거. DB는 기동 첫머리에 열었다(openSettings)
  audioCache.initialize();
  // 음성 채널 상태 중 봇이 쓴 것. 다시 시작 전에 쓴 것도 계속 갱신하려면 게이트웨이에 붙기 전에 읽어 둔다
  voiceChannelStatus.keepIn(voiceStatusStore);

  // 지금 무엇으로 유튜브에 붙는지 한 줄. 없으면 POToken 서버가 죽어 있어도 모르고 지나간다.
  youtubeSource.logAuthMode();
  // yt-dlp 버전을 한 줄 남기고 설정대로 새 버전을 본다. 기동을 막지 않는다(그동안은 설치 때 다운로드한 것으로 돈다)
  bestEffort(log, ytdlpBinary.start(), L.core.ytdlpVersionAlign(), "warn");
  // 채널, 모드, 고정이 바뀌면(yt-dlp 카드, 설정 불러오기, 초기화) 새 설정으로 다시 맞춘다
  onTunablesChanged(() => void bestEffort(log, ytdlpBinary.onSettingsChanged(), L.core.ytdlpSettingsApply(), "warn"));
  // CPU 상한이 걸려 있으면 yt-dlp 동시 실행 수가 제한되어 곡 찾기가 차례를 기다릴 수 있다
  const cpu = ytdlpCpuLimit();
  if (cpu) log.info({ tags: ["startup"] }, L.core.ytdlpConcurrency({ slots: cpu.slots, cores: cpu.quota.toFixed(1) }));
  // bgutil이 설정한 버전과 다르게 설치돼 있으면 알린다
  warnOffTarget();
  // POToken 서버 사용을 켰는데 설치돼 있지 않으면 알아서 설치한다(기동 준비가 끝나 작업 자리가 빈 뒤라 여기서). 켜기를 저장하거나 다른 작업이 끝날 때도 다시 판정한다
  bestEffort(log, bgutilAutoInstall.ensure("startup"), L.core.bgutilAutoInstallCheck(), "warn");
  onTunablesChanged(() => void bgutilAutoInstall.ensure("settings"));
  onJobIdle(() => void bgutilAutoInstall.ensure("idle"));

  // 자동재생, 활동 문구 설정을 여기서 한 번 읽는다. 읽는 쪽이 쓸 때뿐이라 그대로 두면 틀린 설정, 키가 빠진 소스 경고가
  // 그때서야 나와 기동 로그에 안 남는다. 틀렸으면 알리고 그 기능만 끈다(기동은 멈추지 않는다. 고칠 대시보드가 떠야 한다)
  genres();
  statusConfig.status();
}

// 재생 인코더(WASM)를 불러 둔다. 못 불러오면 재생할 수 없으니 멈춘다. 불러 두지 않으면 첫 곡을 틀 때 모듈을 컴파일한다
// 첫 인코딩 워커를 띄워 libopus까지 불러 둔다. 워커는 재생이 늘면 상한까지 늘어난다
async function startEncoding() {
  try {
    const { libopusVersion, max, quota } = await encodePool.start();
    const limit = quota ? L.core.encoderLimitWithQuota({ max, quota: quota.toFixed(1) }) : L.core.encoderLimit({ max });
    log.info({ tags: ["startup"] }, L.core.opusEncoderReady({ version: libopusVersion, limit }));
  } catch (error) {
    log.error(L.core.opusEncoderLoadFailed({ error: messageOf(error) }));
    throw new StartupStopped(messageOf(error), { cause: error });
  }
}

function stopIfThrows(check: () => unknown, hint: LogText | null = null) {
  try {
    check();
  } catch (error) {
    log.error(L.core.startupCheckFailed({ error: errorText(error) }));
    if (hint) log.error(hint);
    throw new StartupStopped(messageOf(error), { cause: error });
  }
}

function loadCommands(commands: Map<string, SlashCommand>) {
  const enabled = commandLoader.enabledCommands();
  commands.clear();
  for (const command of enabled) commands.set(command.name, command);
  log.info({ tags: ["startup"] }, L.core.commandsReady({ count: enabled.length }));
}

function loadEvents(bot: BotContext, onFault: OnFault) {
  const { client } = bot;
  const events = EVENTS as readonly EventModule[];
  for (const event of events) {
    const register = <K extends keyof ClientEvents>(name: K, listener: (...args: ClientEvents[K]) => unknown) => (event.once ? client.once(name, listener) : client.on(name, listener));
    // 핸들러마다 서버 경계로 감싼다(app/event-boundary). 새어 나온 오류는 그 서버의 오류로 받는다
    register(
      event.name,
      guarded(L.core.eventHandler({ name: event.name }), (...args: unknown[]) => event.execute(bot, ...args), onFault),
    );
  }
  log.info({ tags: ["startup"] }, L.core.eventHandlersRegistered({ count: events.length }));
}

export { main };
export type { ClientEvent, AnyClientEvent };
