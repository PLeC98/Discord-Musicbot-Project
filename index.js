require("./src/LogManager"); // intercept console before anything else logs
const log = require("./src/logger").child({ category: "core" });
const { Client, GatewayIntentBits, Collection, Events } = require("discord.js");
const { getVoiceConnection } = require("@discordjs/voice");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const CacheManager = require("./src/CacheManager");
const MusicPlayer = require("./src/MusicPlayer");
const chalk = require("chalk");
const { isPrimaryShard } = require("./src/shardUtil");

// 슬래시 명령어 배포
if (isPrimaryShard()) {
  const { deployCommands, deployErrorLines } = require("./src/commandLoader");
  log.info("🚀 슬래시 명령어 배포를 시작합니다.");
  deployCommands().then((r) => {
    if (r.ok && r.skipped) log.info(chalk.gray(`⏭️  명령어 정의 무변경 — 등록 PUT을 건너뜁니다 (${r.count}개, 강제 재배포: pnpm run cmddeploy)`));
    else if (r.ok) log.info(chalk.green(`✅ ${r.count}개 슬래시 명령어를 ${r.scope === "guild" ? `길드 ${r.guildId}에` : "전역으로"} 배포했습니다.`));
    else deployErrorLines(r).forEach((line) => log.error(chalk.red(line)));
  });
} else {
  log.info({ sub: "commands" }, "⏭️  대표 샤드가 아니므로 명령어 배포를 건너뜁니다.");
}

// Initialize CacheManager DB and clean up orphaned files on startup
async function cleanupAudioCache() {
  try {
    await CacheManager.onStartup();
  } catch (error) {
    log.error(chalk.red("❌ CacheManager 시작 실패:"), error.message);
  }
}

async function restoreSavedPlayers(client) {
  const savedStates = CacheManager.getAllPlayerSessions();
  const entries = Object.entries(savedStates || {});
  if (entries.length === 0) return;

  log.info(chalk.cyan(`🔄 복원할 저장 세션 ${entries.length}개를 찾았습니다.`));

  for (const [guildId, state] of entries) {
    try {
      // Wait for guild to be available in cache
      let guild = client.guilds.cache.get(guildId);

      if (!guild) {
        // Try fetching with retry logic for sharding
        let retries = 3;
        while (!guild && retries > 0) {
          try {
            await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
            guild = await client.guilds.fetch(guildId).catch(() => null);
            if (guild) break;
          } catch (error) {
            retries--;
          }
        }
      }

      if (!guild) {
        log.info(chalk.yellow(`⚠️ 서버 ${guildId}을(를) 찾을 수 없거나 접근할 수 없습니다. 상태를 제거합니다.`));
        CacheManager.removePlayerSession(guildId);
        continue;
      }

      const voiceChannelId = state.voiceChannelId;
      const textChannelId = state.textChannelId;

      if (!voiceChannelId || !textChannelId) {
        CacheManager.removePlayerSession(guildId);
        continue;
      }

      let voiceChannel = guild.channels.cache.get(voiceChannelId) || null;
      if (!voiceChannel) {
        voiceChannel = await guild.channels.fetch(voiceChannelId).catch(() => null);
      }

      let textChannel = guild.channels.cache.get(textChannelId) || null;
      if (!textChannel) {
        textChannel = await guild.channels.fetch(textChannelId).catch(() => null);
      }

      const isVoiceValid = voiceChannel && typeof voiceChannel.isVoiceBased === "function" && voiceChannel.isVoiceBased();
      const isTextValid = textChannel && typeof textChannel.isTextBased === "function" && textChannel.isTextBased();

      if (!isVoiceValid || !isTextValid) {
        log.info(chalk.yellow(`⚠️ 서버 ${guild.name}의 채널 정보가 유효하지 않아 상태를 제거합니다.`));
        CacheManager.removePlayerSession(guildId);
        continue;
      }

      const player = new MusicPlayer(guild, textChannel, voiceChannel);
      client.players.set(guildId, player);

      try {
        await player.restoreFromState(state);
        log.info(chalk.green(`✅ 서버 ${guild.name}의 세션 복원 완료`));
      } catch (error) {
        log.error(chalk.red(`❌ 서버 ${guild.name} (${guildId}) 세션 복원 중 오류 발생:`), error.message);
        client.players.delete(guildId);
        player.cleanup();
        CacheManager.removePlayerSession(guildId);
      }
    } catch (error) {
      log.error(chalk.red(`❌ 서버 ${guildId} 세션 복원 중 오류 발생:`), error.message);
      CacheManager.removePlayerSession(guildId);
    }
  }
}

