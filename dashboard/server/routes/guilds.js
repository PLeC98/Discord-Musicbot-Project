const express = require("express");
const log = require("../../../src/logger").child({ category: "dashboard" });
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");
const requireControl = require("../middleware/requireControl");
const { resolveMember, toApiError } = requireControl;
const { checkControl, checkAdd, checkSkip, checkRemoveTrack, isModerator } = require("../../../src/permissions");
const { ChannelType } = require("discord.js");
const GuildSettingsManager = require("../../../src/GuildSettingsManager");
const SponsorBlock = require("../../../src/SponsorBlock");
const config = require("../../../config");

// SponsorBlock 카테고리 라벨 (대시보드 표시용) — SKIP_CATEGORIES와 키 일치
const SB_CATEGORY_LABELS = {
  music_offtopic: "음악이 아닌 구간",
  intro: "인트로/무음 구간",
  outro: "최종 화면 구간",
  sponsor: "후원이나 협찬 구간",
  selfpromo: "무대가 홍보 구간",
  interaction: "상호작용 알림 구간",
  preview: "미리보기/요약 구간",
  hook: "후킹/인사말",
  filler: "잡담/농담",
};
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const DashboardEvents = require("../../../src/DashboardEvents");

const MANAGE_GUILD = 0x20;

// 곡 추가는 yt-dlp 호출을 유발하므로 별도 엄격 제한 (플레이리스트도 1요청이라 정상 사용엔 여유)
const queueLimiter = rateLimit({
  windowMs: config.dashboard.rateLimit.windowMs,
  limit: config.dashboard.rateLimit.queueMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.user?.id || ipKeyGenerator(req.ip),
  message: { error: "곡 추가 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요" },
});

