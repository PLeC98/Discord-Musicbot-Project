const logSink = require("./src/LogManager"); // intercept console before anything else logs
const log = require("./src/logger").child({ category: "core" });
const { Client, GatewayIntentBits, Collection, Events } = require("discord.js");
const { getVoiceConnections } = require("@discordjs/voice");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const CacheManager = require("./src/CacheManager");
const procRegistry = require("./src/ChildProcessRegistry");
const { logResolved: logResolvedFfmpeg } = require("./src/ffmpegPath");
const MusicPlayer = require("./src/MusicPlayer");
const { resolveGuildForRestore } = require("./src/sessionRestore");
const DashboardEvents = require("./src/DashboardEvents");
const PlayerRegistry = require("./src/playerRegistry");
const { ALLOWED_MENTIONS } = require("./src/mentions");
const { createFileDestination } = require("./src/logFile");

// 로그 레벨 적용 — config를 읽은 직후. 이보다 앞선 레코드(config 검증 경고 등)는
// 기본 레벨(info)로 이미 기록됐다. 그것들은 어차피 warn 이상이라 잘려나갈 일이 없다.
require("./src/logger").level = config.logging.level;
if (config.logging.consoleLevel) logSink.setConsoleLevel(config.logging.consoleLevel);

// 파일 로그 마운트 — config를 읽은 직후, 기동 로그가 쏟아지기 전에.
// 이 지점보다 앞선 레코드(config 검증 경고 등)는 sink가 모아뒀다가 여기서 재생한다.
const logFile = config.logging.fileEnabled ? createFileDestination(config.logging) : null;
if (logFile) {
  logSink.addDestination(logFile.write);
  log.info({ tags: ["startup"] }, `로그 파일 저장 경로: ${logFile.path}`);
}

// 슬래시 명령어 배포
{
  const { deployCommands, deployErrorLines } = require("./src/commandLoader");
  log.debug("슬래시 명령어 배포를 시작합니다.");
  deployCommands().then((r) => {
    if (r.ok && r.skipped) log.info(`명령어 정의 ${r.count}개가 바뀌지 않았습니다. 등록을 건너뜁니다. (강제 재배포: pnpm run cmddeploy)`);
    else if (r.ok) log.info(`${r.count}개 슬래시 명령어를 ${r.scope === "guild" ? `서버 ${r.guildId}에` : "전역으로"} 배포했습니다.`);
    else deployErrorLines(r).forEach((line) => log.error(line));
  });
}

// Initialize CacheManager DB and clean up orphaned files on startup
async function cleanupAudioCache() {
  try {
    await CacheManager.onStartup();
  } catch (error) {
    log.error("캐시 관리자(CacheManager) 시작 실패:", error.message);
  }
}

async function restoreSavedPlayers(client) {
  const savedStates = CacheManager.getAllPlayerSessions();
  const entries = Object.entries(savedStates || {});
  if (entries.length === 0) return;

  log.info(`저장된 재생 세션 ${entries.length}개를 복원합니다`);

  for (const [guildId, state] of entries) {
    try {
      const { guild, gone } = await resolveGuildForRestore(client, guildId);

      if (!guild) {
        // 일시적 조회 실패면 세션을 남긴다 — 다음 기동에서 다시 시도한다
        if (gone) {
          log.warn(`서버 ID ${guildId}을(를) 찾을 수 없거나 접근할 수 없어 저장된 세션을 제거합니다.`);
          CacheManager.removePlayerSession(guildId);
        }
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
        log.warn(`서버 ${guild.name}의 채널 정보가 유효하지 않아 저장된 세션을 제거합니다.`);
        CacheManager.removePlayerSession(guildId);
        continue;
      }

      const player = new MusicPlayer(guild, textChannel, voiceChannel);
      client.players.set(guildId, player);

      try {
        await player.restoreFromState(state);
        log.info(`서버 ${guild.name}의 세션 복원 완료`);
      } catch (error) {
        log.error(`서버 ${guild.name} (${guildId}) 세션 복원 중 오류:`, error.message);
        client.players.delete(guildId);
        player.cleanup(false, "세션 복원 실패");
        CacheManager.removePlayerSession(guildId);
      }
    } catch (error) {
      log.error(`서버 ID ${guildId} 세션 복원 중 오류:`, error.message);
      CacheManager.removePlayerSession(guildId);
    }
  }
}

