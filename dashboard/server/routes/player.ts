// 재생. 상태 읽기 · 음성 참가 · 재생 조작(usecases/controls) · 곡 추가(usecases/addTracks)

import express, { type Request, type Response, type Router } from "express";
import type { Guild, VoiceBasedChannel } from "discord.js";
import logger from "../../../src/infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { requireAuth, signedIn } from "../middleware/requireAuth.ts";
import { resolveMember, toApiError } from "../middleware/requireControl.ts";
import { checkControl, checkAdd, isModerator } from "../../../src/usecases/permissions.ts";
import * as controls from "../../../src/usecases/controls.ts";
import { controlApiError, type Refusal } from "../../../src/ui/controlMessages.ts";
import type { More } from "../../../src/usecases/playlistMore.ts";
import { messageOf } from "../../../src/rules/errorKind.ts";
import { requestPlayback, continueCollection, ensurePlayer } from "../../../src/usecases/addTracks.ts";
import { validState, LIFETIME_MS } from "../../../src/usecases/playlistMore.ts";
import config from "../../../config.ts";
import { isOwner } from "../owner.ts";
import { shadowMember } from "../viewAs.ts";
import { getPlayer, voiceFlags, toInt } from "../guildAccess.ts";
import { queueTrack, queueWindow, playerState } from "../playerView.ts";
import { parse, SeekBody, QueueWindowQuery, AddBody, MoreCount } from "../requestSchemas.ts";
import { bestEffort } from "../../../src/infra/bestEffort.ts";

// ── 재생 조작 ─────────────────────────────────────────────────────────────────
// 전제 조건과 권한은 usecases/controls 가 본다. 경로는 입력 모양만 확정하고 거절을 HTTP 로 옮긴다.

function refuse(res: Response, result: Refusal) {
  const { status, error } = controlApiError(result);
  return res.status(status).json({ error });
}

// 반복 모드  { mode: 'off' | 'track' | 'queue' }
const LOOP_MODE = new Map<string, false | "track" | "queue">([
  ["off", false],
  ["track", "track"],
  ["queue", "queue"],
]);

// 이어 넣기 상태를 화면에. 선택지 단위(batch)는 코어가 서버 설정으로 채워 둔다
const moreView = (more: More | null | undefined) => (more ? { ...more, requesterId: undefined, lifetimeMs: LIFETIME_MS } : null);

// 대시보드에서 곡을 넣은 사람. 화면에 보이는 이름으로
function requesterOf<P>(req: Request<P>) {
  const user = signedIn(req);
  return { id: user.id, username: user.globalName || user.username };
}

function createPlayerRouter() {
  const router = express.Router();
  readRoutes(router);
  joinRoute(router);
  controlRoutes(router);
  addRoutes(router);
  return router;
}

// 상태 읽기
function readRoutes(router: Router) {
  // Player state
  router.get("/:guildId/player", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const { guild, member } = ctx;

    const userId = signedIn(req).id;
    const voice = voiceFlags(guild, userId);

    // 제어/추가 가능 여부. UI 표시용 (실제 강제는 각 엔드포인트가 담당). member는 getPlayer가 실멤버십으로 확보.
    let controllable = isOwner(req);
    let addable = controllable;
    if (!controllable && member) {
      controllable = !(await checkControl(member));
      addable = !checkAdd(member);
    }

    // 서버 설정(⚙) 진입 가능 여부. 모더레이터/봇 운영자만 (설정 화면 GET 게이트와 동일 기준)
    const manageable = isOwner(req) || (member ? isModerator(member) : false);

    // hasPlayer: 봇의 음성 재적(디스코드 상태)과 플레이어 존재(봇 내부 상태)는 어긋날 수 있다.
    // 조작 엔드포인트는 전부 플레이어를 요구하므로, 화면이 botInVoice만 보고 폼을 열면 409가 난다.
    res.json({ ...playerState(ctx.player, queueWindow(req)), ...voice, hasPlayer: !!ctx.player, canControl: controllable, canAdd: addable, canManage: manageable, userId });
  });

  // 대기열 더 보기. 화면이 바닥에 닿았을 때 다음 구간만 받아 간다.
  router.get("/:guildId/player/queue", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const queue = ctx.player?.queue || [];

    const window = parse(QueueWindowQuery, req.query);
    if (!window.ok) return res.status(400).json({ error: window.error });
    const { offset, limit } = window.value;

    res.json({ items: queue.slice(offset, offset + limit).map((t, i) => queueTrack(t, offset + i)), total: queue.length });
  });
}

