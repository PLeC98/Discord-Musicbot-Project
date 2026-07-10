const { ShardingManager } = require("discord.js");
const config = require("./config");
const chalk = require("chalk");

// 샤딩 매니저 생성
const manager = new ShardingManager("./index.js", {
  token: config.discord.token,
  totalShards: config.sharding.totalShards, // 'auto' will automatically calculate optimal shard count
  shardList: config.sharding.shardList,
  mode: config.sharding.mode, // 'process' or 'worker'
  respawn: config.sharding.respawn, // Auto-respawn crashed shards
  shardArgs: process.argv.slice(2),
  execArgv: process.execArgv,
});

// 크래시 루프 가드 — 짧은 시간에 반복 사망하는 샤드는 respawn을 멈추고 운영자 개입을 기다린다.
// (무한 respawn으로 같은 치명적 오류를 되풀이하지 않도록. 정상 단발 크래시는 계속 respawn.)
const shardDeaths = new Map(); // shardId -> [사망 타임스탬프]
const CRASH_WINDOW_MS = 60000;
const CRASH_MAX = 5;

// Event: Shard is being created
manager.on("shardCreate", (shard) => {
  console.log(chalk.cyan(`[SHARD MANAGER] Launching shard ${shard.id}...`));

  shard.on("ready", () => {
    console.log(chalk.green(`[SHARD ${shard.id}] ✅ Shard ${shard.id} is ready!`));
  });

  shard.on("disconnect", () => {
    console.log(chalk.yellow(`[SHARD ${shard.id}] ⚠️ Shard ${shard.id} disconnected`));
  });

  shard.on("reconnecting", () => {
    console.log(chalk.blue(`[SHARD ${shard.id}] 🔄 Shard ${shard.id} reconnecting...`));
  });

  shard.on("death", (process) => {
    const reason = process.exitCode === null ? "unknown error" : `exit code ${process.exitCode}`;

    // 크래시 루프 판정: 시간창 내 사망 횟수 집계
    const now = Date.now();
    const times = (shardDeaths.get(shard.id) || []).filter((t) => now - t < CRASH_WINDOW_MS);
    times.push(now);
    shardDeaths.set(shard.id, times);

    if (times.length >= CRASH_MAX && manager.respawn) {
      // best-effort로 이후 respawn 중단 — 다음 사망부터 확실히 멈춤(디스코드js가 사망 시 manager.respawn 재확인)
      manager.respawn = false;
      console.error(chalk.red(`💀 [SHARD ${shard.id}] ${CRASH_WINDOW_MS / 1000}초 내 ${times.length}회 사망 (${reason}) — 크래시 루프로 판단, respawn을 중단합니다.`));
      console.error(chalk.red("   원인을 조치한 뒤 매니저를 수동으로 재시작하세요 (운영자 확인 필요)."));
    } else if (manager.respawn) {
      console.log(chalk.red(`[SHARD ${shard.id}] 💀 Shard ${shard.id} died (${reason}), restarting...`));
    } else {
      console.error(chalk.red(`[SHARD ${shard.id}] 💀 Shard ${shard.id} died (${reason}) — respawn 중단됨, 운영자 확인 대기 중.`));
    }
  });

  shard.on("error", (error) => {
    console.error(chalk.red(`[SHARD ${shard.id}] ❌ Shard ${shard.id} encountered an error:`), error);
  });
});

// Error handling
process.on("unhandledRejection", (reason, promise) => {
  console.error(chalk.red("❌ 샤드 매니저에서 처리되지 않은 거부(Unhandled Rejection) 발생:"), reason);
});

process.on("uncaughtException", (error) => {
  console.error(chalk.red("❌ 샤드 매니저에서 처리되지 않은 예외(Uncaught Exception) 발생:"), error);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log(chalk.yellow("\n⚠️  모든 샤드를 종료하는 중..."));

  try {
    await manager.broadcastEval((client) => {
      // Disconnect all voice connections
      client.players.forEach((player, guildId) => {
        player.stop();
        const { getVoiceConnection } = require("@discordjs/voice");
        const connection = getVoiceConnection(guildId);
        if (connection) connection.destroy();
      });

      // Destroy client
      client.destroy();
    });

    console.log(chalk.green("✅ 모든 샤드가 정상적으로 종료되었습니다"));
    process.exit(0);
  } catch (error) {
    console.error(chalk.red("❌ 종료 중 오류 발생:"), error);
    process.exit(1);
  }
});

// Start sharding
console.log(chalk.blue("🚀 Starting Discord Music Bot with Sharding..."));
console.log(chalk.blue(`📊 Sharding Mode: ${config.sharding.mode}`));
console.log(chalk.blue(`🔢 Total Shards: ${config.sharding.totalShards}`));
console.log(chalk.blue("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

manager
  .spawn({
    amount: config.sharding.totalShards,
    delay: config.sharding.spawnDelay, // Delay between shard spawns (Discord recommends 5-5.5 seconds)
    timeout: config.sharding.spawnTimeout, // Timeout for shard ready
  })
  .then(async (shards) => {
    console.log(chalk.green(`\n✅ Successfully spawned ${shards.size} shard(s)`));

    // Wait a bit for all shards to be fully ready, then restore sessions
    console.log(chalk.cyan("\n⏳ Waiting for all shards to stabilize before restoring sessions..."));
    await new Promise((resolve) => setTimeout(resolve, 10000)); // 10 second wait

    console.log(chalk.cyan("🔄 Broadcasting session restore to all shards..."));

    // Broadcast restore command to all shards
    await manager
      .broadcastEval(async (client) => {
        // Only restore if this function exists
        if (typeof client.restoreSessions === "function") {
          await client.restoreSessions();
        }
      })
      .catch((err) => {
        console.error(chalk.red("❌ Error broadcasting restore:"), err.message);
      });

    console.log(chalk.green("✅ Session restore broadcast complete"));
  })
  .catch((error) => {
    console.error(chalk.red("❌ Failed to spawn shards:"), error);
    process.exit(1);
  });

module.exports = manager;
