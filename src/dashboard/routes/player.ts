// 재생. 상태 읽기 · 음성 참가 · 재생 조작(usecases/controls) · 곡 추가(usecases/add-tracks)

import express, { type Request, type Response, type Router } from "express";
import type { Guild, VoiceBasedChannel } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { requireAuth, signedIn } from "../middleware/require-auth.ts";
import { resolveMember } from "../middleware/require-control.ts";
import { checkControl, checkAdd, isModerator } from "../../usecases/permissions.ts";
import { addFailure } from "../../ui/error-messages.ts";
import * as controls from "../../usecases/controls.ts";
import type { More } from "../../usecases/playlist-more.ts";
import { requestPlayback, continueCollection, ensurePlayer } from "../../usecases/add-tracks.ts";
import { validState, LIFETIME_MS, KINDS } from "../../usecases/playlist-more.ts";
import config from "../../config/index.ts";
import { isOwner } from "../owner.ts";
import { shadowMember } from "../view-as.ts";
import { getPlayer, voiceFlags, toInt } from "../guild-access.ts";
import { queueTrack, queueWindow, playerState } from "../player-view.ts";
import { parse, SeekBody, QueueWindowQuery, AddBody, MoreCount, QUERY_MAX_LEN } from "../request-schemas.ts";
import { sendProblem, refuseWith, tooManyRequests } from "../problem.ts";
import { bestEffort } from "../../infra/best-effort.ts";
import * as replies from "../../ui/control-replies.ts";
import { LIFETIME } from "../../ui/delivery.ts";
import { announcer, announceVolume, dashboardActor, dashboardResponder } from "../discord-notice.ts";

// ── 재생 조작 ─────────────────────────────────────────────────────────────────
// 전제 조건과 권한은 usecases/controls 가 본다. 경로는 입력 모양만 확정하고 거절을 HTTP 로 옮긴다.
// 받아들인 조작은 디스코드의 패널 채널에도 디스코드 조작과 같은 화면으로 알린다(discordNotice).

// 조작의 거절(ok: false 와 문제)을 문제 응답으로
const refuse = (res: Response, { ok: _ok, ...problem }: controls.Refusal) => refuseWith(res, problem);

// 반복 모드  { mode: 'off' | 'track' | 'queue' }
const LOOP_MODE = new Map<string, false | "track" | "queue">([
  ["off", false],
  ["track", "track"],
  ["queue", "queue"],
]);