// 봇이 그 음성 채널에 들어가 말할 수 있는가
function botCanJoin(guild: Guild, channel: VoiceBasedChannel) {
  const me = guild.members.me;
  const permissions = me && channel.permissionsFor(me);
  return Boolean(permissions?.has("Connect") && permissions.has("Speak"));
}

// 음성 참가
function joinRoute(router: Router) {
  // Join user's voice channel
  router.post("/:guildId/player/join", requireAuth, async (req, res) => {
    const { guildId } = req.params;
    const ctx = await getPlayer(req, res, guildId);
    if (!ctx) return;
    const { client } = ctx;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: "서버를 찾을 수 없습니다" });

    const userId = signedIn(req).id;
    let member;
    try {
      member = shadowMember(req, await guild.members.fetch(userId));
    } catch {
      return res.status(400).json({ error: "서버에서 사용자를 찾을 수 없습니다" });
    }

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) return res.status(400).json({ error: "음성 채널에 참가해 있지 않습니다" });

    if (!botCanJoin(guild, voiceChannel)) {
      return res.status(403).json({ error: "봇이 해당 채널에 접속할 권한이 없습니다" });
    }

    // Discord 쪽 /join과 동일. 봇이 이미 다른 채널에서 사용 중이면 이동 불가.
    // (모더레이터의 봇 이동은 Discord 네이티브 드래그 기능으로 충분. API 이동 미지원, 사용자 결정)
    const botChannel = guild.members.me?.voice?.channel;
    if (botChannel && botChannel.id !== voiceChannel.id) {
      return res.status(403).json({ error: "봇이 이미 다른 음성 채널에서 사용 중입니다" });
    }

    // textChannel은 여기서 정하지 않는다. 곡 추가 시 코어가 서버의 봇 전용 채널로 채운다
    const player = ensurePlayer(client, { guild, voiceChannel });

    try {
      await player.connect();
    } catch {
      player.releaseResources();
      player.disconnect("접속 실패");
      client.players.delete(guildId);
      return res.status(500).json({ error: "음성 채널 접속에 실패했습니다" });
    }

    if (!player.currentTrack) {
      bestEffort(log, player.updateVoiceStatus(config.voiceStatus.idleText), "음성 채널 상태 바꾸기");
    }

    // 방금 자기 채널로 봇을 불렀으므로 재적 규칙은 통과. 계층(DJ 여부)만 판정에 반영됨
    const controllable = isOwner(req) || !(await checkControl(member));
    const addable = isOwner(req) || !checkAdd(member);
    res.json({ ...playerState(player, queueWindow(req)), ...voiceFlags(guild, userId), hasPlayer: true, canControl: controllable, canAdd: addable, userId });
  });
}

