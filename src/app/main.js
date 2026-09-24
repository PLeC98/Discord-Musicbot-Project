// 봇 조립. index.js 가 설정 문제를 본 뒤 main() 을 부른다(설정 검사가 구조적으로 먼저 돈다).
// 로그 → 슬래시 명령 배포 → POToken 서버 → 클라이언트 · 화면 · 대시보드 → 처리기 → 기동 확인 → 로그인.

import path from "path";
import { Client, GatewayIntentBits, Collection, Events } from "discord.js";
import logSink from "../infra/log/sink.ts";
import logger from "../infra/log/logger.ts";
import config from "../../config.ts";
import * as audioCache from "../store/audioCache.ts";
import { logResolved as logResolvedFfmpeg, ffmpegPath } from "../media/ffmpeg/path.ts";
import MusicPlayer from "../player/Player.js";
import sessionRestore from "../player/sessionRestore.js";
const { restoreSavedPlayers } = sessionRestore;
import voiceChannelStatus from "../player/voiceChannelStatus.js";
import voicePresence from "../player/voicePresence.js";
const { onVoiceStateUpdate } = voicePresence;
import PlayerRegistry from "../player/registry.js";
import { createPotServer } from "../sources/youtube/potServer.ts";
import * as YouTube from "../sources/youtube/index.ts";
import { genres } from "../config/genres.ts";
import * as statusConfig from "../config/status.ts";
import moduleLoader from "./moduleLoader.js";
const { loadModules } = moduleLoader;
import commandLoader from "./commandLoader.js";
import resilience from "./resilience.js";
const { installErrorHandlers } = resilience;
import shutdown from "./shutdown.js";
const { installShutdown } = shutdown;
import replyLifetime from "../ui/replyLifetime.js";
const { scheduleReplyCleanup } = replyLifetime;
import mentions from "../ui/mentions.js";
const { ALLOWED_MENTIONS } = mentions;
import MusicEmbedManager from "../ui/nowPlayingPanel.js";
import StatusManager from "../ui/botPresence.js";
import { createFileDestination } from "../infra/log/file.ts";
import server from "../../dashboard/server/index.js";
const { startDashboard } = server;
import playerStream from "../../dashboard/server/playerStream.js";
const { createPlayerStream } = playerStream;
import playerEvents from "../player/events.js";
import playerNotices from "../ui/playerNotices.js";
const { sendNotice } = playerNotices;

const log = logger.child({ category: "core" });
const ROOT = path.join(import.meta.dirname, "..", "..");

function main() {
  const logFile = setUpLogging();
  deploySlashCommands();

  // 유튜브 POToken 서버. 준비를 확인한 뒤 봇을 켠다
  const potServer = createPotServer();
  potServer.start();
  potServer.waitReady().then(() => startBot({ potServer, logFile }));
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
  commandLoader.deployCommands().then((r) => {
    if (r.ok && r.skipped) log.info(`명령어 정의 ${r.count}개가 바뀌지 않았습니다. 등록을 건너뜁니다. (강제 재배포: pnpm run cmddeploy)`);
    else if (r.ok) log.info(`${r.count}개 슬래시 명령어를 ${r.scope === "guild" ? `서버 ${r.guildId}에` : "전역으로"} 배포했습니다.`);
    else commandLoader.deployErrorLines(r).forEach((line) => log.error(line));
  });
}

function startBot({ potServer, logFile }) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
    // 외부에서 온 트랙 제목·파일명이 content에 실려도 멘션이 발동하지 않게 (src/ui/mentions.js)
    allowedMentions: ALLOWED_MENTIONS,
  });
  client.commands = new Collection();
  client.players = new PlayerRegistry(); // 등록·해제를 로그로 남기는 Collection
  client.musicEmbedManager = new MusicEmbedManager(client);
  const stream = createPlayerStream();
  startDashboard(client, { stream, deployCommands: commandLoader.deployCommands });
  listenToPlayers(client.musicEmbedManager, stream);

  client.once(Events.ClientReady, () => onReady(client));
  // 음성 채널 상태는 REST로 읽을 수 없다. 게이트웨이 패킷에서만 알 수 있어 여기서 따라간다.
  // (기동 시 GUILD_CREATE가 현재 값을, 이후 VOICE_CHANNEL_STATUS_UPDATE가 변경을 알려 준다)
  client.on(Events.Raw, (packet) => voiceChannelStatus.consumePacket(packet));
  // 음성 상태 변화: 강제 퇴장 · 채널 이동 · 음소거 · 혼자 남음
  client.on(Events.VoiceStateUpdate, (oldState, newState) => onVoiceStateUpdate(client, oldState, newState));
  // 새어 나온 오류 · 거부 · 예외를 가려 표적 복구하거나 안전 종료한다
  installErrorHandlers(client);

  init(client, { potServer, logFile });
}

// 플레이어의 알림을 화면과 대시보드에 잇는다
function listenToPlayers(panels, stream) {
  playerEvents.on("refresh", (player) => panels.updateNowPlayingEmbed(player));
  playerEvents.on("ended", (player, reason) => panels.handlePlaybackEnd(player, { reason }));
  playerEvents.on("started", (player, requester) => panels.createNewMusicEmbed(player, player.currentTrack, requester));
  playerEvents.on("released", (_player, textChannelId) => panels.deleteWebhookCache(textChannelId));
  playerEvents.on("notice", (player, code, detail) => sendNotice(player, code, detail));
  playerEvents.on("touched", (guildId) => stream.notify(guildId));
}

