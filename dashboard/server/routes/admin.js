// 봇 운영자(OWNER_ID) 전용 라우터 — 모든 엔드포인트가 requireOwner를 지난다.
// 경로가 /api/admin인 것은 대시보드 운영자 패널의 주소일 뿐, 디스코드 서버 쪽 권한과는 무관하다.

const express = require("express");
const log = require("../../../src/logger").child({ category: "dashboard" });
const router = express.Router();
const requireOwner = require("../middleware/requireOwner");
const os = require("os");
const logManager = require("../../../src/LogManager");
const procRegistry = require("../../../src/ChildProcessRegistry");
const { TIERS, getViewAs } = require("../viewAs");
const trackState = require("../../../src/trackState");
const configData = require("../../../src/configDataLoader");

// Bot/Node/System status
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
    activePlayers: client?.players?.size || 0,
    // 자식 프로세스(ffmpeg/yt-dlp) — 오래 살아 있는 항목이 새는 신호다.
    // 목록은 오래된 순이라 앞쪽만 봐도 된다. 상한을 두는 건 응답이 부풀지 않게.
    processes: (() => {
      const all = procRegistry.list();
      const byLabel = {};
      for (const p of all) byLabel[p.label] = (byLabel[p.label] || 0) + 1;
      return {
        total: all.length,
        byLabel: Object.entries(byLabel)
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
        oldest: all.slice(0, 8),
      };
    })(),
    // 유튜브 접속 경로 — 어느 것이 실행 중 제외됐는지는 여기서만 보인다(기동 로그는 설정만 보여준다).
    youtube: require("../../../src/YouTube").statusSnapshot(),
    // 로그 뷰어의 레벨 토글 초기 상태를 정하는 값. 서버가 debug를 안 보내고 있으면
    // 그 알약을 꺼진 채로 시작해야 한다(눌러 켜도 이후에 오는 것부터 보인다).
    logLevel: require("../../../config").logging.level,
  });
});

// 전체 서버 공지
const ANNOUNCE_TYPES = {
  maintenance: { color: "#FFA500", emoji: "🔧", title: "봇 점검 안내" },
  update: { color: "#57F287", emoji: "🆕", title: "봇 업데이트 안내" },
  alert: { color: "#ED4245", emoji: "⚠️", title: "긴급 공지" },
  info: { color: "#5865F2", emoji: "ℹ️", title: "공지사항" },
};
const ANNOUNCE_MAX = 4096; // 디스코드 embed description 상한

