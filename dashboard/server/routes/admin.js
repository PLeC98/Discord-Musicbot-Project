// 봇 운영자(OWNER_ID) 전용 라우터 — 모든 엔드포인트가 requireOwner를 지난다.
// 경로가 /api/admin인 것은 대시보드 운영자 패널의 주소일 뿐, 디스코드 서버 쪽 권한과는 무관하다.

const express = require("express");
const log = require("../../../src/logger").child({ category: "dashboard" });
const router = express.Router();
const requireOwner = require("../middleware/requireOwner");
const os = require("os");
const logManager = require("../../../src/LogManager");
const { TIERS, getViewAs } = require("../viewAs");

// Bot/Node/System/Shard status
router.get("/status", requireOwner, (req, res) => {
  const client = req.app.locals.discordClient;
  const uptime = process.uptime();
  const mem = process.memoryUsage();

  res.json({
    bot: {
      tag: client?.user?.tag || "Connecting...",
      id: client?.user?.id || null,
      guilds: client?.guilds?.cache?.size || 0,
      ping: client?.ws?.ping || 0,
      status: client?.ws?.status ?? -1,
      uptime: {
        days: Math.floor(uptime / 86400),
        hours: Math.floor((uptime % 86400) / 3600),
        minutes: Math.floor((uptime % 3600) / 60),
        seconds: Math.floor(uptime % 60),
      },
    },
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      memory: {
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        rss: Math.round(mem.rss / 1024 / 1024),
      },
    },
    system: {
      cpus: os.cpus().length,
      totalMem: Math.round(os.totalmem() / 1024 / 1024),
      freeMem: Math.round(os.freemem() / 1024 / 1024),
      loadAvg: os.loadavg(),
    },
    shards: client?.shard
      ? {
          ids: client.shard.ids,
          count: client.shard.count,
        }
      : null,
    activePlayers: client?.players?.size || 0,
  });
});

// 전체 서버 공지
router.post("/broadcast", requireOwner, async (req, res) => {
  const { message, type = "maintenance" } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: "공지 내용을 입력해 주세요." });

  const client = req.app.locals.discordClient;
  if (!client?.isReady()) return res.status(503).json({ error: "봇이 아직 준비되지 않았습니다." });

  const { EmbedBuilder } = require("discord.js");

  const types = {
    maintenance: { color: "#FFA500", emoji: "🔧", title: "봇 점검 안내" },
    update: { color: "#57F287", emoji: "🆕", title: "봇 업데이트 안내" },
    alert: { color: "#ED4245", emoji: "⚠️", title: "긴급 공지" },
    info: { color: "#5865F2", emoji: "ℹ️", title: "공지사항" },
  };
  const cfg = types[type] || types.info;

  const embed = new EmbedBuilder().setTitle(`${cfg.emoji} ${cfg.title}`).setDescription(message.trim()).setColor(cfg.color).setTimestamp().setFooter({ text: "봇 운영자" });

  const GuildSettingsManager = require("../../../src/GuildSettingsManager");
  let sent = 0,
    failed = 0;

  for (const [, guild] of client.guilds.cache) {
    try {
      // Priority: bot channel → system channel → first available text channel
      let ch = null;

      const botChannelId = await GuildSettingsManager.getBotChannel(guild.id);
      if (botChannelId) {
        ch = guild.channels.cache.get(botChannelId);
        if (ch && !ch.permissionsFor(guild.members.me)?.has("SendMessages")) ch = null;
      }

      if (!ch) ch = guild.systemChannel;
      if (!ch || !ch.permissionsFor(guild.members.me)?.has("SendMessages")) {
        ch = guild.channels.cache
          .filter((c) => c.isTextBased() && !c.isThread() && c.permissionsFor(guild.members.me)?.has("SendMessages"))
          .sort((a, b) => a.position - b.position)
          .first();
      }

      if (ch) {
        await ch.send({ embeds: [embed] });
        sent++;
      } else failed++;
    } catch {
      failed++;
    }
  }

  res.json({ success: true, sent, failed, total: client.guilds.cache.size });
});

