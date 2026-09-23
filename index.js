const logSink = require("./src/infra/log/sink"); // 다른 무엇보다 먼저 콘솔을 가로챈다
const log = require("./src/infra/log/logger").child({ category: "core" });
const config = require("./config");

// 설정 문제는 여기서 찍고 멈춘다. config 는 불러와도 멈추지 않고 목록만 낸다
require("./src/app/configCheck").stopOnConfigProblems(config, require("./src/infra/log/logger").child({ category: "config" }));

const { Client, GatewayIntentBits, Collection, Events } = require("discord.js");
const { getVoiceConnections } = require("@discordjs/voice");
const path = require("path");
const audioCache = require("./src/store/audioCache");
const procRegistry = require("./src/infra/processRegistry");
const { logResolved: logResolvedFfmpeg } = require("./src/media/ffmpeg/path");
const MusicPlayer = require("./src/player/Player");
const { restoreSavedPlayers } = require("./src/player/sessionRestore");
const voiceChannelStatus = require("./src/player/voiceChannelStatus");
const { onVoiceStateUpdate } = require("./src/player/voicePresence");
const { isDeadInteraction } = require("./src/rules/deadInteraction");
const { createPotServer } = require("./src/sources/youtube/potServer");
const { loadModules } = require("./src/app/moduleLoader");
const { scheduleReplyCleanup } = require("./src/ui/replyLifetime");
const PlayerRegistry = require("./src/player/registry");
const { ALLOWED_MENTIONS } = require("./src/ui/mentions");
const { createFileDestination } = require("./src/infra/log/file");
const statusConfig = require("./src/config/status");

// 로그 레벨 적용. config를 읽은 직후. 이보다 앞선 레코드(config 검증 경고 등)는
// 기본 레벨(info)로 이미 기록됐다. 그것들은 어차피 warn 이상이라 잘려나갈 일이 없다.
require("./src/infra/log/logger").level = config.logging.level;
if (config.logging.consoleLevel) logSink.setConsoleLevel(config.logging.consoleLevel);

// 파일 로그 마운트. config를 읽은 직후, 기동 로그가 쏟아지기 전에.
// 이 지점보다 앞선 레코드(config 검증 경고 등)는 sink가 모아뒀다가 여기서 재생한다.
const logFile = config.logging.fileEnabled ? createFileDestination(config.logging) : null;
if (logFile) {
  logSink.addDestination(logFile.write);
  log.info({ tags: ["startup"] }, `로그 파일 저장 경로: ${logFile.path}`);
}

// 슬래시 명령어 배포
{
  const { deployCommands, deployErrorLines } = require("./src/app/commandLoader");
  log.debug("슬래시 명령어 배포를 시작합니다.");
  deployCommands().then((r) => {
    if (r.ok && r.skipped) log.info(`명령어 정의 ${r.count}개가 바뀌지 않았습니다. 등록을 건너뜁니다. (강제 재배포: pnpm run cmddeploy)`);
    else if (r.ok) log.info(`${r.count}개 슬래시 명령어를 ${r.scope === "guild" ? `서버 ${r.guildId}에` : "전역으로"} 배포했습니다.`);
    else deployErrorLines(r).forEach((line) => log.error(line));
  });
}

// 기동 시 오디오 캐시 정리(중단된 받기 · 고아 파일 · 퇴거)
async function cleanupAudioCache() {
  try {
    await audioCache.onStartup();
  } catch (error) {
    log.error("오디오 캐시 기동 정리 실패:", error.message);
  }
}

// 유튜브 POToken 서버. 준비를 확인한 뒤 봇을 켠다(맨 아래)
const potServer = createPotServer();
potServer.start();

// uncaughtException 복원력 헬퍼 (분류/표적 자가치유/빈도 가드/안전 종료). src/app/resilience.js
const { isTransientNetworkError, healBrokenPlayers, networkErrorFlooding, unknownRejectionFlooding, unknownClientErrorFlooding, ignorableDiscordError, fatalShutdown, NET_ERR_WINDOW_MS, NET_ERR_MAX } = require("./src/app/resilience");