// 대시보드발 상태 변경(비-GET 성공) → 해당 길드 SSE 구독자에게 넛지.
// req.params는 스택이 풀리면 복원되므로, 요청 시작 시점의 라우터-상대 URL 첫 세그먼트(=guildId)를
// 클로저로 잡아 finish에서 사용. (Discord측/내부 변화는 MusicEmbedManager 훅이 담당)
router.use((req, res, next) => {
  if (req.method !== "GET") {
    const m = req.originalUrl.match(/\/guilds\/([^/?]+)/);
    const guildId = m && m[1];
    if (guildId) {
      res.on("finish", () => {
        if (res.statusCode < 400) DashboardEvents.notify(guildId);
      });
    }
  }
  next();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getPlayer(req, res, guildId) {
  const client = req.app.locals.discordClient;
  if (!client?.isReady()) {
    res.status(503).json({ error: "봇이 아직 준비되지 않았습니다" });
    return null;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    res.status(404).json({ error: "서버를 찾을 수 없습니다" });
    return null;
  }

  // 조회 인가는 세션의 굳은 길드 목록이 아니라 실멤버십으로 판정 (추방 즉시 차단).
  // 관리자(봇 소유자)는 멤버십과 무관하게 통과. member는 후속 권한 계산에 재사용.
  let member = null;
  try {
    member = await guild.members.fetch(req.session.user.id); // 캐시 우선, 미스 시 REST 1회
  } catch {
    if (!req.session.user.isAdmin) {
      res.status(403).json({ error: "접근 권한이 없습니다" });
      return null;
    }
  }

  return { client, guild, player: client.players?.get(guildId) || null, member };
}

function playerState(player) {
  if (!player) return { playing: false, paused: false, queue: [], currentTrack: null };
  const status = player.getStatus();
  const track = player.currentTrack;
  return {
    playing: status.playing,
    paused: status.paused,
    volume: status.volume,
    loop: status.loop,
    shuffle: status.shuffle,
    currentTrack: track
      ? {
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          thumbnail: track.thumbnail,
          url: track.url,
          platform: track.platform,
          currentTime: Math.floor((player.getCurrentTime?.() || 0) / 1000),
          requestedBy: track.requestedBy ? { id: track.requestedBy.id, username: track.requestedBy.username } : null,
          // SponsorBlock 자동 스킵 구간(초, 카테고리 포함) + 하이라이트 지점 — 대시보드 진행바 마커용
          sponsorSegments: (track.sponsor?.skipSegments || []).map((s) => ({ start: s.start, end: s.end, categories: s.categories || [] })),
          highlightAt: track.sponsor?.highlightAt ?? null,
        }
      : null,
    hasPrevious: (player.previousTracks?.length ?? 0) > 0,
    queue: (player.queue || []).map((t, i) => ({
      index: i,
      title: t.title,
      artist: t.artist,
      duration: t.duration,
      thumbnail: t.thumbnail,
      platform: t.platform,
      requestedBy: t.requestedBy ? { id: t.requestedBy.id, username: t.requestedBy.username } : null,
    })),
  };
}

// ── 입력 검증 ─────────────────────────────────────────────────────────────────
// 사용자 입력은 타입·범위를 먼저 확정 — 비문자열 body의 TypeError(async 핸들러라 500조차 아닌
// unhandled rejection), parseFloat/parseInt의 느슨한 허용("Infinity", "50junk")이
// 하위 로직·로그·yt-dlp로 흘러가지 않게 한다.

const QUERY_MAX_LEN = 500;

// 문자열 확인 + 제어문자(CR/LF/NUL 등) 정규화 — 로그 위조·외부 도구 인자 오염 방지.
// 부적합 입력은 null (호출부에서 400)
function sanitizeQuery(raw) {
  if (typeof raw !== "string" || raw.length > QUERY_MAX_LEN) return null;
  const query = raw.replace(/[\x00-\x1f\x7f]/g, " ").trim();
  return query || null;
}

// 유한 정수 파싱 — parseInt와 달리 "50junk"·Infinity·소수를 전부 NaN으로 거부
function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

// ── Read endpoints ────────────────────────────────────────────────────────────

// Mutual guilds (user + bot)
router.get("/", requireAuth, async (req, res) => {
  const client = req.app.locals.discordClient;
  if (!client?.isReady()) return res.status(503).json({ error: "봇이 아직 준비되지 않았습니다" });

  // 후보는 세션의 길드 목록이지만 표시는 실멤버십으로 필터 (추방된 길드는 목록에서 제외).
  const candidates = (req.session.user.guilds || []).filter((g) => client.guilds.cache.has(g.id));
  const verified = await Promise.all(
    candidates.map(async (g) => {
      if (req.session.user.isAdmin) return g; // 봇 소유자는 실멤버십과 무관
      try {
        await client.guilds.cache.get(g.id).members.fetch(req.session.user.id); // 캐시 우선
        return g;
      } catch {
        return null; // 더 이상 멤버 아님 → 목록에서 제외
      }
    }),
  );

  const mutual = verified.filter(Boolean).map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.webp?size=64` : null,
    isAdmin: (parseInt(g.permissions) & MANAGE_GUILD) === MANAGE_GUILD,
    hasPlayer: client.players?.has(g.id) || false,
    memberCount: client.guilds.cache.get(g.id).memberCount,
  }));

  res.json({ guilds: mutual });
});

// SSE — 서버 목록의 재생 상태 실시간 갱신. 사용자 단위 멀티플렉스(상호+멤버 길드 전체를 한 연결로).
router.get("/events", requireAuth, async (req, res) => {
  const client = req.app.locals.discordClient;
  if (!client?.isReady()) return res.status(503).json({ error: "봇이 아직 준비되지 않았습니다" });

  // 구독할 길드 집합 = 상호 길드 중 실멤버십 확인된 것
  const candidates = (req.session.user.guilds || []).filter((g) => client.guilds.cache.has(g.id));
  const guildIds = new Set();
  await Promise.all(
    candidates.map(async (g) => {
      if (req.session.user.isAdmin) {
        guildIds.add(g.id);
        return;
      }
      try {
        await client.guilds.cache.get(g.id).members.fetch(req.session.user.id);
        guildIds.add(g.id);
      } catch {
        /* 멤버 아님 → 구독 안 함 */
      }
    }),
  );

  DashboardEvents.addListClient(res, guildIds, req.session.user.id);
});

// Player state
router.get("/:guildId/player", requireAuth, async (req, res) => {
  const ctx = await getPlayer(req, res, req.params.guildId);
  if (!ctx) return;
  const { guild, member } = ctx;

  const botInVoice = !!guild?.members?.me?.voice?.channel;
  const userInVoice = !!member?.voice?.channel;

  // 제어/추가 가능 여부 — UI 표시용 (실제 강제는 각 엔드포인트가 담당). member는 getPlayer가 실멤버십으로 확보.
  let controllable = !!req.session.user.isAdmin;
  let addable = controllable;
  if (!controllable && member) {
    controllable = !(await checkControl(member));
    addable = !checkAdd(member);
  }

  // 서버 설정(⚙) 진입 가능 여부 — 모더레이터/봇 소유자만 (설정 화면 GET 게이트와 동일 기준)
  const manageable = !!req.session.user.isAdmin || (member ? isModerator(member) : false);

  res.json({ ...playerState(ctx.player), botInVoice, userInVoice, canControl: controllable, canAdd: addable, canManage: manageable, userId: req.session.user.id });
});

// SSE — 플레이어 상태 변화 넛지 (하이브리드: 넛지 받으면 클라이언트가 GET /player 재호출)
router.get("/:guildId/player/events", requireAuth, async (req, res) => {
  const ctx = await getPlayer(req, res, req.params.guildId); // 비멤버 403 / 봇 미참여 404
  if (!ctx) return;
  DashboardEvents.addClient(req.params.guildId, res, req.session.user.id);
});

// ── Settings endpoints ────────────────────────────────────────────────────────

// 서버 설정 조회 — DJ 역할·봇 전용 채널 현황 + 드롭다운용 역할/채널 목록.
// 조회·변경 모두 모더레이터(서버 관리층)/봇 소유자 전용 (사용자 결정 — 일반 멤버는 ⚙ 진입 자체 불가).
router.get("/:guildId/settings", requireAuth, async (req, res) => {
  const ctx = await getPlayer(req, res, req.params.guildId);
  if (!ctx) return;
  const { guild, member } = ctx;

  const canEdit = !!req.session.user.isAdmin || (member ? isModerator(member) : false);
  if (!canEdit) {
    return res.status(403).json({ error: "서버 설정은 모더레이터(서버 관리 권한)만 볼 수 있습니다" });
  }

  const djRoleIds = (await GuildSettingsManager.getDjRoles(guild.id)).filter((id) => guild.roles.cache.has(id));
  const rawChannelId = await GuildSettingsManager.getBotChannel(guild.id);
  const botChannelId = rawChannelId && guild.channels.cache.has(rawChannelId) ? rawChannelId : null;

  // @everyone(길드 ID와 동일)은 제외 — "전원 DJ"는 미설정이 이미 그 의미
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color ? r.hexColor : null }));

  // /setchannel과 동일하게 일반 텍스트 채널만
  const channels = [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildText)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({ id: c.id, name: c.name }));

  // SponsorBlock 서버별 설정 (유효값 + 마스터 상태 + 카테고리 목록)
  const sbEff = GuildSettingsManager.resolveSponsorBlock(guild.id);
  const sponsorblock = {
    masterEnabled: config.sponsorblock.enabled, // 전역 off면 서버 설정 무의미
    enabled: sbEff.enabled,
    categories: sbEff.categories,
    available: SponsorBlock.SKIP_CATEGORIES.map((id) => ({ id, label: SB_CATEGORY_LABELS[id] || id })),
  };

  res.json({ guildName: guild.name, canEdit, djRoleIds, botChannelId, roles, channels, sponsorblock });
});

// 서버 설정 변경 — 모더레이터(서버 관리층)/봇 소유자만. /setdjrole·/setchannel과 동일 기준.
// 부분 적용 방지를 위해 전체 검증 후 일괄 반영.
router.put("/:guildId/settings", requireAuth, async (req, res) => {
  const ctx = await getPlayer(req, res, req.params.guildId);
  if (!ctx) return;
  const { guild, member } = ctx;

  if (!req.session.user.isAdmin && !(member && isModerator(member))) {
    return res.status(403).json({ error: "서버 설정을 변경할 권한이 없습니다 (서버 관리 권한 필요)" });
  }

  const { djRoleIds, botChannelId, sponsorblock } = req.body || {};

  // SponsorBlock 검증 (선택적) — enabled(bool)·categories(유효 카테고리 배열)
  let nextSponsor; // undefined=변경 없음
  if (sponsorblock !== undefined) {
    if (typeof sponsorblock !== "object" || sponsorblock === null) {
      return res.status(400).json({ error: "sponsorblock 설정 형식이 올바르지 않습니다" });
    }
    const enabled = typeof sponsorblock.enabled === "boolean" ? sponsorblock.enabled : null;
    let categories = null;
    if (sponsorblock.categories !== undefined) {
      if (!Array.isArray(sponsorblock.categories) || sponsorblock.categories.some((c) => typeof c !== "string")) {
        return res.status(400).json({ error: "sponsorblock.categories는 문자열 배열이어야 합니다" });
      }
      const valid = new Set(SponsorBlock.SKIP_CATEGORIES);
      categories = [...new Set(sponsorblock.categories.filter((c) => valid.has(c)))];
    }
    nextSponsor = { enabled, categories };
  }

  // 검증
  let nextRoles = null;
  if (djRoleIds !== undefined) {
    if (!Array.isArray(djRoleIds) || djRoleIds.some((id) => typeof id !== "string")) {
      return res.status(400).json({ error: "djRoleIds는 역할 ID 문자열 배열이어야 합니다" });
    }
    nextRoles = [...new Set(djRoleIds)].filter((id) => id !== guild.id && guild.roles.cache.has(id));
    if (nextRoles.length > 25) {
      // 디스코드 /setdjrole GUI(셀렉트 메뉴 최대 25개)와 정합 유지
      return res.status(400).json({ error: "DJ 역할은 최대 25개까지 지정할 수 있습니다" });
    }
  }

  let nextChannel; // undefined=변경 없음, null=해제, string=지정
  if (botChannelId !== undefined) {
    if (botChannelId === null || botChannelId === "") {
      nextChannel = null;
    } else {
      const ch = typeof botChannelId === "string" ? guild.channels.cache.get(botChannelId) : null;
      if (!ch || ch.type !== ChannelType.GuildText) {
        return res.status(400).json({ error: "봇 전용 채널은 일반 텍스트 채널이어야 합니다" });
      }
      nextChannel = botChannelId;
    }
  }

  // 반영
  if (nextRoles !== null) {
    if (nextRoles.length) await GuildSettingsManager.setDjRoles(guild.id, nextRoles);
    else await GuildSettingsManager.clearDjRoles(guild.id);
  }
  if (nextChannel !== undefined) {
    if (nextChannel) await GuildSettingsManager.setBotChannel(guild.id, nextChannel);
    else await GuildSettingsManager.clearBotChannel(guild.id);
  }
  if (nextSponsor !== undefined) {
    await GuildSettingsManager.setSponsorBlock(guild.id, nextSponsor);
  }

  log.info(`서버 설정 변경: ${guild.name} (${guild.id}) by ${req.session.user.username || req.session.user.id}`);
  res.json({ success: true });
});

// ── Control endpoints ─────────────────────────────────────────────────────────

// Join user's voice channel
router.post("/:guildId/player/join", requireAuth, async (req, res) => {
  const { guildId } = req.params;
  const ctx = await getPlayer(req, res, guildId);
  if (!ctx) return;
  const { client } = ctx;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.status(404).json({ error: "서버를 찾을 수 없습니다" });

  let member;
  try {
    member = await guild.members.fetch(req.session.user.id);
  } catch (e) {
    return res.status(400).json({ error: "서버에서 사용자를 찾을 수 없습니다" });
  }

  const voiceChannel = member.voice.channel;
  if (!voiceChannel) return res.status(400).json({ error: "음성 채널에 참가해 있지 않습니다" });

  const permissions = voiceChannel.permissionsFor(guild.members.me);
  if (!permissions.has("Connect") || !permissions.has("Speak")) {
    return res.status(403).json({ error: "봇이 해당 채널에 접속할 권한이 없습니다" });
  }

  // Discord 쪽 /join과 동일 — 봇이 이미 다른 채널에서 사용 중이면 이동 불가.
  // (관리자의 봇 이동은 Discord 네이티브 드래그 기능으로 충분 — API 이동 미지원, 사용자 결정)
  const botChannel = guild.members.me?.voice?.channel;
  if (botChannel && botChannel.id !== voiceChannel.id) {
    return res.status(403).json({ error: "봇이 이미 다른 음성 채널에서 사용 중입니다" });
  }

  let player = client.players.get(guildId);
  if (!player) {
    const MusicPlayer = require("../../../src/MusicPlayer");
    const MusicEmbedManager = require("../../../src/MusicEmbedManager");
    if (!client.musicEmbedManager) {
      client.musicEmbedManager = new MusicEmbedManager(client);
    }
    player = new MusicPlayer(guild, null, voiceChannel);
    client.players.set(guildId, player);
  } else {
    player.voiceChannel = voiceChannel;
  }

  try {
    await player.connect();
  } catch (e) {
    player.releaseResources();
    player.disconnect();
    client.players.delete(guildId);
    return res.status(500).json({ error: "음성 채널 접속에 실패했습니다" });
  }

  if (!player.currentTrack) {
    player.updateVoiceStatus(config.voiceStatus.idleText).catch(() => {});
  }

  const botInVoice = !!guild?.members?.me?.voice?.channel;
  const userInVoice = !!member?.voice?.channel;
  // 방금 자기 채널로 봇을 불렀으므로 재적 규칙은 통과 — 계층(DJ 여부)만 판정에 반영됨
  const controllable = req.session.user.isAdmin || !(await checkControl(member));
  const addable = req.session.user.isAdmin || !checkAdd(member);
  res.json({ ...playerState(player), botInVoice, userInVoice, canControl: controllable, canAdd: addable, userId: req.session.user.id });
});

// Toggle pause / resume
router.post("/:guildId/player/pause", requireAuth, requireControl, async (req, res) => {
  const ctx = await getPlayer(req, res, req.params.guildId);
  if (!ctx) return;
  const { player, client } = ctx;
  if (!player?.currentTrack) return res.status(409).json({ error: "현재 재생 중인 음악이 없습니다." });

  if (player.paused) {
    player.resume();
  } else {
    player.pause();
  }

  if (client.musicEmbedManager) client.musicEmbedManager.updateNowPlayingEmbed(player).catch(() => {});
  res.json(playerState(player));
});

// Previous
router.post("/:guildId/player/previous", requireAuth, requireControl, async (req, res) => {
  const ctx = await getPlayer(req, res, req.params.guildId);
  if (!ctx) return;
  const { player } = ctx;
  if (!player?.currentTrack) return res.status(409).json({ error: "현재 재생 중인 음악이 없습니다." });
  // 한곡 반복 중에는 이전곡 = 현재 곡 재시작이라 기록이 없어도 유효
  if (!player.previousTracks?.length && player.loop !== "track") return res.status(409).json({ error: "이전 곡이 없습니다." });

  player.previous();
  res.json({ ok: true });
});

// Skip — DJ 계층이거나 현재 곡의 요청자 본인이면 가능
router.post("/:guildId/player/skip", requireAuth, async (req, res) => {
  const ctx = await getPlayer(req, res, req.params.guildId);
  if (!ctx) return;
  const { player } = ctx;
  if (!player?.currentTrack) return res.status(409).json({ error: "현재 재생 중인 음악이 없습니다." });

  if (!req.session.user.isAdmin) {
    const mctx = await resolveMember(req, res);
    if (!mctx) return;
    const err = await checkSkip(mctx.member, player);
    if (err) return res.status(403).json({ error: toApiError(err) });
  }

  player.skip();
  res.json({ ok: true });
});

// Stop
router.post("/:guildId/player/stop", requireAuth, requireControl, async (req, res) => {
  const { guildId } = req.params;
  const ctx = await getPlayer(req, res, guildId);
  if (!ctx) return;
  const { player, client } = ctx;
  if (!player) return res.status(409).json({ error: "현재 재생 중인 음악이 없습니다." });

  player.stop();
  client.players.delete(guildId);
  if (client.musicEmbedManager) client.musicEmbedManager.handlePlaybackEnd(player).catch(() => {});
  res.json({ ok: true });
});

// Seek  { position: seconds }
router.post("/:guildId/player/seek", requireAuth, requireControl, async (req, res) => {
  const ctx = await getPlayer(req, res, req.params.guildId);
  if (!ctx) return;
  const { player } = ctx;
  if (!player?.currentTrack) return res.status(409).json({ error: "현재 재생 중인 음악이 없습니다." });
  // 곡 해석/스트림 셋업 중(play() 진행 중)엔 seek 금지 — 동시 play() 레이스로 currentTrack이
  // 중간에 null 돼 크래시하던 문제 방지. 아직 실제 재생 전이므로 seek 대상 자체가 없다.
  if (player.isPlayStarting) return res.status(409).json({ error: "재생을 준비 중입니다. 잠시 후 다시 시도해 주세요." });

  const positionSec = Number(req.body.position);
  // Number.isFinite: parseFloat와 달리 "Infinity"(라이브 duration 0에서 클램프를 뚫음)·비숫자 문자열 거부
  if (!Number.isFinite(positionSec) || positionSec < 0) return res.status(400).json({ error: "재생 위치가 올바르지 않습니다." });

  const durationSec = player.currentTrack.duration ?? 0;
  const clampedSec = durationSec > 0 ? Math.min(positionSec, durationSec - 1) : positionSec;

  try {
    await player.play(null, Math.floor(clampedSec * 1000));
    res.json({ ok: true, position: clampedSec });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Volume  { volume: 0-100 }
router.post("/:guildId/player/volume", requireAuth, requireControl, async (req, res) => {
  const ctx = await getPlayer(req, res, req.params.guildId);
  if (!ctx) return;
  const { player } = ctx;
  if (!player) return res.status(409).json({ error: "현재 재생 중인 음악이 없습니다." });

  const vol = toInt(req.body.volume);
  if (isNaN(vol) || vol < 0 || vol > 100) return res.status(400).json({ error: "볼륨은 0에서 100 사이여야 합니다." });

  player.setVolume(vol);
  res.json(playerState(player));
});

// Loop  { mode: 'off' | 'track' | 'queue' }
router.post("/:guildId/player/loop", requireAuth, requireControl, async (req, res) => {
  const ctx = await getPlayer(req, res, req.params.guildId);
  if (!ctx) return;
  const { player, client } = ctx;
  if (!player?.currentTrack) return res.status(409).json({ error: "현재 재생 중인 음악이 없습니다." });

  const mode = req.body.mode;
  if (!["off", "track", "queue"].includes(mode)) return res.status(400).json({ error: "반복 모드가 올바르지 않습니다." });

  player.loop = mode === "off" ? false : mode;
  if (client.musicEmbedManager) client.musicEmbedManager.updateNowPlayingEmbed(player).catch(() => {});
  res.json(playerState(player));
});

// Shuffle
router.post("/:guildId/player/shuffle", requireAuth, requireControl, async (req, res) => {
  const ctx = await getPlayer(req, res, req.params.guildId);
  if (!ctx) return;
  const { player, client } = ctx;
  if (!player || player.queue.length < 2) return res.status(409).json({ error: "대기열에 곡이 2개 이상 있어야 합니다." });

  player.shuffleQueue();
  if (client.musicEmbedManager) client.musicEmbedManager.updateNowPlayingEmbed(player).catch(() => {});
  res.json(playerState(player));
});

// Add track to queue  { query: string } — 곡 추가는 전 계층 가능, 재적 규칙만 적용
router.post("/:guildId/player/queue", requireAuth, queueLimiter, async (req, res) => {
  const { guildId } = req.params;
  const ctx = await getPlayer(req, res, guildId);
  if (!ctx) return;
  const { player, client } = ctx;

  if (!player) return res.status(409).json({ error: "봇이 음성 채널에 없습니다. 먼저 봇을 참가시켜 주세요" });

  if (!req.session.user.isAdmin) {
    const mctx = await resolveMember(req, res);
    if (!mctx) return;
    const err = checkAdd(mctx.member);
    if (err) return res.status(403).json({ error: toApiError(err) });
  }

  const query = sanitizeQuery(req.body.query);
  if (!query) return res.status(400).json({ error: `검색어를 입력해 주세요 (문자열, 최대 ${QUERY_MAX_LEN}자)` });

  log.info({ sub: "play" }, `Dashboard | guild=${guildId} | user=${req.session.user.globalName || req.session.user.username} | query="${query}"`);

  try {
    const requester = {
      id: req.session.user.id,
      username: req.session.user.globalName || req.session.user.username,
    };

    // 플레이어가 유휴 상태이면 addTrack()이 직접 재생을 시작하므로, 여기서 play()를 다시 호출하면 곡이 처음부터 재시작된다.
    // single=true(재생목록에서 첫 곡만) 옵션 지원.
    const result = await player.addTrack(query, requester, { single: req.body.single === true });

    if (!result.success) return res.status(400).json({ error: result.message });

    if (client.musicEmbedManager && player.currentTrack) {
      client.musicEmbedManager.updateNowPlayingEmbed(player).catch(() => {});
    }

    res.json(playerState(player));
  } catch (err) {
    log.error("Dashboard addTrack error:", err);
    res.status(500).json({ error: "곡 추가에 실패했습니다" });
  }
});

// Remove track from queue  DELETE /:guildId/player/queue/:index — DJ 계층이거나 그 곡의 요청자 본인
router.delete("/:guildId/player/queue/:index", requireAuth, async (req, res) => {
  const ctx = await getPlayer(req, res, req.params.guildId);
  if (!ctx) return;
  const { player } = ctx;
  if (!player) return res.status(409).json({ error: "현재 재생 중인 음악이 없습니다." });

  const index = toInt(req.params.index);
  if (isNaN(index) || index < 0 || index >= player.queue.length) {
    return res.status(400).json({ error: "대기열 항목 번호가 올바르지 않습니다." });
  }

  if (!req.session.user.isAdmin) {
    const mctx = await resolveMember(req, res);
    if (!mctx) return;
    const err = await checkRemoveTrack(mctx.member, player.queue[index]);
    if (err) return res.status(403).json({ error: toApiError(err) });
  }

  player.removeFromQueue(index);
  res.json(playerState(player));
});

// Move track in queue  { from: number, to: number }
router.post("/:guildId/player/queue/move", requireAuth, requireControl, async (req, res) => {
  const ctx = await getPlayer(req, res, req.params.guildId);
  if (!ctx) return;
  const { player, client } = ctx;
  if (!player) return res.status(409).json({ error: "현재 재생 중인 음악이 없습니다." });

  const from = toInt(req.body.from);
  const to = toInt(req.body.to);

  if (isNaN(from) || isNaN(to) || from < 0 || to < 0 || from >= player.queue.length || to >= player.queue.length) {
    return res.status(400).json({ error: "이동할 대기열 위치가 올바르지 않습니다." });
  }

  player.moveInQueue(from, to);
  if (client.musicEmbedManager) client.musicEmbedManager.updateNowPlayingEmbed(player).catch(() => {});
  res.json(playerState(player));
});

module.exports = router;