// List all guilds bot is in
router.get("/guilds", requireOwner, (req, res) => {
  const client = req.app.locals.discordClient;
  if (!client?.isReady()) return res.status(503).json({ error: "봇이 아직 준비되지 않았습니다." });

  const guilds = [...client.guilds.cache.values()].map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.iconURL({ size: 64 }),
    memberCount: g.memberCount,
    hasPlayer: client.players?.has(g.id) || false,
  }));

  res.json({ guilds });
});

// Force-leave a guild (owner-triggered from dashboard).
// 재생 중이면 플레이어를 먼저 정리해 음성 연결/타이머가 남지 않게 한다.
// guild.leave() 이후에는 서버 이벤트가 오지 않을 수 있어 사후 정리에 기댈 수 없음.
router.post("/guilds/:guildId/leave", requireOwner, async (req, res) => {
  const client = req.app.locals.discordClient;
  if (!client?.isReady()) return res.status(503).json({ error: "봇이 아직 준비되지 않았습니다." });

  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) return res.status(404).json({ error: "서버를 찾을 수 없습니다" });

  const name = guild.name;
  try {
    const player = client.players?.get(guild.id);
    if (player) {
      // 강제 연결 해제와 동일한 마감 절차 (index.js VoiceStateUpdate 참조)
      player.pendingEndReason = "forced-disconnect";
      player.queue = [];
      player.currentTrack = null;
      if (client.musicEmbedManager) {
        await client.musicEmbedManager.handlePlaybackEnd(player).catch(() => {});
      }
      player.cleanup();
      client.players.delete(guild.id);
    }
    await guild.leave();

    // 해당 서버 페이지를 보던 사용자에게 넛지 → 다음 조회에서 404로 이탈 유도
    const DashboardEvents = require("../../../src/DashboardEvents");
    DashboardEvents.notify(guild.id);

    log.info({ sub: "admin" }, `대시보드에서 서버 나가기 실행: ${name} (${guild.id})`);
    res.json({ success: true, name });
  } catch (error) {
    log.error({ sub: "admin" }, "❌ 서버 나가기 실패:", error);
    res.status(502).json({ error: error.message || "서버 나가기에 실패했습니다" });
  }
});

// Re-register slash commands with Discord (owner-triggered from dashboard).
// deployCommands는 게이트웨이/음성과 무관한 REST PUT이라 봇 실행 중에도 안전하며 샤드에 종속되지 않는다.
router.post("/redeploy-commands", requireOwner, async (req, res) => {
  const { deployCommands } = require("../../../src/commandLoader");
  const r = await deployCommands({ force: true }); // 대시보드 버튼 = 명시적 재배포 의도 — 지문 무시
  if (r.ok) {
    return res.json({ success: true, count: r.count, scope: r.scope, guildId: r.guildId, names: r.names });
  }
  return res.status(502).json({ success: false, error: r.error?.message || "배포에 실패했습니다", code: r.error?.code || null });
});

// Real-time log stream (SSE)
router.get("/logs/stream", requireOwner, (req, res) => {
  logManager.addClient(res);
});

// 권한 수준 오버라이드 — { tier: "owner"|"moderator"|"dj"|"user"|null }. null이면 해제.
// requireOwner가 오버라이드를 무시하므로(실 운영자 기준) 낮춘 뒤에도 여기로 되돌아올 수 있다.
router.post("/view-as", requireOwner, (req, res) => {
  const { tier } = req.body || {};
  if (tier !== null && !TIERS.includes(tier)) {
    return res.status(400).json({ error: "권한 수준이 올바르지 않습니다" });
  }

  if (tier === null) delete req.session.viewAs;
  else req.session.viewAs = tier;

  log.info({ sub: "admin" }, `권한 수준 오버라이드: ${tier || "해제"} by ${req.session.user.username || req.session.user.id}`);
  res.json({ viewAs: getViewAs(req) });
});

module.exports = router;
