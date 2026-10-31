// 상주 모드(24/7) 자리 지킴이: 자리가 있는데 봇이 그 자리에 붙어 있지 않으면 다시 붙인다. 언제 나가는지는 player/idle-leave, 버리는 결정은 player/voice-link 몫이고
// 여기는 끝난 까닭(disposed 의 end)을 받아 할 일만 정한다.
//   다시 붙음   기동(세션 복원 · 이어받기 뒤) · 쓸 수 없던 서버가 돌아옴 · 일시적인 끝(복구 포기 · 접속 실패 등)
//   자리를 끔   강제 퇴장 · 채널 삭제 · 권한 잃음(디스코드의 확답). 서버 채널에 알린다
//   차단        같은 오류가 되풀이되어 멈춘 서버(fault). 봇을 다시 시작하거나 곡을 다시 틀 때까지 재접속하지 않는다
// 일시적 실패는 1 · 2 · 5 · 10 · 30분 뒤(이후 30분마다) 다시. 서버마다 하나씩, 기동 때는 서버 사이 1초

import { PermissionFlagsBits, RESTJSONErrorCodes, type Client, type Guild, type VoiceBasedChannel } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "voice", sub: "stay" });
import * as staySeats from "../store/stay-seats.ts";
import * as playerEvents from "../player/events.ts";
import type { Player, PlayerEnd } from "../player/player.ts";
import type { PlayerSeats } from "../player/registry.ts";
import { waitForRestore } from "../player/session-restore.ts";
import { joinChannel } from "../usecases/join.ts";
import { resolveFallbackTextChannel } from "../usecases/add-tracks.ts";
import { noticeFrame, post } from "../ui/frame.ts";
import { noticeMs } from "../ui/delivery.ts";
import { scheduleDelete } from "../ui/transient-messages.ts";
import * as noticeText from "../ui/text/ko/notices.ts";
import type { Notice } from "../ui/text/notice.ts";
import { DISCORD_LOOK } from "../ui/mentions.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import { repeatingFailure } from "../infra/repeating-failure.ts";
import { bestEffort } from "../infra/best-effort.ts";

const BACKOFF_MS = [60_000, 120_000, 300_000, 600_000, 1_800_000];
const BOOT_GAP_MS = 1000; // 기동 때 서버 사이. 게이트웨이 보내기 한도(60초 120번)에 넉넉하다

// 끝마다 할 일. 없는 끝(stop · leave · guild-gone · operator-leave · replaced · fault-restart · stage-ended)은 아무것도 하지 않는다
const DROP: Partial<Record<PlayerEnd, "kicked" | "gone">> = { "forced-disconnect": "kicked", "stage-disconnect": "kicked", "channel-gone": "gone" };
const RETRY = new Set<PlayerEnd>(["voice-lost", "connect-failed", "restore-failed", "adopt-failed", "fault-cleared", "queue-drained", "inactivity-timeout"]);

type Why = "kicked" | "gone" | "permission";
const NOTICE: Record<Why, (channel: string) => Notice> = { kicked: noticeText.stayKicked, gone: noticeText.stayChannelGone, permission: noticeText.stayNoPermission };
const WHY_LOG: Record<Why, string> = { kicked: "강제 퇴장", gone: "채널 삭제", permission: "채널 권한 없음" };

// 자리를 끈 알림을 서버의 전용 채널에(없으면 알리지 않는다. 로그는 남는다). 다른 경고 · 오류 안내처럼 수준에 맞는 수명 뒤 지운다
async function announce(guild: Guild, notice: Notice) {
  const channel = await resolveFallbackTextChannel(guild).catch(() => null);
  if (!channel) return;
  const sending = channel.send(post(noticeFrame(notice))).then((sent) => scheduleDelete(sent, noticeMs(notice)));
  await bestEffort(log, sending, "상주 모드 해제 알림 전송");
}

/** join · announce · sleep 은 시험이 바꾼다 */
type Deps = { client: Client; players: Pick<PlayerSeats, "get" | "set">; join?: typeof joinChannel; announce?: typeof announce; sleep?: (ms: number) => Promise<void> };