router.post("/broadcast", requireOwner, async (req, res) => {
  const { message, type = "maintenance" } = req.body ?? {};

  // 문자열인지 먼저 본다 — 객체가 오면 message.trim()에서 TypeError가 나 500이 됐다
  if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "공지 내용을 입력해 주세요." });
  const body = message.trim();
  if (body.length > ANNOUNCE_MAX) return res.status(400).json({ error: `공지는 ${ANNOUNCE_MAX}자까지 보낼 수 있습니다 (지금 ${body.length}자).` });
  if (typeof type !== "string" || !Object.hasOwn(ANNOUNCE_TYPES, type)) return res.status(400).json({ error: "공지 종류가 올바르지 않습니다." });

  const client = req.app.locals.discordClient;
  if (!client?.isReady()) return res.status(503).json({ error: "봇이 아직 준비되지 않았습니다." });

  const { EmbedBuilder } = require("discord.js");
  const cfg = ANNOUNCE_TYPES[type];

  const embed = new EmbedBuilder().setTitle(`${cfg.emoji} ${cfg.title}`).setDescription(body).setColor(cfg.color).setTimestamp().setFooter({ text: "봇 운영자" });

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

  // 한 곳도 못 보낸 것을 성공으로 돌려주면 운영자가 보냈다고 믿는다. 일부 실패도 구분해 알린다.
  const total = client.guilds.cache.size;
  if (sent === 0) return res.status(502).json({ success: false, sent, failed, total, error: total === 0 ? "봇이 들어가 있는 서버가 없습니다." : "어느 서버에도 보내지 못했습니다 (보낼 수 있는 채널이 없거나 권한이 없습니다)." });
  return res.json({ success: true, sent, failed, total, partial: failed > 0 });
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
      trackState.reset(player);
      if (client.musicEmbedManager) {
        await client.musicEmbedManager.handlePlaybackEnd(player, { reason: "disconnected" }).catch(() => {});
      }
      player.cleanup(false, "운영자 패널에서 서버 나가기");
      client.players.delete(guild.id);
    }
    await guild.leave();

    // 해당 서버 페이지를 보던 사용자에게 넛지 → 다음 조회에서 404로 이탈 유도
    const DashboardEvents = require("../../../src/DashboardEvents");
    DashboardEvents.notify(guild.id);

    log.info({ sub: "admin" }, `대시보드 운영자 패널에서 서버 나가기: ${name} (${guild.id})`);
    res.json({ success: true, name });
  } catch (error) {
    log.error({ sub: "admin" }, "서버 나가기 실패:", error);
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

// 캐시 초기화 — 오디오 파일과 파생 테이블을 비운다. 서버 설정(전용 채널·DJ 역할·SponsorBlock)은 남는다.
// 되돌릴 수 없으므로 클라이언트가 확인 대화를 거친다. 재생 중인 파일은 잠겨 있어 남을 수 있고, 재생은 끊기지 않는다.
router.post("/reset-cache", requireOwner, (req, res) => {
  const CacheManager = require("../../../src/CacheManager");
  try {
    const result = CacheManager.resetCache();
    log.warn({ sub: "admin" }, `대시보드 운영자 패널에서 캐시 초기화: 파일 ${result.removed}개 삭제`);
    res.json({ success: true, ...result });
  } catch (error) {
    log.error({ sub: "admin" }, "캐시 초기화 실패:", error);
    res.status(500).json({ error: error.message || "캐시 초기화에 실패했습니다" });
  }
});

// ── 설정 파일 (config/*.yaml) ─────────────────────────────────────────────
//
// 이 파일들은 주인이 둘이다: 손으로 고치는 운영자와 여기. 그래서 통째로 덮어쓰지 않고
// 바뀐 자리만 고친다(configDataLoader.save가 주석·빈 줄을 보존한다).

// 검사기가 있는 것만 고칠 수 있다 — 새 설정을 열면서 검사를 빠뜨리는 일이 없게 한 벌로 묶는다
const VALIDATORS = { genres: configData.validateGenres, status: configData.validateStatus };
const CONFIG_NAMES = Object.keys(VALIDATORS);

router.get("/config/:name", requireOwner, (req, res) => {
  const { name } = req.params;
  if (!CONFIG_NAMES.includes(name)) return res.status(404).json({ error: "그런 설정이 없습니다." });

  try {
    res.json({ name, data: configData.load(name) });
  } catch (error) {
    // 파일이 없거나 문법이 깨졌다 — 화면이 이유를 그대로 보여줄 수 있게 넘긴다
    res.status(409).json({ error: error.message, code: error.code || null });
  }
});

router.put("/config/:name", requireOwner, (req, res) => {
  const { name } = req.params;
  if (!CONFIG_NAMES.includes(name)) return res.status(404).json({ error: "그런 설정이 없습니다." });

  const data = req.body?.data;
  if (!data || typeof data !== "object") return res.status(400).json({ error: "저장할 내용이 없습니다." });

  // 저장 전에 본다 — 깨진 값을 파일에 남기느니 거절한다. 봇이 그 파일로 돌기 때문이다.
  const problems = VALIDATORS[name](data);
  if (problems.length) return res.status(400).json({ error: problems[0], problems });

  try {
    const saved = configData.save(name, data);
    log.warn({ sub: "admin" }, `대시보드에서 설정 저장: ${name}.yaml — 실행 ${req.session.user.username || req.session.user.id}`);
    res.json({ success: true, data: saved });
  } catch (error) {
    log.error({ sub: "admin" }, `설정 저장 실패(${name}): ${error.message}`);
    res.status(409).json({ error: error.message, code: error.code || null });
  }
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

  log.info({ sub: "admin" }, `권한 수준 오버라이드: ${tier || "해제"} — 실행 ${req.session.user.username || req.session.user.id}`);
  res.json({ viewAs: getViewAs(req) });
});

module.exports = router;