// 재생 조작
function controlRoutes(router: Router) {
  // Toggle pause / resume
  router.post("/:guildId/player/pause", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const r = await controls.pause(ctx.player, ctx.actor);
    if (!r.ok) return refuse(res, r);
    res.json(playerState(ctx.player, queueWindow(req)));
  });

  // Previous
  router.post("/:guildId/player/previous", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const r = await controls.previous(ctx.player, ctx.actor);
    if (!r.ok) return refuse(res, r);
    res.json({ ok: true });
  });

  // Skip. DJ 계층이거나 현재 곡의 요청자 본인이면 가능
  router.post("/:guildId/player/skip", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const r = await controls.skip(ctx.player, ctx.actor);
    if (!r.ok) return refuse(res, r);
    res.json({ ok: true });
  });

  // Stop
  router.post("/:guildId/player/stop", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const r = await controls.stop(ctx.player, ctx.actor, ctx.client.players);
    if (!r.ok) return refuse(res, r);
    res.json({ ok: true });
  });

  // Seek  { position: seconds }
  router.post("/:guildId/player/seek", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const body = parse(SeekBody, req.body ?? {});
    if (!body.ok) return res.status(400).json({ error: body.error });
    const positionSec = body.value.position;

    // 진행바를 끝까지 끌면 곡 길이와 같은 값이 온다. 끝 1초 앞으로 당긴다
    const durationSec = ctx.player?.currentTrack?.duration ?? 0;
    const clampedSec = durationSec > 0 ? Math.min(positionSec, durationSec - 1) : positionSec;

    try {
      const r = await controls.seek(ctx.player, ctx.actor, Math.floor(clampedSec * 1000), { reason: "dashboard" });
      if (!r.ok) return refuse(res, r);
      res.json({ ok: true, position: clampedSec });
    } catch (e) {
      res.status(500).json({ error: messageOf(e) });
    }
  });

  // Volume  { volume: 0-100 }. 화면은 끄는 동안 잇달아 보낸다. 일반 API 한도와 따로, 같은 크기로 센다
  const volumeLimiter = rateLimit({
    windowMs: config.dashboard.rateLimit.windowMs,
    limit: config.dashboard.rateLimit.apiMax,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.session?.user?.id || ipKeyGenerator(req.ip ?? ""),
    message: { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요" },
  });
  router.post("/:guildId/player/volume", requireAuth, volumeLimiter, async (req: Request<{ guildId: string }>, res: Response) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const r = await controls.volume(ctx.player, ctx.actor, toInt(req.body.volume));
    if (!r.ok) return refuse(res, r);
    res.json(playerState(ctx.player, queueWindow(req)));
  });

  router.post("/:guildId/player/loop", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    // 모르는 값은 undefined 로 넘겨 bad-loop-mode 로 거절받는다
    const r = await controls.loop(ctx.player, ctx.actor, LOOP_MODE.get(req.body.mode));
    if (!r.ok) return refuse(res, r);
    res.json(playerState(ctx.player, queueWindow(req)));
  });

  // Shuffle
  router.post("/:guildId/player/shuffle", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const r = await controls.shuffle(ctx.player, ctx.actor);
    if (!r.ok) return refuse(res, r);
    res.json(playerState(ctx.player, queueWindow(req)));
  });

  // Remove track from queue  DELETE /:guildId/player/queue/:index. DJ 계층이거나 그 곡의 요청자 본인
  router.delete("/:guildId/player/queue/:index", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const r = await controls.remove(ctx.player, ctx.actor, toInt(req.params.index));
    if (!r.ok) return refuse(res, r);
    res.json(playerState(ctx.player, queueWindow(req)));
  });

  // Move track in queue  { from: number, to: number }
  router.post("/:guildId/player/queue/move", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const r = await controls.move(ctx.player, ctx.actor, toInt(req.body.from), toInt(req.body.to));
    if (!r.ok) return refuse(res, r);
    res.json(playerState(ctx.player, queueWindow(req)));
  });
}