// ── bgutil POToken server ────────────────────────────────────────────────────
const BGUTIL_SERVER_DIR = path.join(__dirname, "bgutil-ytdlp-pot-provider", "server");
const BGUTIL_ENTRY = path.join(BGUTIL_SERVER_DIR, "build", "main.js");
const BGUTIL_PORT = 4416; // bgutil 서버 기본 포트 (yt-dlp 플러그인 기본값과 동일)

let bgutilProc = null;
let bgutilStopping = false;

function startBgutilServer() {
  if (bgutilStopping) return;
  if (!fs.existsSync(BGUTIL_ENTRY)) {
    log.warn(chalk.yellow("⚠️  [bgutil] build/main.js 없음: POToken provider 비활성"));
    return;
  }
  bgutilProc = spawn(process.execPath, ["build/main.js"], {
    cwd: BGUTIL_SERVER_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });
  bgutilProc.stdout.on("data", (d) =>
    d
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((l) => log.info(chalk.gray(`[bgutil] ${l}`))),
  );
  bgutilProc.stderr.on("data", (d) =>
    d
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((l) => log.warn(chalk.yellow(`[bgutil] ${l}`))),
  );
  bgutilProc.on("exit", (code) => {
    bgutilProc = null;
    if (!bgutilStopping) {
      log.warn(chalk.yellow(`⚠️  [bgutil] 서버 종료 (code=${code}), 5초 후 재시작...`));
      setTimeout(startBgutilServer, 5000);
    }
  });
  log.info(chalk.green(`✅ [bgutil] POToken 서버 시작 (port ${BGUTIL_PORT})`));
}

function stopBgutilServer() {
  bgutilStopping = true;
  if (bgutilProc) {
    bgutilProc.kill("SIGTERM");
    bgutilProc = null;
  }
}