function startBot() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
    // 외부에서 온 트랙 제목·파일명이 content에 실려도 멘션이 발동하지 않게 (src/ui/mentions.js)
    allowedMentions: ALLOWED_MENTIONS,
  });

  // Collections for commands and music players
  client.commands = new Collection();
  client.players = new PlayerRegistry(); // 등록·해제를 로그로 남기는 Collection

  // Initialize Music Embed Manager
  const MusicEmbedManager = require("./src/ui/nowPlayingPanel");
  client.musicEmbedManager = new MusicEmbedManager(client);

  // Start dashboard server
  {
    const { startDashboard } = require("./dashboard/server/index");
    startDashboard(client);
  }

  // 로딩 실패는 기동을 멈춘다. 핸들러가 빠진 채로 로그인하면 운영자는 그걸 정상으로 본다.
  const abortOnLoadFailure = (what, failures) => {
    if (failures.length === 0) return;
    for (const { file, error } of failures) log.error(`${what} 로딩 실패: ${file}`, error?.stack || error?.message || error);
    log.error(`${what} ${failures.length}개를 불러오지 못해 기동을 멈춥니다.`);
    process.exit(1);
  };

  const loadCommands = () => {
    const { commands, failures, missing } = require("./src/app/commandLoader").loaded;
    if (missing) return log.warn("commands 디렉터리가 없어 명령어 로딩을 건너뜁니다.");

    abortOnLoadFailure("슬래시 명령어", failures);
    for (const { command } of commands) client.commands.set(command.data.name, command);
    log.info({ tags: ["startup"] }, `슬래시 명령어 ${commands.length}개 준비 완료`);
  };

  // 상호작용 핸들러가 끝나면 본인에게만 보이는 응답의 수명을 건다(src/ui/replyLifetime.js). 핸들러의 결과·오류는 그대로 돌려준다.
  const withReplyCleanup =
    (execute) =>
    (interaction, ...rest) => {
      const done = execute(interaction, ...rest);
      const schedule = () => scheduleReplyCleanup(interaction);
      Promise.resolve(done).then(schedule, schedule);
      return done;
    };

  const loadEvents = () => {
    const { modules, failures, missing } = loadModules(path.join(__dirname, "events"));
    if (missing) return log.warn("events 디렉터리가 없어 기본 이벤트로 진행합니다.");

    abortOnLoadFailure("이벤트 핸들러", failures);
    for (const { module: event } of modules) {
      const run = event.name === Events.InteractionCreate ? withReplyCleanup(event.execute.bind(event)) : (...args) => event.execute(...args);
      if (event.once) client.once(event.name, run);
      else client.on(event.name, run);
    }
    log.info({ tags: ["startup"] }, `이벤트 핸들러 ${modules.length}개 등록 완료`);
  };

  // Basic ready event
  client.once(Events.ClientReady, async () => {
    log.info({ tags: ["startup"] }, `${client.user.tag} 준비 완료`);
    log.info(`서버 ${client.guilds.cache.size}개에서 대기 중`);

    // Set bot activity
    const StatusManager = require("./src/ui/botPresence");
    if (!client.statusManager) {
      client.statusManager = new StatusManager(client);
      client.statusManager.start();
    }

    log.info("캐시 DB 로드 대기 중");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await client.restoreSessions();
  });

  client.restoreSessions = async function () {
    log.debug("세션 복원 시작");
    await restoreSavedPlayers(client, MusicPlayer);
    // 기록된 패널을 지금 상태로. 세션을 복원한 서버는 이미 새로 올렸다
    await client.musicEmbedManager?.restorePanels();
    // 캐시 정리는 세션 복원 뒤에 - 복원된 세션이 참조하는 파일이 고아로 오인되지 않도록
    await cleanupAudioCache();
    log.info({ tags: ["startup"] }, "저장된 세션 복원 완료");
  };

  // 음성 채널 상태는 REST로 읽을 수 없다. 게이트웨이 패킷에서만 알 수 있어 여기서 따라간다.
  // (기동 시 GUILD_CREATE가 현재 값을, 이후 VOICE_CHANNEL_STATUS_UPDATE가 변경을 알려 준다)
  client.on(Events.Raw, (packet) => voiceChannelStatus.consumePacket(packet));

  // 음성 상태 변화: 강제 퇴장 · 채널 이동 · 음소거 · 혼자 남음(src/player/voicePresence.js)
  client.on(Events.VoiceStateUpdate, (oldState, newState) => onVoiceStateUpdate(client, oldState, newState));

  // 프로세스 종료는 init() 내부에 등록된 gracefulShutdown에 의해 처리

  // 리스너·프로미스 밖으로 새어나온 오류의 등급 판정. client "error"와 unhandledRejection이 같은 기준을 쓴다.
  // true = 알려진 오류라 처리 완료, false = 알 수 없음(호출부가 빈도 가드로 판단).
  const handleLooseError = (error, source) => {
    const known = ignorableDiscordError(error);
    if (known) {
      if (known.level === "error") log.error(known.message);
      else log.info(known.message);
      return true;
    }

    // 일시적 네트워크/음성 오류(IP discovery 실패 등). 연결이 끊긴 서버만 표적 복구(정상 재생 중인 다른 서버는 무영향).
    if (isTransientNetworkError(error)) {
      log.warn(`네트워크/음성 오류(${source}): 연결이 끊긴 서버의 복구를 시도합니다.`);
      healBrokenPlayers(client).catch(() => {});
      return true;
    }
    return false;
  };

  // discord.js v14의 AsyncEventEmitter는 async 리스너의 rejection을 잡아 client "error"로 다시 던진다.
  // 리스너가 없으면 그 throw가 타이머 콜백에서 터져 unhandledRejection이 아니라 uncaughtException이 되고,
  // 알 수 없는 오류는 곧바로 안전 종료로 간다. 리스너 하나의 사소한 rejection이 봇 전체를 내린다.
  client.on(Events.Error, (error) => {
    log.error("클라이언트 오류:", error);
    if (handleLooseError(error, "client")) return;

    if (unknownClientErrorFlooding()) {
      log.error(`${NET_ERR_WINDOW_MS / 1000}초 동안 알 수 없는 클라이언트 오류가 ${NET_ERR_MAX}회 발생해 봇을 안전 종료합니다.`);
      fatalShutdown(client, error instanceof Error ? error : new Error(String(error)));
    }
  });

  // 오류 처리
  process.on("unhandledRejection", (reason) => {
    log.error("처리되지 않은 rejection:", reason);

    if (handleLooseError(reason, "rejection")) return;

    // 알 수 없는 rejection. 단발은 위 로그만 남기고 계속(사소한 catch 누락이 봇 전체 다운으로
    // 번지지 않게). 짧은 시간창에 반복되면 좀비 루프/시스템적 이상으로 보고 안전 종료
    // (uncaughtException의 네트워크 폭주 가드와 같은 방침)
    if (unknownRejectionFlooding()) {
      log.error(`${NET_ERR_WINDOW_MS / 1000}초 동안 알 수 없는 거부가 ${NET_ERR_MAX}회 발생해 봇을 안전 종료합니다.`);
      fatalShutdown(client, reason instanceof Error ? reason : new Error(String(reason)));
    }
  });

  process.on("uncaughtException", (error) => {
    log.error("처리되지 않은 예외:", error);

    // Discord 상호작용 오류. 무해, 계속
    if (isDeadInteraction(error)) {
      log.info("디스코드 상호작용 오류: 봇의 동작에는 영향이 없습니다.");
      return;
    }

    // 일시적 네트워크 오류. 프로세스는 살리고 "영향받은 서버만" 표적 복구. 짧은 시간에 폭주하면(빈도 가드) 시스템적 이상으로 보고 안전 종료
    if (isTransientNetworkError(error)) {
      if (!networkErrorFlooding()) {
        log.warn("네트워크 오류: 연결이 끊긴 서버의 복구를 시도합니다. 봇은 계속 실행됩니다.");
        healBrokenPlayers(client).catch(() => {});
        return;
      }
      log.error(`${NET_ERR_WINDOW_MS / 1000}초 동안 네트워크 오류가 ${NET_ERR_MAX}회 발생해 봇을 안전 종료합니다.`);
    }

    // 그 외(또는 네트워크 폭주) = 치명적 → 안전 종료
    fatalShutdown(client, error);
  });

  // Initialize bot
  const init = async () => {
    try {
      log.info({ tags: ["startup"] }, "봇 구동을 시작합니다.");

      // 재생·캐시 변환이 모두 ffmpeg에 의존하므로 여기서 확정하고 기록한다.
      // 못 찾으면 여기서 기동을 멈춘다
      try {
        logResolvedFfmpeg();
      } catch (error) {
        log.error(`${error.message}`);
        process.exit(1);
      }

      // 캐시 DB 구조가 이 버전과 맞지 않으면 여기서 멈춘다
      try {
        audioCache.initialize();
      } catch (error) {
        log.error(error.message);
        process.exit(1);
      }

      // 지금 무엇으로 유튜브에 붙는지 한 줄. 이걸 안 남겨서 bgutil이 3개월간 죽어 있는 걸 몰랐다.
      require("./src/sources/youtube/index").logAuthMode();

      // 자동재생 설정을 여기서 한 번 읽는다. 읽는 쪽이 자동재생을 쓸 때뿐이라 그대로 두면
      // 잘못된 설정이 "켰더니 아무 일도 안 일어난다"로 나타나고, 키가 빠진 소스 경고도
      // 그때서야 나와 기동 로그에 안 남는다.
      try {
        require("./src/config/genres").genres();
      } catch (error) {
        log.error(error.message);
        log.error("config/genres.yaml 을 고친 뒤 다시 실행하세요.");
        process.exit(1);
      }

      // 활동 문구 설정도 여기서 본다. 틀린 채로 뜨면 쓸 설정이 없다(돌던 중에 틀리면 직전 설정으로 돈다)
      try {
        statusConfig.status();
      } catch (error) {
        log.error(error.message);
        log.error("config/status.yaml 을 고친 뒤 다시 실행하세요.");
        process.exit(1);
      }

      // Load commands and events
      loadCommands();
      loadEvents();

      // Graceful shutdown handler
      const gracefulShutdown = async (signal) => {
        // Save all active player states before shutdown
        const savePromises = [];
        for (const [guildId, player] of client.players) {
          if (player && typeof player.persistState === "function") {
            savePromises.push(
              player.persistState("shutdown", true).catch((err) => {
                log.error(`세션 저장 실패 (서버 ID ${guildId}):`, err);
              }),
            );
          }
        }
        await Promise.all(savePromises);

        // 실제 음성 연결을 기준으로 정리한다.
        // client.players를 돌면 레지스트리에 없는 연결이 그대로 남아, 프로세스가 죽은 뒤에도
        // 봇이 음성 채널에 유령으로 남는다. 재시작하면 "봇은 음성에 있는데 플레이어가 없는" 상태가 된다.
        for (const [guildId, connection] of getVoiceConnections()) {
          const name = client.guilds.cache.get(guildId)?.name ?? guildId;
          const orphan = client.players.has(guildId) ? "" : " | 레지스트리에 없던 연결";
          try {
            connection.destroy();
            log.info(`음성 채널 떠남: ${name} | 원인=프로세스 종료(${signal})${orphan}`);
          } catch (error) {
            log.error(`음성 연결 정리 실패: ${name}`, error);
          }
        }
        client.destroy();
        potServer.stop();

        // 진행 중이던 yt-dlp/FFmpeg를 자손까지 정리한다.
        // 이게 없으면 Windows에서는 봇만 죽고 ffmpeg가 남아 (라이브 등) 무한 다운로드를 계속한다.
        procRegistry.killAll(signal || "shutdown");

        if (logFile) logFile.close();
        process.exit(0);
      };

      // Register shutdown handlers
      process.on("SIGINT", () => gracefulShutdown("SIGINT"));
      process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
      process.on("SIGHUP", () => gracefulShutdown("SIGHUP")); // terminal close / SSH disconnect

      // Windows specific handlers
      if (process.platform === "win32") {
        const readline = require("readline");
        if (process.stdin.isTTY) {
          readline
            .createInterface({
              input: process.stdin,
              output: process.stdout,
            })
            .on("SIGINT", () => gracefulShutdown("SIGINT"));
        }
      }

      // Login to Discord
      await client.login(config.discord.token);
    } catch (error) {
      log.error("봇 기동 실패:", error);
      process.exit(1);
    }
  };

  // Start the bot
  init();
}

// bgutil 준비를 확인한 뒤 기동
potServer.waitReady().then(startBot);