// 곡 추가
function addRoutes(router: Router) {
  // 곡 추가는 yt-dlp 호출을 유발하므로 별도 엄격 제한 (플레이리스트도 1요청이라 정상 사용엔 여유)
  const queueLimiter = rateLimit({
    windowMs: config.dashboard.rateLimit.windowMs,
    limit: config.dashboard.rateLimit.queueMax,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.session?.user?.id || ipKeyGenerator(req.ip ?? ""),
    message: { error: "곡 추가 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요" },
  });

  // Add track to queue  { query: string }. 곡 추가는 전 계층 가능, 재적 규칙만 적용
  router.post("/:guildId/player/queue", requireAuth, queueLimiter, async (req: Request<{ guildId: string }>, res: Response) => {
    const { guildId } = req.params;
    const ctx = await getPlayer(req, res, guildId);
    if (!ctx) return;
    const { player, client, guild } = ctx;

    if (!player) return res.status(409).json({ error: "봇이 음성 채널에 없습니다. 먼저 봇을 참가시켜 주세요" });

    if (!isOwner(req)) {
      const mctx = await resolveMember(req, res);
      if (!mctx) return;
      const err = checkAdd(mctx.member);
      if (err) return res.status(403).json({ error: toApiError(err) });
    }

    const body = parse(AddBody, req.body ?? {});
    if (!body.ok) return res.status(400).json({ error: body.error });
    const { query, single } = body.value;

    try {
      // responder를 주지 않으면 무동작. 디스코드에는 알리지 않고 결과를 이 응답으로만 전달한다.
      // 재생 시작·임베드·로깅은 슬래시 명령과 같은 코어를 지난다.
      const result = await requestPlayback(client, {
        guild,
        requester: requesterOf(req),
        query,
        single,
        source: "대시보드",
        lookup: req.app.locals.lookup, // 테스트가 조회를 가짜로 넘기는 자리. 없으면 진짜
      });

      // 코어는 resolveQuery의 메시지를 그대로 돌려준다(❌ 접두 포함). JSON 규약에 맞게 제거
      if (!result.success) return res.status(400).json({ error: toApiError(result.message) });

      res.json({ ...playerState(player, queueWindow(req)), dropped: result.dropped || 0, queueLimited: Boolean(result.queueLimited), more: moreView(result.more), queueMax: config.bot.maxQueueSize });
    } catch (err) {
      log.error("대시보드에서 곡 추가 실패:", err);
      res.status(500).json({ error: "곡 추가에 실패했습니다" });
    }
  });

  // Continue a playlist  POST /:guildId/player/queue/more. 곡 추가와 같은 권한·제한
  router.post("/:guildId/player/queue/more", requireAuth, queueLimiter, async (req: Request<{ guildId: string }>, res: Response) => {
    const { guildId } = req.params;
    const ctx = await getPlayer(req, res, guildId);
    if (!ctx) return;
    const { player, client, guild } = ctx;

    if (!player) return res.status(409).json({ error: "봇이 음성 채널에 없습니다. 먼저 봇을 참가시켜 주세요" });

    if (!isOwner(req)) {
      const mctx = await resolveMember(req, res);
      if (!mctx) return;
      const err = checkAdd(mctx.member);
      if (err) return res.status(403).json({ error: toApiError(err) });
    }

    // 대시보드는 맨 앞에 넣는 경로가 없다. 요청 본문의 insertFirst는 믿지 않는다
    const state = validState({ ...(req.body || {}), insertFirst: false, requesterId: null });
    const count = parse(MoreCount, req.body?.count);
    if (!state || !count.ok) return res.status(400).json({ error: "더 넣을 목록 정보가 올바르지 않습니다" });

    try {
      const result = await continueCollection(client, {
        guild,
        requester: requesterOf(req),
        state,
        count: count.value,
        source: "대시보드 더 넣기",
        lookup: req.app.locals.lookup,
      });
      if (!result.success) return res.status(400).json({ error: toApiError(result.message) });

      res.json({ ...playerState(player, queueWindow(req)), added: result.added, dropped: result.dropped || 0, more: moreView(result.next), queueMax: config.bot.maxQueueSize });
    } catch (err) {
      log.error("대시보드에서 재생목록 더 넣기 실패:", err);
      res.status(500).json({ error: "곡 추가에 실패했습니다" });
    }
  });
}

export { createPlayerRouter };