// ── bgutil POToken server ────────────────────────────────────────────────────
const BGUTIL_SERVER_DIR = path.join(__dirname, "bgutil-ytdlp-pot-provider", "server");
const BGUTIL_ENTRY = path.join(BGUTIL_SERVER_DIR, "build", "main.js");
const BGUTIL_PORT = 4416; // bgutil 서버 기본 포트 (yt-dlp 플러그인 기본값과 동일)

// bgutil이 발급한 토큰을 그대로 로그에 남기지 않는다 — 세션 자격증명이다.
// (sink의 레드액션은 access_token 계열 이름만 알아서 poToken은 그냥 통과한다.)
function scrubBgutilLine(line) {
  return String(line)
    .replace(/(Generated IntegrityToken:\s*).*/i, "$1[REDACTED]")
    .replace(/((?:poToken|integrityToken)"?\s*[:=]\s*"?)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]");
}

let bgutilProc = null;
let bgutilStopping = false;

function startBgutilServer() {
  if (bgutilStopping) return;
  const installed = fs.existsSync(BGUTIL_ENTRY);

  // 쓰지 않겠다고 했으면 조용히 넘어간다. 안 쓸 서버가 없다고 떠들어봐야 의미가 없고,
  // 인증 없는 로컬 HTTP 서버를 상시 띄우지 않는 것 자체가 이 토글의 목적이다.
  if (!config.bgutil.enabled) {
    if (installed) log.debug({ sub: "bgutil" }, "설치돼 있지만 BGUTIL_ENABLED=false — 띄우지 않습니다");
    return;
  }
  // 반대로 쓰겠다고 했는데 없으면 시끄럽게 군다. 조용히 넘어가면 POToken이 없는 줄 모른 채 돈다.
  if (!installed) {
    log.error({ sub: "bgutil" }, "BGUTIL_ENABLED=true인데 설치돼 있지 않습니다 (pnpm run install:bgutil). POToken 없이 진행합니다");
    return;
  }
  bgutilProc = spawn(process.execPath, ["build/main.js"], {
    cwd: BGUTIL_SERVER_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // 남의 프로세스라 레벨을 직접 붙일 수 없다 — 스트림(stdout/stderr)과 문구로 가른다.
  // bgutil의 stdout은 전량 요청 단위 상세(POT 생성·챌린지)라 debug로 내린다. 수명주기(시작·준비
  // 완료·비정상 종료)는 아래 우리 코드가 따로 남기므로 여기서 info로 올릴 것이 없다.
  const emit = (chunk, stream) =>
    chunk
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((raw) => {
        const line = scrubBgutilLine(raw);
        if (stream === "err") {
          if (/could not listen|EADDRINUSE|^\s+at /i.test(line)) log.error({ sub: "bgutil" }, line);
          else log.warn({ sub: "bgutil" }, line);
        } else {
          log.debug({ sub: "bgutil" }, line);
        }
      });
  bgutilProc.stdout.on("data", (d) => emit(d, "out"));
  bgutilProc.stderr.on("data", (d) => emit(d, "err"));
  bgutilProc.on("exit", (code) => {
    bgutilProc = null;
    if (!bgutilStopping) {
      log.warn({ sub: "bgutil" }, `서버 비정상 종료 (code=${code}), 5초 후 재시작합니다`);
      setTimeout(startBgutilServer, 5000);
    }
  });
  log.debug({ sub: "bgutil" }, "POToken 서버 시작");
}

function stopBgutilServer() {
  bgutilStopping = true;
  if (bgutilProc) {
    bgutilProc.kill("SIGTERM");
    bgutilProc = null;
  }
}

// bgutil 서버가 /ping에 응답할 때까지 대기 (최대 timeoutMs) - provider 비활성이면 즉시 통과, 시간 초과 시 경고만
async function waitForBgutilReady(timeoutMs = 30000) {
  if (!bgutilProc) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${BGUTIL_PORT}/ping`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        log.info({ sub: "bgutil" }, `POToken 서버 준비 완료 (포트 ${BGUTIL_PORT})`);
        return true;
      }
    } catch {
      /* 아직 준비 안 됨 — 재시도 */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  log.warn({ sub: "bgutil" }, `${timeoutMs / 1000}초 내 응답 없음: POToken 없이 봇을 기동합니다.`);
  return false;
}

startBgutilServer();
// ────────────────────────────────────────────────────────────────────────────

// uncaughtException 복원력 헬퍼 (분류/표적 자가치유/빈도 가드/안전 종료) — src/resilience.js
const { isTransientNetworkError, healBrokenPlayers, networkErrorFlooding, unknownRejectionFlooding, unknownClientErrorFlooding, ignorableDiscordError, isDeadInteraction, fatalShutdown, NET_ERR_WINDOW_MS, NET_ERR_MAX } = require("./src/resilience");

function startBot() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
    // 외부에서 온 트랙 제목·파일명이 content에 실려도 멘션이 발동하지 않게 (src/mentions.js)
    allowedMentions: ALLOWED_MENTIONS,
  });

  // Collections for commands and music players
  client.commands = new Collection();
  client.players = new PlayerRegistry(); // 등록·해제를 로그로 남기는 Collection

  // Initialize Music Embed Manager
  const MusicEmbedManager = require("./src/MusicEmbedManager");
  client.musicEmbedManager = new MusicEmbedManager(client);

  // Start dashboard server
  {
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

      // 개별 성공은 세기만 한다 — 30개면 30줄이 되고, 그 30줄이 말하는 것은 "30개 다 됐다"뿐이다.
      // 실패한 것만 이름을 남긴다. 그게 실제로 찾아봐야 하는 정보다.
      let ok = 0;
      for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);

        if ("data" in command && "execute" in command) {
          client.commands.set(command.data.name, command);
          ok++;
        } else {
          log.warn(`${file}: 슬래시 명령어 형식이 아니어서 건너뜁니다.`);
        }
      }
      log.info({ tags: ["startup"] }, `슬래시 명령어 ${ok}개 준비 완료`);
    } catch (error) {
      log.warn("명령어 디렉터리가 없어 명령어 로딩을 건너뜁니다.");
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

      // 개별 등록은 debug로 — 파일마다 한 줄이면 부팅당 다섯 줄이고, 그 다섯 줄이 말하는 것은 "다 됐다"뿐이다.
      let loaded = 0;
      for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        const event = require(filePath);

        if (event.once) {
          client.once(event.name, (...args) => event.execute(...args));
        } else {
          client.on(event.name, (...args) => event.execute(...args));
        }
        log.debug(`이벤트 정의 불러옴: ${event.name}`);
        loaded++;
      }
      log.info({ tags: ["startup"] }, `이벤트 핸들러 ${loaded}개 등록 완료`);
    } catch (error) {
      log.warn("이벤트 디렉터리가 없어 기본 이벤트로 진행합니다.");
    }
  };

  // Basic ready event
  client.once(Events.ClientReady, async () => {
    log.info({ tags: ["startup"] }, `${client.user.tag} 준비 완료`);
    log.info(`서버 ${client.guilds.cache.size}개에서 대기 중`);

    // Set bot activity
    const StatusManager = require("./src/StatusManager");
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
    await restoreSavedPlayers(client);
    // 캐시 정리는 세션 복원 뒤에 - 복원된 세션이 참조하는 파일이 고아로 오인되지 않도록
    await cleanupAudioCache();
    log.info({ tags: ["startup"] }, "저장된 세션 복원 완료");
  };

  // Handle interactions (slash commands)
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
      log.error(`등록되지 않은 명령어: ${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction, client);
    } catch (error) {
      log.error(`${interaction.commandName} 명령어 실행 중 오류:`, error);

      // 토큰이 죽었으면(10062/40060) 안내 시도가 곧 두 번째 같은 오류다 — 아무 데도 닿지 않는다.
      if (isDeadInteraction(error)) return;

      const payload = { content: "❌ 명령어 실행 중 오류가 발생했습니다!", flags: [1 << 6] };
      const sending = interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
      // 안내 실패는 여기서 끝낸다. 리스너 밖으로 던지면 client "error"를 거쳐 uncaughtException이 된다.
      await sending.catch((err) => log.error("오류 안내 전송 실패:", err.message));
    }
  });

  // Handle voice state updates for pause/resume and cleanup
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const guild = oldState.guild;

    // 채널 이동은 대시보드의 "봇 부르기 / 곡 추가 / 재생 조작" 노출 조건을 바꾼다.
    // 이 알림이 없으면 재생 중일 때만 우연히 갱신된다 — 아래 임베드 갱신 훅에 묻어가기 때문에.
    // 마이크 음소거·화면 공유 등도 같은 이벤트로 오지만 노출 조건과 무관하므로 채널이 바뀔 때만.
    if (oldState.channelId !== newState.channelId) DashboardEvents.notify(guild.id);

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
          log.error("강제 연결 해제 후 재생 UI 갱신 실패:", error);
        } finally {
          player.cleanup(false, "봇이 음성에서 강제 퇴장됨");
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
        player.cleanup(false, "봇의 음성 채널이 사라짐");
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

  // 리스너·프로미스 밖으로 새어나온 오류의 등급 판정 — client "error"와 unhandledRejection이 같은 기준을 쓴다.
  // true = 알려진 오류라 처리 완료, false = 알 수 없음(호출부가 빈도 가드로 판단).
  const handleLooseError = (error, source) => {
    const known = ignorableDiscordError(error);
    if (known) {
      if (known.level === "error") log.error(known.message);
      else log.info(known.message);
      return true;
    }

    // 일시적 네트워크/음성 오류(IP discovery 실패 등) — 연결이 끊긴 서버만 표적 복구(정상 재생 중인 다른 서버는 무영향).
    if (isTransientNetworkError(error)) {
      log.warn(`네트워크/음성 오류(${source}): 연결이 끊긴 서버의 복구를 시도합니다.`);
      healBrokenPlayers(client).catch(() => {});
      return true;
    }
    return false;
  };

  // discord.js v14의 AsyncEventEmitter는 async 리스너의 rejection을 잡아 client "error"로 다시 던진다.
  // 리스너가 없으면 그 throw가 타이머 콜백에서 터져 unhandledRejection이 아니라 uncaughtException이 되고,
  // 알 수 없는 오류는 곧바로 안전 종료로 간다 — 리스너 하나의 사소한 rejection이 봇 전체를 내린다.
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

    // 알 수 없는 rejection — 단발은 위 로그만 남기고 계속(사소한 catch 누락이 봇 전체 다운으로
    // 번지지 않게). 짧은 시간창에 반복되면 좀비 루프/시스템적 이상으로 보고 안전 종료
    // (uncaughtException의 네트워크 폭주 가드와 같은 방침)
    if (unknownRejectionFlooding()) {
      log.error(`${NET_ERR_WINDOW_MS / 1000}초 동안 알 수 없는 거부가 ${NET_ERR_MAX}회 발생해 봇을 안전 종료합니다.`);
      fatalShutdown(client, reason instanceof Error ? reason : new Error(String(reason)));
    }
  });

  process.on("uncaughtException", (error) => {
    log.error("처리되지 않은 예외:", error);

    // Discord 상호작용 오류 — 무해, 계속
    if (isDeadInteraction(error)) {
      log.info("디스코드 상호작용 오류: 봇의 동작에는 영향이 없습니다.");
      return;
    }

    // 일시적 네트워크 오류 — 프로세스는 살리고 "영향받은 서버만" 표적 복구. 짧은 시간에 폭주하면(빈도 가드) 시스템적 이상으로 보고 안전 종료
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

      // 지금 무엇으로 유튜브에 붙는지 한 줄. 이걸 안 남겨서 bgutil이 3개월간 죽어 있는 걸 몰랐다.
      require("./src/YouTube").logAuthMode();

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
        // 봇이 음성 채널에 유령으로 남는다 — 재시작하면 "봇은 음성에 있는데 플레이어가 없는" 상태가 된다.
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
        stopBgutilServer();

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
waitForBgutilReady().then(startBot);