async function onReady(client) {
  log.info({ tags: ["startup"] }, `${client.user.tag} 준비 완료`);
  log.info(`서버 ${client.guilds.cache.size}개에서 대기 중`);
  new StatusManager(client).start(); // 활동 문구

  log.debug("세션 복원 시작");
  await restoreSavedPlayers(client, MusicPlayer);
  // 기록된 패널을 지금 상태로. 세션을 복원한 서버는 이미 새로 올렸다
  await client.musicEmbedManager?.restorePanels();
  // 캐시 정리는 세션 복원 뒤에 - 복원된 세션이 참조하는 파일이 고아로 오인되지 않도록
  await cleanupAudioCache();
  log.info({ tags: ["startup"] }, "저장된 세션 복원 완료");
}

// 기동 시 오디오 캐시 정리(중단된 받기 · 고아 파일 · 퇴거)
async function cleanupAudioCache() {
  try {
    await audioCache.onStartup();
  } catch (error) {
    log.error("오디오 캐시 기동 정리 실패:", error.message);
  }
}

async function init(client, { potServer, logFile }) {
  try {
    log.info({ tags: ["startup"] }, "봇 구동을 시작합니다.");
    checkBeforeLogin();
    await loadCommands(client);
    await loadEvents(client);
    // 종료 신호를 받으면 저장하고 정리한 뒤 나간다
    installShutdown(client, { potServer, logFile });
    await client.login(config.discord.token);
  } catch (error) {
    log.error("봇 기동 실패:", error);
    process.exit(1);
  }
}

// 로그인 전에 확인할 것. 하나라도 안 되면 멈춘다
function checkBeforeLogin() {
  // 재생·캐시 변환이 모두 ffmpeg에 의존하므로 여기서 확정하고 기록한다. 못 찾으면 여기서 기동을 멈춘다
  stopIfThrows(() => logResolvedFfmpeg());
  // yt-dlp 도 재생과 같은 ffmpeg 를 쓴다
  YouTube.useFfmpeg(ffmpegPath);
  // 캐시 DB 구조가 이 버전과 맞지 않으면 여기서 멈춘다
  stopIfThrows(() => audioCache.initialize());

  // 지금 무엇으로 유튜브에 붙는지 한 줄. 이걸 안 남겨서 bgutil이 3개월간 죽어 있는 걸 몰랐다.
  YouTube.logAuthMode();

  // 자동재생 설정을 여기서 한 번 읽는다. 읽는 쪽이 자동재생을 쓸 때뿐이라 그대로 두면
  // 잘못된 설정이 "켰더니 아무 일도 안 일어난다"로 나타나고, 키가 빠진 소스 경고도
  // 그때서야 나와 기동 로그에 안 남는다.
  stopIfThrows(() => genres(), "config/genres.yaml 을 고친 뒤 다시 실행하세요.");
  // 활동 문구 설정도 여기서 본다. 틀린 채로 뜨면 쓸 설정이 없다(돌던 중에 틀리면 직전 설정으로 돈다)
  stopIfThrows(() => statusConfig.status(), "config/status.yaml 을 고친 뒤 다시 실행하세요.");
}

function stopIfThrows(check, hint = null) {
  try {
    check();
  } catch (error) {
    log.error(error.message);
    if (hint) log.error(hint);
    process.exit(1);
  }
}

// 로딩 실패는 기동을 멈춘다. 핸들러가 빠진 채로 로그인하면 운영자는 그걸 정상으로 본다.
function abortOnLoadFailure(what, failures) {
  if (failures.length === 0) return;
  for (const { file, error } of failures) log.error(`${what} 로딩 실패: ${file}`, error?.stack || error?.message || error);
  log.error(`${what} ${failures.length}개를 불러오지 못해 기동을 멈춥니다.`);
  process.exit(1);
}

async function loadCommands(client) {
  const { commands, failures, missing } = await commandLoader.loadedCommands();
  if (missing) return log.warn("commands 디렉터리가 없어 명령어 로딩을 건너뜁니다.");

  abortOnLoadFailure("슬래시 명령어", failures);
  for (const { command } of commands) client.commands.set(command.data.name, command);
  log.info({ tags: ["startup"] }, `슬래시 명령어 ${commands.length}개 준비 완료`);
}

// 상호작용 핸들러가 끝나면 본인에게만 보이는 응답의 수명을 건다(src/ui/replyLifetime.js). 핸들러의 결과·오류는 그대로 돌려준다.
const withReplyCleanup =
  (execute) =>
  (interaction, ...rest) => {
    const done = execute(interaction, ...rest);
    const schedule = () => scheduleReplyCleanup(interaction);
    Promise.resolve(done).then(schedule, schedule);
    return done;
  };

async function loadEvents(client) {
  const { modules, failures, missing } = await loadModules(path.join(ROOT, "events"));
  if (missing) return log.warn("events 디렉터리가 없어 기본 이벤트로 진행합니다.");

  abortOnLoadFailure("이벤트 핸들러", failures);
  for (const { module: event } of modules) {
    const run = event.name === Events.InteractionCreate ? withReplyCleanup(event.execute.bind(event)) : (...args) => event.execute(...args);
    if (event.once) client.once(event.name, run);
    else client.on(event.name, run);
  }
  log.info({ tags: ["startup"] }, `이벤트 핸들러 ${modules.length}개 등록 완료`);
}

const exported = { main };
export default exported;
export { exported as "module.exports" };
