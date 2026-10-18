// 재생. 상태 읽기 · 음성 참가 · 재생 조작(usecases/controls) · 곡 추가(usecases/add-tracks)

import express, { type Request, type Response, type Router } from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { requireAuth, signedIn } from "../middleware/require-auth.ts";
import { checkControl, checkAdd, isModerator } from "../../usecases/permissions.ts";
import { addFailure } from "../../ui/error-messages.ts";
import * as controls from "../../usecases/controls.ts";
import type { More } from "../../rules/more-choices.ts";
import { loopOf, type AddReply, type AutoplayGenres, type MoreReply, type MoreView, type PlayerRead, type QueuePage } from "../contract/player.ts";
import { requestPlayback, continueCollection, ensurePlayer, resolveFallbackTextChannel } from "../../usecases/add-tracks.ts";
import * as genreConfig from "../../config/genres.ts";
import { autoplayOn } from "../../ui/genre-menu.ts";
import { join } from "../../usecases/join.ts";
import { validState, resultText, LIFETIME_MS, KINDS } from "../../usecases/playlist-more.ts";
import * as queueText from "../../ui/text/ko/queue.ts";
import config from "../../config/index.ts";
import { openGuild, voiceFlags } from "../guild-access.ts";
import { queueTrack, queueWindow, playerState, toInt } from "../player-view.ts";
import { parse, Entry, OnTrackBody, SeekBody, MoveEntryBody, AutoplayBody, QueueWindowQuery, AddBody, MoreCount, QUERY_MAX_LEN } from "../request-schemas.ts";
import { sendProblem, refuseWith } from "../problem.ts";
import { limiter } from "../rate-limits.ts";
import * as replies from "../../ui/control-replies.ts";
import { LIFETIME } from "../../ui/delivery.ts";
import { announcer, dashboardActor, dashboardResponder } from "../discord-notice.ts";

// ── 재생 조작 ─────────────────────────────────────────────────────────────────
// 전제 조건과 권한은 usecases/controls 가 본다. 경로는 입력 모양만 확정하고 거절을 HTTP 로 옮긴다.
// 받아들인 조작은 디스코드의 패널 채널에도 디스코드 조작과 같은 화면으로 알린다(discordNotice).

// 조작의 거절(ok: false 와 문제)을 문제 응답으로
const refuse = (res: Response, { ok: _ok, ...problem }: controls.Refusal) => refuseWith(res, problem);

// 이어 넣기 상태를 화면에. 선택지 단위(batch)는 코어가 서버 설정으로 채워 둔다
// perClick: 출처가 한 번에 넣게 하는 곡 수 상한(사운드클라우드 세트 10). 없으면 null
function moreView(more: (More & { batch: number }) | null | undefined): MoreView | null {
  if (!more) return null;
  const { requesterId: _requesterId, ...shown } = more;
  const { perClick, collection } = KINDS[more.kind];
  return { ...shown, collection, lifetimeMs: LIFETIME_MS, perClick: Number.isFinite(perClick) ? perClick : null };
}

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
  queueEditRoutes(router);
  addRoutes(router);
  autoplayRoutes(router);
  return router;
}

// 상태 읽기
function readRoutes(router: Router) {
  // 재생 상태
  router.get("/:guildId/player", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const { guild, member } = ctx;

    const userId = signedIn(req).id;
    const voice = voiceFlags(guild, userId);

    // 제어/추가 가능 여부. UI 표시용 (실제 강제는 각 엔드포인트가 담당). member 는 openGuild 가 지금 멤버십으로 가져온다.
    const controllable = !(await checkControl(member));
    const addable = !checkAdd(member);
    // 서버 설정(⚙) 진입 가능 여부. 모더레이터만 (설정 화면 GET 게이트와 동일 기준)
    const manageable = isModerator(member);

    // hasPlayer: 봇의 음성 재적(디스코드 상태)과 플레이어 존재(봇 내부 상태)는 어긋날 수 있다.
    // 조작 엔드포인트는 전부 플레이어를 요구하므로, 화면이 botInVoice만 보고 폼을 열면 409가 난다.
    res.json({ ...playerState(ctx.player, queueWindow(req)), ...voice, hasPlayer: !!ctx.player, canControl: controllable, canAdd: addable, canManage: manageable, userId } satisfies PlayerRead);
  });

  // 대기열 더 보기. 화면이 바닥에 닿았을 때 다음 구간만 받아 간다.
  router.get("/:guildId/player/queue", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const queue = ctx.player?.queue || [];

    const window = parse(QueueWindowQuery, req.query);
    if (!window.ok) return sendProblem(res, window.code);
    const { offset, limit } = window.value;

    res.json({ items: queue.slice(offset, offset + limit).map((t, i) => queueTrack(t, offset + i)), total: queue.length } satisfies QueuePage);
  });
}