// 이어 넣기 상태를 화면에. 선택지 단위(batch)는 코어가 서버 설정으로 채워 둔다
// perClick: 출처가 한 번에 넣게 하는 곡 수 상한(사운드클라우드 세트 10). 없으면 null
const moreView = (more: More | null | undefined) => (more ? { ...more, requesterId: undefined, lifetimeMs: LIFETIME_MS, perClick: Number.isFinite(KINDS[more.kind].perClick) ? KINDS[more.kind].perClick : null } : null);

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
    if (!window.ok) return sendProblem(res, window.code);
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
    if (!guild) return sendProblem(res, "guild-not-found");

    const userId = signedIn(req).id;
    let member;
    try {
      member = shadowMember(req, await guild.members.fetch(userId));
    } catch {
      return sendProblem(res, "member-not-found");
    }

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) return sendProblem(res, "must-be-in-voice");

    if (!botCanJoin(guild, voiceChannel)) {
      return sendProblem(res, "permission-voice");
    }

    // Discord 쪽 /join과 동일. 봇이 이미 다른 채널에서 사용 중이면 이동 불가.
    // (모더레이터의 봇 이동은 Discord 네이티브 드래그 기능으로 충분. API 이동 미지원, 사용자 결정)
    const botChannel = guild.members.me?.voice?.channel;
    if (botChannel && botChannel.id !== voiceChannel.id) {
      return sendProblem(res, "bot-in-other-voice");
    }

    // textChannel은 여기서 정하지 않는다. 곡 추가 시 코어가 서버의 봇 전용 채널로 채운다
    const player = ensurePlayer(client, { guild, voiceChannel });

    try {
      await player.voice.connect();
    } catch {
      await player.dispose({ reason: "접속 실패", session: "keep" });
      return sendProblem(res, "voice-failed");
    }

    if (!player.currentTrack) {
      bestEffort(log, player.updateVoiceStatus(config.voiceStatus.idleText), "음성 채널 상태 바꾸기");
    }
    // 전용 채널이 있으면 그 채널에 알린다. 없으면 글자 채널이 아직 없어 알리지 않는다
    announcer(client, player)(replies.joined());

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
    const announce = announcer(ctx.client, ctx.player);
    const r = await controls.pause(ctx.player, ctx.actor);
    if (!r.ok) return refuse(res, r);
    announce(replies.paused(r.paused, r.track, dashboardActor(req)));
    res.json(playerState(ctx.player, queueWindow(req)));
  });

  // Previous
  router.post("/:guildId/player/previous", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const announce = announcer(ctx.client, ctx.player);
    const r = await controls.previous(ctx.player, ctx.actor);
    if (!r.ok) return refuse(res, r);
    announce(replies.previous(r.restarted, r.track));
    res.json({ ok: true });
  });

  // Skip. DJ 계층이거나 현재 곡의 요청자 본인이면 가능
  router.post("/:guildId/player/skip", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const announce = announcer(ctx.client, ctx.player);
    const r = await controls.skip(ctx.player, ctx.actor);
    if (!r.ok) return refuse(res, r);
    announce(replies.skipped(r.restarted, r.track, dashboardActor(req)));
    res.json({ ok: true });
  });

  // Stop
  router.post("/:guildId/player/stop", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const announce = announcer(ctx.client, ctx.player);
    const r = await controls.stop(ctx.player, ctx.actor);
    if (!r.ok) return refuse(res, r);
    announce(replies.stopped(r.cleared, dashboardActor(req)), LIFETIME.farewell);
    res.json({ ok: true });
  });

  // Seek  { position: seconds }
  router.post("/:guildId/player/seek", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const body = parse(SeekBody, req.body ?? {});
    if (!body.ok) return sendProblem(res, body.code);
    const positionSec = body.value.position;

    // 진행바를 끝까지 끌면 곡 길이와 같은 값이 온다. 끝 1초 앞으로 당긴다
    const durationSec = ctx.player?.currentTrack?.duration ?? 0;
    const clampedSec = durationSec > 0 ? Math.min(positionSec, durationSec - 1) : positionSec;

    const announce = announcer(ctx.client, ctx.player);
    const r = await controls.seek(ctx.player, ctx.actor, Math.floor(clampedSec * 1000), { reason: "dashboard" });
    if (!r.ok) return refuse(res, r);
    announce(replies.seeked(r.ms));
    res.json({ ok: true, position: clampedSec });
  });

  // Volume  { volume: 0-100 }. 화면은 끄는 동안 잇달아 보낸다. 일반 API 한도와 따로, 같은 크기로 센다
  const volumeLimiter = rateLimit({
    windowMs: config.dashboard.rateLimit.windowMs,
    limit: config.dashboard.rateLimit.apiMax,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.session?.user?.id || ipKeyGenerator(req.ip ?? ""),
    handler: tooManyRequests,
  });
  router.post("/:guildId/player/volume", requireAuth, volumeLimiter, async (req: Request<{ guildId: string }>, res: Response) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const r = await controls.volume(ctx.player, ctx.actor, toInt(req.body.volume));
    if (!r.ok) return refuse(res, r);
    const announce = announcer(ctx.client, ctx.player);
    const by = dashboardActor(req);
    announceVolume(req.params.guildId, r.before, r.level, (before, level) => announce(replies.volumeSet(before, level, by)));
    res.json(playerState(ctx.player, queueWindow(req)));
  });

  router.post("/:guildId/player/loop", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    // 모르는 값은 undefined 로 넘겨 bad-loop-mode 로 거절받는다
    const announce = announcer(ctx.client, ctx.player);
    const r = await controls.loop(ctx.player, ctx.actor, LOOP_MODE.get(req.body.mode));
    if (!r.ok) return refuse(res, r);
    announce(replies.loopSet(r.mode, r.track, dashboardActor(req)));
    res.json(playerState(ctx.player, queueWindow(req)));
  });

  // Shuffle
  router.post("/:guildId/player/shuffle", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const announce = announcer(ctx.client, ctx.player);
    const r = await controls.shuffle(ctx.player, ctx.actor);
    if (!r.ok) return refuse(res, r);
    announce(replies.shuffled(r.count, dashboardActor(req)));
    res.json(playerState(ctx.player, queueWindow(req)));
  });

  // Remove track from queue  DELETE /:guildId/player/queue/:index. DJ 계층이거나 그 곡의 요청자 본인
  router.delete("/:guildId/player/queue/:index", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const announce = announcer(ctx.client, ctx.player);
    const r = await controls.remove(ctx.player, ctx.actor, toInt(req.params.index));
    if (!r.ok) return refuse(res, r);
    announce(replies.removed(r.left, dashboardActor(req)));
    res.json(playerState(ctx.player, queueWindow(req)));
  });

  // Move track in queue  { from: number, to: number }
  router.post("/:guildId/player/queue/move", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const announce = announcer(ctx.client, ctx.player);
    const r = await controls.move(ctx.player, ctx.actor, toInt(req.body.from), toInt(req.body.to));
    if (!r.ok) return refuse(res, r);
    // 사람은 1부터 센다
    announce(replies.moved(r.track, r.from + 1, r.to + 1, dashboardActor(req)));
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
    handler: tooManyRequests,
  });

  // Add track to queue  { query: string }. 곡 추가는 전 계층 가능, 재적 규칙만 적용
  router.post("/:guildId/player/queue", requireAuth, queueLimiter, async (req: Request<{ guildId: string }>, res: Response) => {
    const { guildId } = req.params;
    const ctx = await getPlayer(req, res, guildId);
    if (!ctx) return;
    const { player, client, guild } = ctx;

    if (!player) return sendProblem(res, "bot-not-in-voice");

    if (!isOwner(req)) {
      const mctx = await resolveMember(req, res);
      if (!mctx) return;
      const err = checkAdd(mctx.member);
      if (err) return sendProblem(res, err);
    }

    const body = parse(AddBody, req.body ?? {});
    if (!body.ok) return sendProblem(res, body.code, { max: QUERY_MAX_LEN });
    const { query, single } = body.value;

    try {
      // 담은 안내는 디스코드의 패널 채널에도 보내고(dashboardResponder), 결과는 이 응답으로 전달한다.
      // 재생 시작·임베드·로깅은 슬래시 명령과 같은 코어를 지난다.
      const result = await requestPlayback(client, {
        guild,
        requester: requesterOf(req),
        query,
        single,
        source: "대시보드",
        responder: dashboardResponder(client, guildId),
        lookup: req.app.locals.lookup, // 테스트가 조회를 가짜로 넘기는 자리. 없으면 진짜
      });

      if (!result.success) return refuseWith(res, addFailure(result));

      res.json({ ...playerState(player, queueWindow(req)), dropped: result.dropped || 0, queueLimited: Boolean(result.queueLimited), more: moreView(result.more), queueMax: config.bot.maxQueueSize });
    } catch (err) {
      log.error("대시보드에서 곡 추가 실패:", err);
      sendProblem(res, "add-failed");
    }
  });

  // Continue a playlist  POST /:guildId/player/queue/more. 곡 추가와 같은 권한·제한
  router.post("/:guildId/player/queue/more", requireAuth, queueLimiter, async (req: Request<{ guildId: string }>, res: Response) => {
    const { guildId } = req.params;
    const ctx = await getPlayer(req, res, guildId);
    if (!ctx) return;
    const { player, client, guild } = ctx;

    if (!player) return sendProblem(res, "bot-not-in-voice");

    if (!isOwner(req)) {
      const mctx = await resolveMember(req, res);
      if (!mctx) return;
      const err = checkAdd(mctx.member);
      if (err) return sendProblem(res, err);
    }

    // 대시보드는 맨 앞에 넣는 경로가 없다. 요청 본문의 insertFirst는 믿지 않는다
    const state = validState({ ...(req.body || {}), insertFirst: false, requesterId: null });
    const count = parse(MoreCount, req.body?.count);
    if (!state || !count.ok) return sendProblem(res, "bad-more-state");

    try {
      const result = await continueCollection(client, {
        guild,
        requester: requesterOf(req),
        state,
        count: count.value,
        source: "대시보드 더 넣기",
        lookup: req.app.locals.lookup,
      });
      if (!result.success) return refuseWith(res, addFailure(result));

      res.json({ ...playerState(player, queueWindow(req)), added: result.added, dropped: result.dropped || 0, more: moreView(result.next), queueMax: config.bot.maxQueueSize });
    } catch (err) {
      log.error("대시보드에서 재생목록 더 넣기 실패:", err);
      sendProblem(res, "add-failed");
    }
  });
}

export { createPlayerRouter };
