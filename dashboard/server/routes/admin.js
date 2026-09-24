// 봇 운영자(OWNER_ID) 전용 라우터. 모든 엔드포인트가 requireOwner를 지난다.
// 경로가 /api/admin인 것은 대시보드 운영자 패널의 주소일 뿐, 디스코드 서버 쪽 권한과는 무관하다.

import express from "express";
import logger from "../../../src/infra/log/logger.js";
const log = logger.child({ category: "dashboard" });
const router = express.Router();
import requireOwner from "../middleware/requireOwner.js";
import os from "os";
import logManager from "../../../src/infra/log/sink.js";
import procRegistry from "../../../src/infra/processRegistry.js";
import viewAsModule from "../viewAs.js";
const { TIERS, getViewAs } = viewAsModule;
import trackState from "../../../src/player/trackState.js";
import playerEvents from "../../../src/player/events.js";
import genreConfig from "../../../src/config/genres.js";
import statusConfig from "../../../src/config/status.js";
import aiConfig from "../../../src/config/ai.js";
import cookieConfig from "../../../src/config/cookies.js";
import yamlStore from "../../../src/config/yamlStore.js";
import { EmbedBuilder } from "discord.js";
import config from "../../../config.js";
import GuildSettingsManager from "../../../src/store/guildSettings.js";
import audioCache from "../../../src/store/audioCache.js";
import YouTube from "../../../src/sources/youtube/index.js";
import autoplaySources from "../../../src/autoplay/sources/index.js";
import assist from "../../../src/autoplay/assist/index.js";
import tokens from "../../../src/autoplay/assist/tokens.js";
import models from "../../../src/config/schema/aiModels.js";

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
    // 자식 프로세스(ffmpeg/yt-dlp). 오래 살아 있는 항목이 새는 신호다.
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
    // 유튜브 접속 경로. 어느 것이 실행 중 제외됐는지는 여기서만 보인다(기동 로그는 설정만 보여준다).
    youtube: YouTube.statusSnapshot(),
    // 로그 뷰어의 레벨 토글 초기 상태를 정하는 값. 서버가 debug를 안 보내고 있으면
    // 그 알약을 꺼진 채로 시작해야 한다(눌러 켜도 이후에 오는 것부터 보인다).
    logLevel: config.logging.level,
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

  // 문자열인지 먼저 본다. 객체가 오면 message.trim()에서 TypeError가 나 500이 됐다
  if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "공지 내용을 입력해 주세요." });
  const body = message.trim();
  if (body.length > ANNOUNCE_MAX) return res.status(400).json({ error: `공지는 ${ANNOUNCE_MAX}자까지 보낼 수 있습니다 (지금 ${body.length}자).` });
  if (typeof type !== "string" || !Object.hasOwn(ANNOUNCE_TYPES, type)) return res.status(400).json({ error: "공지 종류가 올바르지 않습니다." });

  const client = req.app.locals.discordClient;
  if (!client?.isReady()) return res.status(503).json({ error: "봇이 아직 준비되지 않았습니다." });

  const cfg = ANNOUNCE_TYPES[type];

  const embed = new EmbedBuilder().setTitle(`${cfg.emoji} ${cfg.title}`).setDescription(body).setColor(cfg.color).setTimestamp().setFooter({ text: "봇 운영자" });

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
      player.cleanup("운영자 패널에서 서버 나가기");
      client.players.delete(guild.id);
    }
    await guild.leave();

    // 해당 서버 페이지를 보던 사용자에게 넛지 → 다음 조회에서 404로 이탈 유도
    playerEvents.touched(guild.id);

    log.info({ sub: "admin" }, `대시보드 운영자 패널에서 서버 나가기: ${name} (${guild.id})`);
    res.json({ success: true, name });
  } catch (error) {
    log.error({ sub: "admin" }, "서버 나가기 실패:", error);
    res.status(502).json({ error: error.message || "서버 나가기에 실패했습니다" });
  }
});