// 음성 참가. 판정과 일은 디스코드 /join 과 같다(usecases/join). 붙었거나 복원한 결과는 디스코드의 패널 채널에도 알린다
function joinRoute(router: Router) {
  router.post("/:guildId/player/join", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const { bot, guild, member } = ctx;

    const result = await join(bot, { guild, member });
    if (result.kind === "refused") return sendProblem(res, result.code);
    if (result.kind === "restore-error") return sendProblem(res, "restore-failed");
    const { player } = result;
    if (result.kind === "joined") announcer(bot, player)(replies.joined());
    if (result.kind === "restored") announcer(bot, player)(replies.restoreResult(result.track, player.paused, result.left));

    // 방금 자기 채널로 봇을 불렀으므로 재적 규칙은 통과. 계층(DJ 여부)만 판정에 반영됨
    const controllable = !(await checkControl(member));
    const addable = !checkAdd(member);
    const manageable = isModerator(member);
    res.json({ ...playerState(player, queueWindow(req)), ...voiceFlags(guild, member.id), hasPlayer: true, canControl: controllable, canAdd: addable, canManage: manageable, userId: member.id } satisfies PlayerRead);
  });
}

// 조작 뒤의 재생 상태. 모든 조작이 같은 모양으로 답한다. 조작이 플레이어를 버렸을 수 있어(정지) 레지스트리에서 다시 찾는다
function stateAfter(req: Request<{ guildId: string }>) {
  return playerState(req.app.locals.bot.players.get(req.params.guildId), queueWindow(req));
}

// 재생 조작
function controlRoutes(router: Router) {
  // 일시정지 · 다시 재생
  router.post("/:guildId/player/pause", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const announce = announcer(ctx.bot, ctx.player);
    const r = await controls.pause(ctx.player, ctx.actor);
    if (!r.ok) return refuse(res, r);
    announce(replies.paused(r.paused, r.track, dashboardActor(req)));
    res.json(stateAfter(req));
  });

  // 이전 곡
  router.post("/:guildId/player/previous", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const body = parse(OnTrackBody, req.body ?? {});
    if (!body.ok) return sendProblem(res, body.code);
    const announce = announcer(ctx.bot, ctx.player);
    const r = await controls.previous(ctx.player, ctx.actor, body.value);
    if (!r.ok) return refuse(res, r);
    // 다음 곡을 튼 뒤의 상태를 싣는다(곡 끝 처리는 멈춘 다음 차례에 돈다. 다음 곡을 오래 열면 상한까지만 기다린다)
    await ctx.player?.untilSwitched();
    announce(replies.previous(r.restarted, r.track));
    res.json(stateAfter(req));
  });

  // Skip. DJ 계층이거나 현재 곡의 요청자 본인이면 가능
  router.post("/:guildId/player/skip", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const body = parse(OnTrackBody, req.body ?? {});
    if (!body.ok) return sendProblem(res, body.code);
    const announce = announcer(ctx.bot, ctx.player);
    const r = await controls.skip(ctx.player, ctx.actor, body.value);
    if (!r.ok) return refuse(res, r);
    // 다음 곡을 튼 뒤의 상태를 싣는다(곡 끝 처리는 멈춘 다음 차례에 돈다. 다음 곡을 오래 열면 상한까지만 기다린다)
    await ctx.player?.untilSwitched();
    announce(replies.skipped(r.restarted, r.track, dashboardActor(req)));
    res.json(stateAfter(req));
  });

  // 정지
  router.post("/:guildId/player/stop", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const announce = announcer(ctx.bot, ctx.player);
    const r = await controls.stop(ctx.player, ctx.actor);
    if (!r.ok) return refuse(res, r);
    announce(replies.stopped(r.cleared, dashboardActor(req)), LIFETIME.farewell);
    res.json(stateAfter(req));
  });

  // 위치 이동 { position: 초 }
  router.post("/:guildId/player/seek", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const body = parse(SeekBody, req.body ?? {});
    if (!body.ok) return sendProblem(res, body.code);
    const positionSec = body.value.position;

    // 진행바를 끝까지 끌면 곡 길이와 같은 값이 온다. 끝 1초 앞으로 당긴다
    const durationSec = ctx.player?.currentTrack?.duration ?? 0;
    const clampedSec = durationSec > 0 ? Math.min(positionSec, durationSec - 1) : positionSec;

    const announce = announcer(ctx.bot, ctx.player);
    const r = await controls.seek(ctx.player, ctx.actor, Math.floor(clampedSec * 1000), { reason: "dashboard", onTrack: body.value.onTrack });
    if (!r.ok) return refuse(res, r);
    announce(replies.seeked(r.ms));
    res.json(stateAfter(req));
  });

  // Volume  { volume: 0-100 }. 화면은 끄는 동안 잇달아 보낸다. 일반 API 한도와 따로, 같은 크기로 센다
  const volumeLimiter = limiter(() => config.dashboard.rateLimit.apiMax);
  router.post("/:guildId/player/volume", requireAuth, volumeLimiter, async (req: Request<{ guildId: string }>, res: Response) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    // 디스코드 패널 채널에는 끄기를 멈춘 뒤 처음 값 → 마지막 값으로 한 번 알린다(채널도 그때 찾는다)
    const by = dashboardActor(req);
    const r = await controls.volume(ctx.player, ctx.actor, toInt(req.body?.volume), { settled: (from, to) => announcer(ctx.bot, ctx.player)(replies.volumeSet(from, to, by)) });
    if (!r.ok) return refuse(res, r);
    res.json(stateAfter(req));
  });

  // 하이라이트로. 디스코드 /highlight 와 같은 조작 · 같은 안내
  router.post("/:guildId/player/highlight", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const body = parse(OnTrackBody, req.body ?? {});
    if (!body.ok) return sendProblem(res, body.code);
    const announce = announcer(ctx.bot, ctx.player);
    const r = await controls.highlight(ctx.player, ctx.actor, body.value);
    if (!r.ok) return refuse(res, r);
    announce(replies.highlighted(r.ms));
    res.json(stateAfter(req));
  });

  router.post("/:guildId/player/loop", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    // 모르는 값은 undefined 로 넘겨 bad-loop-mode 로 거절받는다
    const announce = announcer(ctx.bot, ctx.player);
    const r = await controls.loop(ctx.player, ctx.actor, loopOf(req.body?.mode));
    if (!r.ok) return refuse(res, r);
    announce(replies.loopSet(r.mode, dashboardActor(req)));
    res.json(stateAfter(req));
  });

  // 섞기
  router.post("/:guildId/player/shuffle", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const announce = announcer(ctx.bot, ctx.player);
    const r = await controls.shuffle(ctx.player, ctx.actor);
    if (!r.ok) return refuse(res, r);
    announce(replies.shuffled(r.count, dashboardActor(req)));
    res.json(stateAfter(req));
  });
}