// bgutil 서버가 /ping에 응답할 때까지 대기 (최대 timeoutMs) - provider 비활성이면 즉시 통과, 시간 초과 시 경고만
async function waitForBgutilReady(timeoutMs = 15000) {
  if (!bgutilProc) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${BGUTIL_PORT}/ping`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        log.info(chalk.green("✅ [bgutil] POToken 서버 준비 완료"));
        return true;
      }
    } catch {
      /* 아직 준비 안 됨 — 재시도 */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  log.warn(chalk.yellow(`⚠️  [bgutil] ${timeoutMs / 1000}초 내 응답 없음: POToken 없이 봇을 기동합니다.`));
  return false;
}

// bgutil POToken 서버는 호스트 포트(127.0.0.1:4416) 1개를 점유하므로 대표 샤드에서만 기동.
if (isPrimaryShard()) {
  startBgutilServer();
} else {
  log.info(chalk.gray("⏭️  [bgutil] 대표 샤드가 아니므로 POToken 서버를 기동하지 않습니다."));
}
// ────────────────────────────────────────────────────────────────────────────

// uncaughtException 복원력 헬퍼 (분류/표적 자가치유/빈도 가드/안전 종료) — src/resilience.js
const { isTransientNetworkError, healBrokenPlayers, networkErrorFlooding, unknownRejectionFlooding, fatalShutdown, NET_ERR_WINDOW_MS, NET_ERR_MAX } = require("./src/resilience");

function startBot() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
    // ShardingManager automatically sets shard ID and count via environment variables
    // No need to specify shards/shardCount here - they are auto-injected
  });

  // Collections for commands and music players
  client.commands = new Collection();
  client.players = new Collection();

  // Initialize Music Embed Manager
  const MusicEmbedManager = require("./src/MusicEmbedManager");
  client.musicEmbedManager = new MusicEmbedManager(client);

  // Start dashboard server — 웹 포트 1개를 점유하므로 대표 샤드에서만.
  // ⚠️ 현재 대시보드는 자기 프로세스의 client.players/guilds만 보므로, 샤딩 시 대표 샤드가 소유하지 않은 길드는 대시보드에 안 보이거나 조작이 안 된다. 차후 해결 예정.
  if (isPrimaryShard()) {
    const { startDashboard } = require("./dashboard/server/index");
    startDashboard(client);
  }

  // Load command files
  const loadCommands = () => {
    const commandsPath = path.join(__dirname, "commands");

    // Create commands directory if it doesn't exist
    if (!fs.existsSync(commandsPath)) {
      fs.mkdirSync(commandsPath, { recursive: true });
    }

    try {
      const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));

      for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);

        if ("data" in command && "execute" in command) {
          client.commands.set(command.data.name, command);
          log.info(chalk.green(`✅  명령어 준비 완료: ${command.data.name}`));
        } else {
          log.info(chalk.yellow(`⚠️  경고: ${file} 파일에 필수 data 또는 execute 속성이 없습니다.`));
        }
      }
    } catch (error) {
      log.info(chalk.yellow("⚠️  명령어 디렉토리가 없습니다. 명령어 로딩을 건너뜁니다."));
    }
  };

  // Load event handlers
  const loadEvents = () => {
    const eventsPath = path.join(__dirname, "events");

    // Create events directory if it doesn't exist
    if (!fs.existsSync(eventsPath)) {
      fs.mkdirSync(eventsPath, { recursive: true });
    }

    try {
      const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith(".js"));

      for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        const event = require(filePath);

        if (event.once) {
          client.once(event.name, (...args) => event.execute(...args));
        } else {
          client.on(event.name, (...args) => event.execute(...args));
        }
        log.info(chalk.green(`✓ 이벤트 로드 완료: ${event.name}`));
      }
    } catch (error) {
      log.info(chalk.yellow("⚠ 이벤트 디렉토리가 없습니다. 기본 이벤트를 사용합니다."));
    }
  };

  // Basic ready event
  client.once(Events.ClientReady, async () => {
    log.info({ tags: [`shard${client.shard?.ids?.[0] ?? 0}`] }, chalk.green(`✅ ${client.user.tag} is online and ready!`));
    log.info({ tags: [`shard${client.shard?.ids?.[0] ?? 0}`] }, chalk.cyan(`🎵 Music bot serving ${client.guilds.cache.size} servers on this shard!`));

    // Log total guild count across all shards (only if running with sharding)
    // Wait a bit to ensure all shards are ready before fetching
    if (client.shard) {
      setTimeout(() => {
        client.shard
          .fetchClientValues("guilds.cache.size")
          .then((results) => {
            const totalGuilds = results.reduce((acc, guildCount) => acc + guildCount, 0);
            log.info({ tags: [`shard${client.shard.ids[0]}`] }, chalk.magenta(`🌐 Total servers across all shards: ${totalGuilds}`));
          })
          .catch((err) => {
            // Silently fail if shards are still spawning
            if (!err.message.includes("still being spawned")) {
              log.error(chalk.red("전체 서버 수 조회 오류:"), err);
            }
          });
      }, 10000); // 다른 샤드들이 준비될 때까지 10초간 대기
    }

    // Set bot activity
    const StatusManager = require("./src/StatusManager");
    if (!client.statusManager) {
      client.statusManager = new StatusManager(client);
      client.statusManager.start();
    }

    // Don't restore here in sharded mode - wait for shard manager to broadcast
    // For non-sharded mode, restore immediately
    if (!client.shard) {
      log.info(chalk.cyan("⏳ 비샤딩 모드: 서버 캐시가 준비될 때까지 기다리는 중"));
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await client.restoreSessions();
    }
  });

  // Add restore function to client for shard manager to call
  client.restoreSessions = async function () {
    log.info({ tags: [`shard${client.shard?.ids?.[0] ?? "N/A"}`] }, chalk.cyan("🔄 세션 복원 시작..."));
    await restoreSavedPlayers(client);
    // 캐시 정리는 세션 복원 뒤에 - 복원된 세션이 참조하는 파일이 고아로 오인되지 않도록
    await cleanupAudioCache();
    log.info({ tags: [`shard${client.shard?.ids?.[0] ?? "N/A"}`] }, chalk.green("✅ 세션 복원 완료"));
  };

  // Handle interactions (slash commands)
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
      log.error(chalk.red(`❌ No command matching ${interaction.commandName} was found.`));
      return;
    }

    try {
      await command.execute(interaction, client);
    } catch (error) {
      log.error(chalk.red(`❌ ${interaction.commandName} 명령어 실행 중 오류:`), error);

      const errorMessage = "❌ 명령어 실행 중 오류가 발생했습니다!";

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  });

  // Handle voice state updates for pause/resume and cleanup
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const guild = oldState.guild;
    const player = client.players.get(guild.id);
    if (!player) return;

    const botMember = guild.members.me;
    const botId = botMember?.id ?? client.user.id;
    const involvesBot = oldState.id === botId || newState.id === botId;

    if (involvesBot) {
      const oldChannelId = oldState.channelId;
      const newChannelId = newState.channelId;

      if (oldChannelId && !newChannelId) {
        try {
          const embedManager = client.musicEmbedManager;

          // Mark state as ended so UI reflects the change
          player.pendingEndReason = "forced-disconnect";
          player.queue = [];
          player.currentTrack = null;

          if (embedManager) {
            await embedManager.handlePlaybackEnd(player);
          } else if (typeof player.showQueueCompleted === "function") {
            await player.showQueueCompleted();
          }
        } catch (error) {
          log.error("❌ Failed to update playback UI after forced disconnect:", error);
        } finally {
          player.cleanup();
          client.players.delete(guild.id);
        }
        return;
      }

      if (newChannelId && oldChannelId !== newChannelId) {
        if (newState.channel) {
          await player.moveToChannel(newState.channel);
          player.clearInactivityTimer(false);
          if (client.musicEmbedManager) {
            await client.musicEmbedManager.updateNowPlayingEmbed(player);
          }
        }
      }

      const wasMuted = oldState.serverMute || oldState.serverDeaf || oldState.suppress;
      const isMuted = newState.serverMute || newState.serverDeaf || newState.suppress;

      if (!wasMuted && isMuted) {
        const paused = player.pauseFor("mute");
        if (paused && client.musicEmbedManager) {
          await client.musicEmbedManager.updateNowPlayingEmbed(player);
        }
      } else if (wasMuted && !isMuted) {
        const resumed = player.resumeFor("mute");
        if (client.musicEmbedManager && (resumed || !player.pauseReasons.has("mute"))) {
          await client.musicEmbedManager.updateNowPlayingEmbed(player);
        }
      }
    }

    const voiceChannelId = player.voiceChannel?.id;
    if (!voiceChannelId) return;

    if (oldState.channelId === voiceChannelId || newState.channelId === voiceChannelId) {
      const channel = guild.channels.cache.get(voiceChannelId);

      if (!channel) {
        player.cleanup();
        client.players.delete(guild.id);
        return;
      }

      const listeners = channel.members.filter((member) => !member.user.bot).size;

      if (listeners === 0) {
        const alreadyPaused = player.pauseReasons.has("alone");
        player.startInactivityTimer();
        if (!alreadyPaused && client.musicEmbedManager && player.currentTrack) {
          await client.musicEmbedManager.updateNowPlayingEmbed(player);
        }
      } else {
        const wasPausedForAlone = player.pauseReasons.has("alone");
        player.clearInactivityTimer(true);
        if (wasPausedForAlone && client.musicEmbedManager && player.currentTrack) {
          await client.musicEmbedManager.updateNowPlayingEmbed(player);
        }
      }
    }
  });

  // 프로세스 종료는 init() 내부에 등록된 gracefulShutdown에 의해 처리

  // 오류 처리
  process.on("unhandledRejection", (reason, promise) => {
    log.error(chalk.red("❌ Unhandled Rejection at:"), promise, chalk.red("reason:"), reason);

    // 디스코드 API 오류 처리
    if (reason && reason.code) {
      switch (reason.code) {
        case 10062: // 알 수 없는 상호 작용 - Unknown interaction
          log.info(chalk.yellow("ℹ️ 만료된 상호작용입니다 (10062 Unknown interaction)"));
          return;
        case 40060: // 이미 처리된 상호작용 - Interaction already acknowledged
          log.info(chalk.yellow("ℹ️ 이미 처리된 상호작용입니다 (40060 Interaction already acknowledged)"));
          return;
        case 50013: // 권한 부족 - Missing permissions
          log.error(chalk.red("❌ 해당 디스코드 작업을 실행할 권한이 없습니다 (50013 Missing permissions)"));
          return;
      }
    }

    // 일시적 네트워크/음성 오류(IP discovery 실패 등) — 연결이 끊긴 서버만 표적 복구(정상 재생 중인 다른 서버는 무영향).
    if (isTransientNetworkError(reason)) {
      log.info(chalk.yellow("⚠️ 네트워크/음성 오류(rejection): 연결이 끊긴 서버만 복구합니다."));
      healBrokenPlayers(client).catch(() => {});
      return;
    }

    // 알 수 없는 rejection — 단발은 위 로그만 남기고 계속(사소한 catch 누락이 봇 전체 다운으로
    // 번지지 않게). 짧은 시간창에 반복되면 좀비 루프/시스템적 이상으로 보고 안전 종료
    // (uncaughtException의 네트워크 폭주 가드와 같은 방침)
    if (unknownRejectionFlooding()) {
      log.error(chalk.red(`🛑 알 수 없는 rejection이 ${NET_ERR_WINDOW_MS / 1000}초 내 ${NET_ERR_MAX}회 초과 — 시스템적 이상으로 판단합니다.`));
      fatalShutdown(client, reason instanceof Error ? reason : new Error(String(reason)));
    }
  });

  process.on("uncaughtException", (error) => {
    log.error(chalk.red("❌ 처리되지 않은 예외:"), error);

    // Discord 상호작용 오류 — 무해, 계속
    if (error.code === 10062 || error.code === 40060) {
      log.info(chalk.yellow("ℹ️ Discord interaction error handled, continuing..."));
      return;
    }

    // 일시적 네트워크 오류 — 프로세스는 살리고 "영향받은 서버만" 표적 복구. 짧은 시간에 폭주하면(빈도 가드) 시스템적 이상으로 보고 안전 종료
    if (isTransientNetworkError(error)) {
      if (!networkErrorFlooding()) {
        log.info(chalk.yellow("⚠️ 네트워크 오류: 봇은 계속 실행하고, 연결이 끊긴 서버만 복구합니다."));
        healBrokenPlayers(client).catch(() => {});
        return;
      }
      log.error(chalk.red(`🛑 네트워크 오류: ${NET_ERR_WINDOW_MS / 1000}초 내 ${NET_ERR_MAX}회 초과. 시스템적 이상으로 판단합니다.`));
    }

    // 그 외(또는 네트워크 폭주) = 치명적 → 안전 종료
    fatalShutdown(client, error);
  });

  // Initialize bot
  const init = async () => {
    try {
      log.info(chalk.blue("🤖 Starting Discord Music Bot..."));

      // Load commands and events
      loadCommands();
      loadEvents();

      // Graceful shutdown handler
      const gracefulShutdown = async (_signal) => {
        // Save all active player states before shutdown
        const savePromises = [];
        for (const [guildId, player] of client.players) {
          if (player && typeof player.persistState === "function") {
            savePromises.push(
              player.persistState("shutdown", true).catch((err) => {
                log.error(chalk.red(`Failed to save state for guild ${guildId}:`), err);
              }),
            );
          }
        }
        await Promise.all(savePromises);

        // Destroy all voice connections
        client.players.forEach((player, guildId) => {
          const connection = getVoiceConnection(guildId);
          if (connection) connection.destroy();
        });
        client.destroy();
        stopBgutilServer();

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
      log.error(chalk.red("❌ Failed to start bot:"), error);
      process.exit(1);
    }
  };

  // Start the bot
  init();
}

// bgutil 준비를 확인한 뒤 기동
waitForBgutilReady().then(startBot);