// Re-register slash commands with Discord (owner-triggered from dashboard).
// deployCommands는 게이트웨이/음성과 무관한 REST PUT이라 봇 실행 중에도 안전하며 샤드에 종속되지 않는다.
// 조립(app/main)이 app.locals 로 넘긴다. 대시보드가 app 층을 부르지 않는다
router.post("/redeploy-commands", requireOwner, async (req, res) => {
  const r = await req.app.locals.deployCommands({ force: true }); // 대시보드 버튼 = 명시적 재배포 의도. 지문 무시
  if (r.ok) {
    // 개수는 디스코드가 등록을 받고 돌려준 것이다
    log.info({ sub: "admin" }, `대시보드 운영자 패널에서 슬래시 명령어 ${r.count}개를 ${r.scope === "guild" ? `서버 ${r.guildId}에` : "전역으로"} 다시 등록했습니다.`);
    return res.json({ success: true, count: r.count, scope: r.scope, guildId: r.guildId, names: r.names });
  }
  log.error({ sub: "admin" }, `대시보드 운영자 패널에서 슬래시 명령어 재등록 실패: ${r.error?.message || r.error}`);
  return res.status(502).json({ success: false, error: r.error?.message || "배포에 실패했습니다", code: r.error?.code || null });
});

// 캐시 초기화. 오디오 파일과 파생 테이블을 비운다. 서버 설정(전용 채널·DJ 역할·SponsorBlock)은 남는다.
// 되돌릴 수 없으므로 클라이언트가 확인 대화를 거친다. 재생 중인 파일은 잠겨 있어 남을 수 있고, 재생은 끊기지 않는다.
router.post("/reset-cache", requireOwner, (req, res) => {
  try {
    const result = audioCache.resetCache();
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

// 검사기가 있는 것만 고칠 수 있다. 새 설정을 열면서 검사를 빠뜨리는 일이 없게 한 벌로 묶는다
const VALIDATORS = { genres: genreConfig.validateGenres, status: statusConfig.validateStatus, ai: aiConfig.validateAi };
const CONFIG_NAMES = Object.keys(VALIDATORS);

// 자동재생 소스 편집기가 그릴 표. 어떤 종류가 있고, 무슨 칸을 받고, 지금 쓸 수 있는가.
// 검증·실행과 같은 표에서 나온다(src/autoplaySources). 화면이 목록을 따로 들면 소스를 더할 때
// 한쪽만 고치게 된다.
router.get("/source-types", requireOwner, async (req, res) => {
  // AnimeThemes 연도 범위를 저쪽에 물어 채우므로 비동기다(하루에 한 번만 묻고 캐시한다)
  res.json({ types: await autoplaySources.catalog() });
});

// AI 보조. 키는 .env 에 있고 값을 내려보내지 않는다. 있는지 없는지만 알려 준다.
// 브라우저로 내려보내는 순간 XSS 하나로 새어 나갈 수 있고, 화면에 필요한 것은 유무뿐이다.
// 기본 프롬프트도 같이 준다. 화면이 베껴 두면 한쪽만 고치게 된다.
router.get("/ai/state", requireOwner, (req, res) => {
  // 키 값은 절대 안 내려간다. 프로바이더마다 있는지 없는지만 알린다(config/ai-keys.yaml).
  const keys = aiConfig.aiKeys();
  res.json({
    hasKey: Object.fromEntries(Object.keys(assist.PROVIDER_SPECS).map((name) => [name, !!keys[name]])),
    // 주소·키 필요 여부는 서버가 안다. 화면이 베껴 두면 한쪽만 고치게 된다
    providers: Object.entries(assist.PROVIDER_SPECS).map(([value, spec]) => ({ value, ...spec })),
    pingText: assist.PING_TEXT,
    defaultSections: assist.DEFAULT_SECTIONS,
    defaultLine: assist.DEFAULT_LINE,
  });
});

// 키를 고쳐 쓴다. 쓰기 전용이다. 적어 보낸 칸만 바꾸고, 돌려주는 것은 값이 아니라 유무다.
// 로그에도 이름만 남긴다.
/**
 * 그 모델이 받는 칸. 프로필(data/ai-models.json)이 정한다.
 * 화면은 여기서 받은 위젯·그룹 그대로 그린다.
 */
router.get("/ai/fields", requireOwner, (req, res) => {
  const registry = assist.PROVIDER_SPECS[String(req.query.provider || "")]?.registry;
  if (!registry) return res.json({ known: false, fields: [], models: [] });

  const model = String(req.query.model || "");
  res.json({
    known: !!models.profileOf(registry, model),
    fields: model ? models.fieldsOf(registry, model) : [],
    groups: model ? models.groupsOf(registry, model) : [],
    // 프로필이 아는 모델들. 목록에 이름표를 입힐 때 쓴다
    models: models.modelsOf(registry),
  });
});

/**
 * 프롬프트 칸이 적는 동안 세어 보는 곳. 본문만 센다(감싸는 몫은 미리보기에서 본다).
 * 클로드는 공개 토크나이저가 없어 저쪽에 물어본다. 무료이고 그쪽이 정확하다.
 */
router.post("/ai/tokens", requireOwner, async (req, res) => {
  const provider = String(req.body?.provider || "");
  const model = String(req.body?.model || "");
  const by = tokens.tokenizerFor(assist.PROVIDER_SPECS[provider]?.registry, model);

  const texts = Array.isArray(req.body?.texts) ? req.body.texts : [];
  if (texts.length > 50) return res.status(400).json({ error: "한 번에 50칸까지" });
  const cut = texts.map((one) => String(one ?? "").slice(0, 200000));

  if (by === "claude") {
    const apiKey = aiConfig.aiKeyOf(provider);
    const wrap = tokens.FRAMING.anthropic.perRequest;
    const each = await Promise.all(cut.map(async (one) => (one ? await tokens.countByAnthropic([{ role: "user", content: one }], { model, apiKey }) : 0)));
    if (each.every((one) => one !== null)) {
      const bare = each.map((one) => (one ? one - wrap : 0));
      return res.json({ each: bare, total: bare.reduce((sum, one) => sum + one, 0), by: "claude", exact: true });
    }
  }

  const counted = cut.map((one) => tokens.count(one, by));
  const each = counted.map((one) => one.tokens);
  res.json({ each, total: each.reduce((sum, one) => sum + one, 0), by: counted[0]?.by ?? by, exact: counted[0]?.exact ?? true });
});

/** 모델 프로필 갱신. 해시가 같으면 받지 않는다. pnpm run update:models 와 같은 길이다. */
router.post("/ai/models/refresh", requireOwner, async (req, res) => {
  try {
    const registries = [
      ...new Set(
        Object.values(assist.PROVIDER_SPECS)
          .map((one) => one.registry)
          .filter(Boolean),
      ),
    ];
    res.json(await models.refresh({ registries, force: !!req.body?.force }));
  } catch (error) {
    res.status(502).json({ error: error.message || "모델 정보를 받지 못했습니다." });
  }
});

/**
 * 판정 테스트 1. 유튜브 주소로 후보를 읽는다. 아무것도 보내지 않는다.
 */
router.post("/ai/judge/lookup", requireOwner, async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
  if (!urls.length) return res.status(400).json({ error: "유튜브 주소를 적어 주세요." });
  if (urls.length > 20) return res.status(400).json({ error: "한 번에 20개까지" });

  res.json({ candidates: await assist.candidatesFromUrls(urls) });
});

/** 그 후보들이 프롬프트에 어떻게 적히는지. 목록 형식·장르를 고치는 대로 다시 그린다. */
router.post("/ai/judge/lines", requireOwner, (req, res) => {
  const cands = (Array.isArray(req.body?.candidates) ? req.body.candidates : []).filter((one) => one && !one.error && one.title).slice(0, 20);
  res.json({ lines: assist.renderList({ list: req.body?.list }, cands, String(req.body?.genre || "록")) });
});

/** 판정 테스트 2. 그 후보들을 실제로 보내 곡별 판정을 받는다. */
router.post("/ai/judge/run", requireOwner, async (req, res) => {
  const cands = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
  res.json(await assist.judgeTest(req.body?.data, cands, String(req.body?.genre || "록")));
});

router.put("/ai/keys", requireOwner, (req, res) => {
  const keys = req.body?.keys;
  if (!keys || typeof keys !== "object") return res.status(400).json({ error: "저장할 내용이 없습니다." });

  try {
    log.warn({ sub: "admin" }, `대시보드에서 AI 키 저장: ${Object.keys(keys).join(", ")}. 실행 ${req.session.user.username || req.session.user.id}`);
    res.json({ hasKey: aiConfig.saveAiKeys(keys) });
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

// 프롬프트는 설정과 딴 파일에 산다(config/ai-prompt.chatml). YAML 이 아니라 ChatML 글이라
// /config/:name 통로를 못 탄다. 여기서 따로 받는다.
router.get("/ai/prompt", requireOwner, (req, res) => {
  res.json({ sections: aiConfig.aiPrompt() });
});

router.put("/ai/prompt", requireOwner, (req, res) => {
  const sections = req.body?.sections;
  if (!Array.isArray(sections)) return res.status(400).json({ error: "저장할 내용이 없습니다." });

  const problems = aiConfig.promptProblems(sections, true);
  if (problems.length) return res.status(400).json({ error: problems[0], problems });

  try {
    log.warn({ sub: "admin" }, `대시보드에서 설정 저장: ai-prompt.chatml. 실행 ${req.session.user.username || req.session.user.id}`);
    res.json({ sections: aiConfig.saveAiPrompt(sections) });
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

// 유튜브 쿠키. 연령 제한 영상에만 쓰이고, 유튜브가 브라우저 쪽에서 세션을 돌리면 만료 시각과
// 무관하게 무효가 된다. 그때마다 서버에 들어가 파일을 갈아 끼우는 대신 여기서 덮어쓴다.
//
// 키와 같은 취급이다. 값은 어느 통로로도 돌아나가지 않고, 있는지 없는지만 알린다.
function cookieState() {
  return {
    source: YouTube.statusSnapshot().cookies,
    hasFile: cookieConfig.cookiesReady(),
    // 0이 아니면 지금 덮어써도 그 yt-dlp 가 끝나면서 옛 내용으로 되돌린다
    inFlight: YouTube.cookieRunsInFlight(),
  };
}

router.get("/cookies", requireOwner, (req, res) => res.json(cookieState()));

router.put("/cookies", requireOwner, (req, res) => {
  const text = req.body?.text;
  if (typeof text !== "string") return res.status(400).json({ error: "저장할 내용이 없습니다." });

  try {
    // 내용은 절대 남기지 않는다. 로그인된 세션 그 자체다
    log.warn({ sub: "admin" }, `대시보드에서 유튜브 쿠키 ${text.trim() ? "저장" : "삭제"}. 실행 ${req.session.user.username || req.session.user.id}`);
    cookieConfig.saveCookies(text);
    res.json(cookieState());
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

// 나갈 것을 만들어만 본다. 보내지 않는다. 조립은 봇이 쓰는 코드 그대로다.
router.post("/ai/preview", requireOwner, async (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== "object") return res.status(400).json({ error: "볼 내용이 없습니다." });
  res.json(await assist.preview(data));
});

// 무료 확인. 모델 목록만 받는다. 추론을 안 돌리니 토큰이 안 든다.
// 화면의 모델 고르는 칸도 이것으로 채운다(모델 이름을 코드에 적어 두지 않는 까닭).
router.post("/ai/models", requireOwner, async (req, res) => {
  res.json(await assist.listModels(req.body?.data || {}));
});

// 유료 확인. 짧은 물음 하나를 실제로 생성시킨다. 판정 프롬프트는 안 쓴다.
router.post("/ai/ping", requireOwner, async (req, res) => {
  res.json(await assist.ping(req.body?.data || {}));
});

router.get("/config/:name", requireOwner, (req, res) => {
  const { name } = req.params;
  if (!CONFIG_NAMES.includes(name)) return res.status(404).json({ error: "그런 설정이 없습니다." });

  try {
    res.json({ name, data: yamlStore.load(name) });
  } catch (error) {
    // 파일이 없거나 문법이 깨졌다. 화면이 이유를 그대로 보여줄 수 있게 넘긴다
    res.status(409).json({ error: error.message, code: error.code || null });
  }
});

router.put("/config/:name", requireOwner, (req, res) => {
  const { name } = req.params;
  if (!CONFIG_NAMES.includes(name)) return res.status(404).json({ error: "그런 설정이 없습니다." });

  const data = req.body?.data;
  if (!data || typeof data !== "object") return res.status(400).json({ error: "저장할 내용이 없습니다." });

  // 저장 전에 본다. 깨진 값을 파일에 남기느니 거절한다. 봇이 그 파일로 돌기 때문이다.
  const problems = VALIDATORS[name](data);
  if (problems.length) return res.status(400).json({ error: problems[0], problems });

  try {
    const saved = yamlStore.save(name, data);
    log.warn({ sub: "admin" }, `대시보드에서 설정 저장: ${name}.yaml. 실행 ${req.session.user.username || req.session.user.id}`);
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

// 권한 수준 오버라이드. { tier: "owner"|"moderator"|"dj"|"user"|null }. null이면 해제.
// requireOwner가 오버라이드를 무시하므로(실 운영자 기준) 낮춘 뒤에도 여기로 되돌아올 수 있다.
router.post("/view-as", requireOwner, (req, res) => {
  const { tier } = req.body || {};
  if (tier !== null && !TIERS.includes(tier)) {
    return res.status(400).json({ error: "권한 수준이 올바르지 않습니다" });
  }

  if (tier === null) delete req.session.viewAs;
  else req.session.viewAs = tier;

  log.info({ sub: "admin" }, `권한 수준 오버라이드: ${tier || "해제"}. 실행 ${req.session.user.username || req.session.user.id}`);
  res.json({ viewAs: getViewAs(req) });
});

export default router;
export { router as "module.exports" };