// 대기열 빼기 · 옮기기. 순번이 아니라 줄 번호로 가리킨다(화면이 보던 목록이 오래돼도 그 곡). 디스코드 /remove · /move 는 지금 본 번호로 보낸다
function queueEditRoutes(router: Router) {
  // 줄 번호로 빼기. DJ 계층이거나 그 곡의 요청자 본인
  router.delete("/:guildId/player/queue/entry/:entry", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const entry = parse(Entry, toInt(req.params.entry));
    if (!entry.ok) return sendProblem(res, entry.code);
    const announce = announcer(ctx.bot, ctx.player);
    const r = await controls.removeEntry(ctx.player, ctx.actor, entry.value);
    if (!r.ok) return refuse(res, r);
    announce(replies.removed(r.left, dashboardActor(req)));
    res.json(stateAfter(req));
  });

  // 줄 번호로 옮기기 { entry, before }. entry 줄을 before 줄 앞으로, before 가 null 이면 맨 끝
  router.post("/:guildId/player/queue/move-entry", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const body = parse(MoveEntryBody, req.body ?? {});
    if (!body.ok) return sendProblem(res, body.code);
    const announce = announcer(ctx.bot, ctx.player);
    const r = await controls.moveEntry(ctx.player, ctx.actor, body.value.entry, body.value.before);
    if (!r.ok) return refuse(res, r);
    // 사람은 1부터 센다
    announce(replies.moved(r.track, r.from + 1, r.to + 1, dashboardActor(req)));
    res.json(stateAfter(req));
  });
}

// 자동재생. 판정과 일은 디스코드의 장르 메뉴와 같다(usecases/controls 의 autoplay)
function autoplayRoutes(router: Router) {
  // 장르 목록. 디스코드 장르 메뉴와 같은 것(파일이 바뀌면 곧바로)
  router.get("/:guildId/autoplay/genres", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const { genres } = genreConfig.genres();
    res.json({ genres: Object.entries(genres).map(([id, g]) => ({ id, label: g.label?.trim() || id, emoji: g.emoji || null })) } satisfies AutoplayGenres);
  });

  // 켜기(장르) · 바꾸기 · 끄기(null). 켤 때 플레이어가 없으면 만든다(봇이 쉬면 부른 사람의 음성 채널로). 켠 결과는 패널 채널에도 알린다
  router.post("/:guildId/player/autoplay", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const body = parse(AutoplayBody, req.body ?? {});
    if (!body.ok) return sendProblem(res, body.code);
    const { bot, guild, member } = ctx;
    const { genre } = body.value;
    // 새 플레이어의 텍스트 채널은 곡 넣기와 같다(전용 채널이 있으면 그것)
    const textChannel = genre && !ctx.player?.textChannel ? await resolveFallbackTextChannel(guild) : null;
    const r = await controls.autoplay(ctx.player, ctx.actor, genre ?? false, { create: () => ensurePlayer(bot, { guild, textChannel, voiceChannel: member.voice?.channel ?? null }) });
    if (!r.ok) return refuse(res, r);
    if (genre) announcer(bot, bot.players.get(guild.id))(autoplayOn(genre, dashboardActor(req)));
    res.json(stateAfter(req));
  });
}