// 자리 채널을 디스코드에 물은 결과: 붙을 채널 · 자리를 끌 까닭 · 묻지 못함(null)
type Found = { channel: VoiceBasedChannel } | { why: Why } | null;

class StayKeeper {
  client: Client;
  players: Pick<PlayerSeats, "get" | "set">;
  join: typeof joinChannel;
  tell: typeof announce;
  sleep: (ms: number) => Promise<void>;
  timers = new Map<string, NodeJS.Timeout>();
  tries = new Map<string, number>();
  failures = new Map<string, ReturnType<typeof repeatingFailure>>();
  blocked = new Set<string>(); // 되풀이 오류로 차단한 서버
  busy = new Set<string>(); // 붙는 중
  ready = false; // 기동 차례가 끝났다(그 전의 GuildAvailable 은 기동이 맡는다)

  constructor({ client, players, join = joinChannel, announce: tell = announce, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }: Deps) {
    this.client = client;
    this.players = players;
    this.join = join;
    this.tell = tell;
    this.sleep = sleep;
  }

  _failure(guildId: string) {
    let f = this.failures.get(guildId);
    if (!f) {
      f = repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, `상주 채널 재접속(서버 ${guildId})`);
      this.failures.set(guildId, f);
    }
    return f;
  }

  _cancel(guildId: string) {
    clearTimeout(this.timers.get(guildId));
    this.timers.delete(guildId);
  }

  // 다음 시도를 건다. 붙으면 처음으로(tries 를 지운다)
  _later(guildId: string) {
    this._cancel(guildId);
    const n = this.tries.get(guildId) ?? 0;
    this.tries.set(guildId, n + 1);
    const timer = setTimeout(
      () => {
        this.timers.delete(guildId);
        void this.attempt(guildId);
      },
      BACKOFF_MS[Math.min(n, BACKOFF_MS.length - 1)],
    );
    timer.unref?.();
    this.timers.set(guildId, timer);
  }

  // 자리를 끄고 서버 채널에 알린다. 이미 꺼졌으면(다른 길이 먼저 껐다) 아무것도 안 한다
  async _drop(guild: Guild, why: Why) {
    this._cancel(guild.id);
    const channelId = staySeats.seatOf(guild.id)?.channelId;
    if (!channelId || !staySeats.clear(guild.id)) return;
    log.info(`상주 모드 자동 해제: ${guild.name} | 원인=${WHY_LOG[why]}`);
    playerEvents.touched(guild.id);
    await this.tell(guild, NOTICE[why](DISCORD_LOOK.channel(channelId)));
  }

  // 자리 채널을 디스코드에 묻는다(캐시는 기동 · 재연결 때 비어 있을 수 있다)
  async _seatChannel(guild: Guild, channelId: string): Promise<Found> {
    try {
      const channel = await guild.channels.fetch(channelId);
      if (!channel?.isVoiceBased() || channel.isThread()) return { why: "gone" };
      const me = guild.members.me;
      const perms = me ? channel.permissionsFor(me) : null;
      if (!perms?.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) return { why: "permission" };
      return { channel };
    } catch (error) {
      if (codeOf(error) === RESTJSONErrorCodes.UnknownChannel) return { why: "gone" };
      if (codeOf(error) === RESTJSONErrorCodes.MissingAccess) return { why: "permission" };
      this._failure(guild.id).fail(`채널을 묻지 못함: ${messageOf(error)}`);
      return null;
    }
  }

  // 붙어 볼 서버인가. 붙어 있으면(자리가 아닌 채널이면 거기서 나간 뒤 끝 알림으로 다시 온다) · 서버를 쓸 수 없으면(돌아오면 GuildAvailable) 아니다
  _guildToTry(guildId: string) {
    if (!staySeats.seatOf(guildId) || this.blocked.has(guildId) || this.busy.has(guildId)) return null;
    if (this.players.get(guildId)?.voice.isAlive()) return null;
    const guild = this.client.guilds.cache.get(guildId);
    return guild?.available ? guild : null;
  }

  /** 그 서버의 자리에 붙어 본다. 붙었거나 할 일이 없으면 true */
  async attempt(guildId: string): Promise<boolean> {
    const guild = this._guildToTry(guildId);
    if (!guild) return true;
    this.busy.add(guildId);
    try {
      await waitForRestore(guildId);
      const seat = staySeats.seatOf(guildId);
      if (!seat || this.players.get(guildId)?.voice.isAlive()) return true;
      const found = await this._seatChannel(guild, seat.channelId);
      if (!found) {
        this._later(guildId);
        return false;
      }
      if ("why" in found) {
        await this._drop(guild, found.why);
        return true;
      }
      return await this._join(guild, found.channel);
    } catch (error) {
      this._failure(guildId).fail(messageOf(error));
      this._later(guildId);
      return false;
    } finally {
      this.busy.delete(guildId);
    }
  }

  async _join(guild: Guild, channel: VoiceBasedChannel) {
    const result = await this.join({ players: this.players }, { guild, channel });
    if (result.kind === "refused" && result.code === "permission-voice") {
      await this._drop(guild, "permission");
      return true;
    }
    if (result.kind === "refused" || result.kind === "restore-error") {
      this._failure(guild.id).fail(result.kind === "refused" ? result.code : "세션 복원 오류");
      this._later(guild.id);
      return false;
    }
    this.tries.delete(guild.id);
    this._failure(guild.id).ok();
    log.info(`상주 채널 재접속: "${channel.name}" (${guild.name})`);
    result.player.idle.reconsider();
    return true;
  }

  /** 기동: 자리가 있고 붙어 있지 않은 서버를 하나씩. skip 이면(짧은 간격의 비정상 종료가 되풀이됨) 붙지 않는다(자리는 남긴다) */
  async boot({ skip = false }: { skip?: boolean } = {}) {
    const seats = staySeats.all();
    if (skip && seats.length) log.warn(`단시간 내 비정상 종료가 반복되어 상주 채널 ${seats.length}곳의 자동 재접속을 건너뜁니다(상주 설정은 유지)`);
    if (!skip) {
      let first = true;
      for (const [guildId] of seats) {
        if (this.players.get(guildId)?.voice.isAlive()) continue;
        if (!first) await this.sleep(BOOT_GAP_MS);
        first = false;
        await this.attempt(guildId);
      }
    }
    this.ready = true;
  }

  /** 플레이어가 끝났다(playerEvents.disposed). 끝의 종류로 할 일을 정한다 */
  onDisposed(player: Pick<Player, "guild" | "voiceChannel">, end: PlayerEnd) {
    const guildId = player.guild.id;
    const seat = staySeats.seatOf(guildId);
    if (!seat) return;
    if (end === "fault") {
      this.blocked.add(guildId);
      this._cancel(guildId);
      log.warn(`동일 오류 반복으로 차단된 서버라 상주 채널 재접속을 건너뜁니다(봇 재시작 또는 곡 재생 시 해제): ${player.guild.name}`);
      return;
    }
    const why = DROP[end];
    // 자리가 아닌 채널에서 내보내졌거나 그 채널이 사라졌으면 자리는 그대로, 자리로 돌아간다
    if (why && player.voiceChannel?.id === seat.channelId) {
      void this._drop(player.guild, why);
      return;
    }
    if (why || RETRY.has(end)) {
      this.tries.delete(guildId);
      this._later(guildId);
    }
  }

  /** 곡을 다시 틀었다. 차단한 서버를 푼다 */
  wake(guildId: string) {
    this.blocked.delete(guildId);
  }

  /** 기동 때 쓸 수 없던 서버가 돌아왔다(새 세션마다 모든 서버에도 온다) */
  onGuildAvailable(guild: Guild) {
    if (!this.ready || this.timers.has(guild.id)) return;
    void this.attempt(guild.id);
  }

  /** 자리 채널이 지워졌다(봇이 없던 동안도) */
  onChannelDeleted(guild: Guild, channelId: string) {
    if (staySeats.seatOf(guild.id)?.channelId === channelId) void this._drop(guild, "gone");
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

const createStayKeeper = (deps: Deps) => new StayKeeper(deps);

export { createStayKeeper, StayKeeper, BACKOFF_MS };