// 곡 추가
function addRoutes(router: Router) {
  // 곡 추가는 yt-dlp 호출을 유발하므로 별도 엄격 제한 (플레이리스트도 1요청이라 정상 사용엔 여유)
  const queueLimiter = limiter(() => config.dashboard.rateLimit.queueMax);

  // Add track to queue  { query: string }. 곡 추가는 전 계층 가능, 재적 규칙만 적용
  router.post("/:guildId/player/queue", requireAuth, queueLimiter, async (req: Request<{ guildId: string }>, res: Response) => {
    const { guildId } = req.params;
    const ctx = await openGuild(req, res, guildId);
    if (!ctx) return;
    const { player, bot, guild, actor } = ctx;

    if (!player) return sendProblem(res, "bot-not-in-voice");

    // 곡 추가 권한(재적 규칙)
    const err = checkAdd(actor.member);
    if (err) return sendProblem(res, err);

    const body = parse(AddBody, req.body ?? {});
    if (!body.ok) return sendProblem(res, body.code, { max: QUERY_MAX_LEN });
    const { query, single } = body.value;

    try {
      // 담은 안내는 디스코드의 패널 채널에도 보내고(dashboardResponder), 결과는 이 응답으로 전달한다.
      // 재생 시작·임베드·로깅은 슬래시 명령과 같은 코어를 지난다.
      const result = await requestPlayback(bot, {
        guild,
        requester: requesterOf(req),
        query,
        single,
        source: "대시보드",
        responder: dashboardResponder(bot, guildId),
        lookup: req.app.locals.lookup, // 테스트가 조회를 가짜로 넘기는 슬롯. 없으면 진짜
      });

      if (!result.success) return refuseWith(res, addFailure(result));

      const dropped = result.dropped || 0;
      const queueLimited = Boolean(result.queueLimited);
      const notes = queueText.addedWarnings({ dropped, skipped: 0, queueLimited, max: config.bot.maxQueueSize });
      res.json({ ...playerState(player, queueWindow(req)), dropped, queueLimited, notes, more: moreView(result.more), queueMax: config.bot.maxQueueSize } satisfies AddReply);
    } catch (err) {
      log.error("대시보드에서 곡 추가 실패:", err);
      sendProblem(res, "add-failed");
    }
  });

  // Continue a playlist  POST /:guildId/player/queue/more. 곡 추가와 같은 권한·제한
  router.post("/:guildId/player/queue/more", requireAuth, queueLimiter, async (req: Request<{ guildId: string }>, res: Response) => {
    const { guildId } = req.params;
    const ctx = await openGuild(req, res, guildId);
    if (!ctx) return;
    const { player, bot, guild, actor } = ctx;

    if (!player) return sendProblem(res, "bot-not-in-voice");

    // 곡 추가 권한(재적 규칙)
    const err = checkAdd(actor.member);
    if (err) return sendProblem(res, err);

    // 대시보드는 맨 앞에 넣는 경로가 없다. 요청 본문의 insertFirst는 믿지 않는다
    const state = validState({ ...(req.body || {}), insertFirst: false, requesterId: null });
    const count = parse(MoreCount, req.body?.count);
    if (!state || !count.ok) return sendProblem(res, "bad-more-state");

    try {
      const result = await continueCollection(bot, {
        guild,
        requester: requesterOf(req),
        state,
        count: count.value,
        source: "대시보드 더 넣기",
        lookup: req.app.locals.lookup,
      });
      if (!result.success) return refuseWith(res, addFailure(result));

      const note = resultText(state.kind, { added: result.added, dropped: result.dropped, skipped: result.skipped, total: result.total, remaining: result.remaining, next: result.next });
      res.json({ ...playerState(player, queueWindow(req)), added: result.added, dropped: result.dropped || 0, note, more: moreView(result.next), queueMax: config.bot.maxQueueSize } satisfies MoreReply);
    } catch (err) {
      log.error("대시보드에서 재생목록 더 넣기 실패:", err);
      sendProblem(res, "add-failed");
    }
  });
}

export { createPlayerRouter };
