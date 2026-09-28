// 음성 연결 한 가닥. 라이브러리의 연결 전이와 게이트웨이가 알린 봇의 음성 상태를 한 곳에서 받아 다음 상태와 할 일을 정한다.
// 상태 · 전이 표와 정한 것은 notes/ref-voice-link.md. 복구 · 강제 퇴장 · 채널 사라짐 · 이동 · 서버 음소거를 여기서만 가른다.

import { VoiceConnectionStatus, VoiceConnectionDisconnectReason, joinVoiceChannel, entersState, type VoiceConnection, type VoiceConnectionState } from "@discordjs/voice";
import type { VoiceBasedChannel, VoiceState } from "discord.js";
import type { Player } from "./Player.ts";
import logger from "../infra/log/logger.ts";
import { holdingAdapterCreator } from "../infra/voiceAdapter.ts";
import { bindToGuild } from "../infra/guildContext.ts";
import { codeOf, errorKind, messageOf } from "../rules/errorKind.ts";

const log = logger.child({ category: "voice" });

/** 음성 라이브러리에서 부르는 것 */
type VoiceLib = { joinVoiceChannel: typeof joinVoiceChannel; entersState: typeof entersState };
/** 연결을 맡으며 읽고 바꾸는 플레이어 칸 */
type VoiceHost = Pick<Player, "audioPlayer" | "connection" | "dispose" | "currentTrack" | "guild" | "onVoiceRecovered" | "voiceChannel" | "pauseFor" | "resumeFor">;
type LinkState = "idle" | "joining" | "ready" | "waiting" | "recovering" | "closed";
/** 게이트웨이의 봇 음성 상태에서 일어난 일. 화면 · 혼자 남음은 부른 쪽이 맞춘다 */
type BotStateChange = { left: boolean; moved: boolean; muteChanged: boolean };

const VOICE_LIB: VoiceLib = { joinVoiceChannel, entersState };
const JOIN_READY_MS = 30_000; // 처음 붙을 때 Ready 까지
const RECOVER_READY_MS = 15_000; // 다시 붙일 때 Ready 까지
const MOVE_BOUNCE_MS = 1500; // 옮겨진 뒤 이만큼 안에, 방금 고치지 않은 참가 요청을 보낸 채널로 돌아오면 라이브러리의 되돌림으로 본다
const STUCK_MS = 5000; // 참가 요청에 이만큼 답이 없고 디스코드가 봇이 그 채널에 있다고 보면 나갔다가 다시 붙는다
const UNKNOWN_CHANNEL = 10003;
const VOICE_STATE_UPDATE = 4; // 게이트웨이 op. 음성 채널 참가 · 나가기
const BOUNCE_FIX_GAP_MS = 10_000; // 되돌려 붙기 사이 최소 간격. 되돌림이 되풀이돼도 핑퐁이 되지 않게

// 로그에 찍을 이름
const guildName = (p: VoiceHost) => p.guild?.name ?? p.guild?.id;
const channelName = (p: VoiceHost) => p.voiceChannel?.name ?? p.voiceChannel?.id ?? "?";
const LIVE: ReadonlySet<LinkState> = new Set(["joining", "ready", "waiting", "recovering"]);
// 빠짐 · 사라짐으로 버릴 때(세션 지움)
const FORCED_OUT = { reason: "봇이 음성에서 강제 퇴장됨", session: "remove", panel: "disconnected", end: "forced-disconnect" } as const;
const CHANNEL_GONE = { reason: "봇의 음성 채널이 사라짐", session: "remove", end: "channel-gone" } as const;

class VoiceLink {
  player: VoiceHost;
  lib: VoiceLib;
  state: LinkState = "idle";
  /** 기다림 · 복구의 세대. 바뀌면(새 기다림 · 정리) 늦게 온 결과를 버린다 */
  gen = 0;
  waitTimer: NodeJS.Timeout | null = null;
  recoveryAttempts = 0;
  maxRecoveryAttempts = 5;
  // 기다리는 시간. 시험이 줄인다
  waitStartMs = 5000; // 끊긴 뒤 라이브러리가 다시 붙기 시작하기까지(Signalling · Connecting)
  waitReadyMs = 20_000; // 다시 붙기 시작한 뒤 Ready 까지
  recoveryRetryDelayMs = 3000; // 복구 시도 사이
  lastMove: { from: string; to: string; at: number } | null = null;
  lastBounceFix: number | null = null;
  /** 라이브러리가 고치지 않고 내보낸 마지막 참가 요청(어댑터가 알린다). 되돌림을 사람의 이동과 가른다 */
  lastPlainJoin: { channelId: string; at: number } | null = null;
  /** 답 없는 참가를 풀려고 스스로 나간 채널. 그 빠짐 알림은 쫓겨난 것이 아니다 */
  selfLeave: string | null = null;

  constructor(player: VoiceHost, lib: VoiceLib = VOICE_LIB) {
    this.player = player;
    this.lib = lib;
  }

  get isRecovering() {
    return this.state === "recovering";
  }

  /** 붙어 있거나 붙는 중이다(기다림 · 복구 포함). `/join` 이 "이미 접속"으로 볼지 이것으로 정한다 */
  isAlive() {
    return LIVE.has(this.state);
  }

  _label() {
    return `"${channelName(this.player)}" (${guildName(this.player)})`;
  }

  // ── 붙기 ──

  /** 음성 채널에 붙는다. 못 붙으면 던진다(부른 쪽이 처리) */
  async connect() {
    this.state = "joining";
    try {
      await this._join(JOIN_READY_MS);
      this.state = "ready";
      log.info(`음성 채널 참가: ${this._label()}`);
      return true;
    } catch (error) {
      this._drop();
      this.state = "idle";
      log.error("음성 채널 연결 실패:", messageOf(error));
      throw error;
    }
  }

  // 새 연결을 만들어 전이를 듣고 오디오 플레이어를 구독시킨 뒤, 준비될 때까지 기다린다
  async _join(readyMs: number) {
    const player = this.player;
    const channelId = player.voiceChannel?.id;
    if (!channelId) throw new Error("음성 채널이 없습니다");
    const connection = this.lib.joinVoiceChannel({ channelId, guildId: player.guild.id, adapterCreator: this._adapterCreator() });
    player.connection = connection;
    this._watch(connection);
    connection.subscribe(player.audioPlayer);
    const stuck = setTimeout(() => this._unstick(connection, channelId), STUCK_MS);
    try {
      await this.lib.entersState(connection, VoiceConnectionStatus.Ready, readyMs);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error(`${readyMs / 1000}초 안에 붙지 못했습니다`, { cause: error });
      throw error;
    } finally {
      clearTimeout(stuck);
      // 나감 알림은 참가의 답(Ready)보다 먼저 온다. 끝났으면 기다릴 것이 없다
      this.selfLeave = null;
    }
  }

  // 참가 요청에 답이 없다. 디스코드가 봇이 이미 그 채널에 있다고 보면(나감이 닿지 못한 채 남은 것) 같은 채널 참가에 답하지 않으므로,
  // 게이트웨이로 나갔다가 다시 참가를 요청한다(REST 로 빼기는 멤버 옮기기 권한이 든다)
  _unstick(connection: VoiceConnection, channelId: string) {
    const state = connection.state;
    if (connection !== this.player.connection || state.status !== VoiceConnectionStatus.Signalling || this.player.guild.members?.me?.voice?.channelId !== channelId) return;
    log.warn(`참가 요청에 ${STUCK_MS / 1000}초 동안 답이 없습니다. 디스코드는 봇이 이미 이 채널에 있다고 봅니다. 나갔다가 다시 붙습니다: ${this._label()}`);
    this.selfLeave = channelId;
    const { selfDeaf, selfMute } = connection.joinConfig;
    state.adapter.sendPayload({ op: VOICE_STATE_UPDATE, d: { guild_id: this.player.guild.id, channel_id: null, self_deaf: selfDeaf, self_mute: selfMute } });
    connection.rejoin();
  }

  // 옮겨질 때 옛 채널로 다시 참가하지 않게 참가 요청을 잠깐 붙잡는 어댑터(infra/voiceAdapter)
  _adapterCreator() {
    const player = this.player;
    return holdingAdapterCreator(player.guild.voiceAdapterCreator, {
      onRewrite: (from: string, to: string) => log.info(`음성 재참가 요청을 옮겨진 채널로 고쳐 보냅니다: ${from} → ${to} (${guildName(player)})`),
      onSend: (channelId: string, rewritten: boolean) => {
        if (!rewritten) this.lastPlainJoin = { channelId, at: Date.now() };
      },
    });
  }

  // 연결의 전이 · 오류를 듣는다. 옛 연결은 부수기 전에 리스너를 떼므로(_detach) 여기로 오는 것은 지금 연결의 소식이다
  // 연결은 라이브러리가 쏜다. 이 서버의 문맥에 묶어 새어 나온 오류가 이 서버로 돌아오게 한다(infra/guildContext)
  _watch(connection: VoiceConnection) {
    const guildId = this.player.guild.id;
    connection.on(
      "stateChange",
      bindToGuild(guildId, (oldState: VoiceConnectionState, newState: VoiceConnectionState) => this._onStateChange(oldState, newState)),
    );
    connection.on(
      "error",
      bindToGuild(guildId, (error: Error) => this._onError(error)),
    );
  }

  _onStateChange(oldState: VoiceConnectionState, newState: VoiceConnectionState) {
    if (this.state === "closed") return;
    if (oldState.status !== newState.status) log.debug(`연결 상태: ${oldState.status} → ${newState.status} | ${this._label()}`);
    if (newState.status === VoiceConnectionStatus.Ready && this.state === "waiting") {
      this._clearWait();
      this.state = "ready";
      log.info({ tags: ["recovered"] }, `자동 재연결 성공: ${this._label()}`);
      return;
    }
    if (newState.status === VoiceConnectionStatus.Disconnected && this.state === "ready") {
      if (newState.reason === VoiceConnectionDisconnectReason.Manual) return;
      this._wait(newState.reason, "closeCode" in newState ? newState.closeCode : undefined);
      return;
    }
    if (newState.status === VoiceConnectionStatus.Destroyed) this.recover("연결이 부서짐");
  }

  _onError(error: Error) {
    if (this.state === "closed") return;
    // 네트워크가 끊긴 것은 복구 시작 줄이 까닭과 함께 남긴다
    if (errorKind(error) === "network") {
      this.recover(`네트워크 오류(${messageOf(error)})`);
      return;
    }
    log.error("음성 연결 오류:", error);
    this.recover("연결 오류");
  }

  // ── 끊김: 라이브러리가 스스로 다시 붙기를 기다린다 ──

  _wait(reason: VoiceConnectionDisconnectReason, closeCode: number | undefined) {
    this.state = "waiting";
    const gen = ++this.gen;
    log.warn(`연결 끊김: ${this._label()} | 사유=${reason}${closeCode ? `(${closeCode})` : ""} | 자동 재연결 대기`);
    this._clearWait();
    this.waitTimer = setTimeout(() => {
      if (gen !== this.gen || this.state !== "waiting") return;
      const status = this.player.connection?.state.status;
      // 다시 붙기 시작했으면 Ready 까지 조금 더 기다린다
      if (status === VoiceConnectionStatus.Signalling || status === VoiceConnectionStatus.Connecting) {
        this.waitTimer = setTimeout(() => {
          if (gen === this.gen && this.state === "waiting") this._afterWait();
        }, this.waitReadyMs);
        return;
      }
      this._afterWait();
    }, this.waitStartMs);
  }

  _clearWait() {
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = null;
  }

  // 기다려도 다시 붙지 않았다. 봇이 채널에 없으면(퇴장 알림이 아직 안 옴) 빠진 것으로, 있으면 우리가 다시 붙인다
  _afterWait() {
    const inChannel = this.player.guild.members?.me?.voice?.channelId;
    if (inChannel === null) {
      this._leftChannel(this.player.voiceChannel?.id ?? null);
      return;
    }
    log.warn(`자동 재연결 실패: ${this._label()} | 다시 붙입니다`);
    this.recover("자동 재연결 안 됨");
  }

  // ── 복구: 우리가 다시 붙인다 ──

  /** 연결을 다시 붙인다. 붙어 있거나 끊겨 기다리는 중일 때만 받는다(이미 복구 중 · 끝남 · 붙는 중이면 아무것도 안 한다) */
  recover(why: string) {
    // 붙는 중에 부서지면 connect() 가 실패를 받는다
    if (this.state !== "ready" && this.state !== "waiting") return;
    this._clearWait();
    this.state = "recovering";
    this.recoveryAttempts = 0;
    const gen = ++this.gen;
    log.warn(`연결 복구 시작: ${this._label()} | 까닭=${why} | 최대 ${this.maxRecoveryAttempts}회`);
    this._recoverLoop(gen).catch((error: unknown) => log.error("연결 복구 루프 오류:", error));
  }

  // 시도 → 기다림 → 쉼을 차례로 되풀이한다. 세대가 바뀌면(정리 · 새 복구) 늦게 돌아온 결과로 아무것도 하지 않는다
  async _recoverLoop(gen: number) {
    const active = () => gen === this.gen && this.state === "recovering";
    while (active()) {
      this.recoveryAttempts++;
      if (this.recoveryAttempts > this.maxRecoveryAttempts) return this._giveUp();
      if (!this._liveChannel()) return this.channelGone();
      const joined = await this._rejoin();
      if (!active()) return;
      if (joined) {
        this.state = "ready";
        log.info({ tags: ["recovered"] }, `연결 복구 완료: ${this._label()} | 시도 ${this.recoveryAttempts}회`);
        await this.player.onVoiceRecovered();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, this.recoveryRetryDelayMs));
    }
  }

  // 옛 연결을 떼어 부수고 같은 채널에 새로 붙는다. 됐으면 true
  async _rejoin() {
    this._drop();
    try {
      await this._join(RECOVER_READY_MS);
      return true;
    } catch (error) {
      // 중간 시도의 실패. 다음 시도가 받고, 끝내 못 붙으면 포기 줄이 남긴다
      log.debug(`연결 복구 ${this.recoveryAttempts}회차 실패: ${messageOf(error)}`);
      return false;
    }
  }

  // 서버에 아직 있는 음성 채널. 지워졌으면 없다
  _liveChannel() {
    const channelId = this.player.voiceChannel?.id;
    return channelId ? this.player.guild.channels.cache.get(channelId) : null;
  }

  // 다시 붙지 못했다. 세션을 저장하고 버린다. /join 이 저장된 세션으로 이어서 튼다
  _giveUp() {
    log.error(`연결 복구 포기: ${this._label()} | 최대 ${this.maxRecoveryAttempts}회를 넘었습니다. 세션을 저장하고 정리합니다`);
    this._end({ reason: "음성 연결 복구 포기", session: "save", panel: "disconnected", end: "voice-lost" });
  }

  // ── 게이트웨이: 봇 자신의 음성 상태 ──

  /** 게이트웨이가 알린 봇의 음성 상태. 빠짐(강제 퇴장 · 채널 사라짐) · 옮겨짐 · 서버 음소거를 가른다 */
  onBotState(oldState: Pick<VoiceState, "channelId" | "serverMute" | "serverDeaf" | "suppress">, newState: Pick<VoiceState, "channelId" | "serverMute" | "serverDeaf" | "suppress" | "channel">): BotStateChange {
    if (oldState.channelId && !newState.channelId) {
      // 답 없는 참가를 풀려고 스스로 나갔다. 다시 참가가 뒤따른다
      if (this.selfLeave === oldState.channelId) {
        this.selfLeave = null;
        log.debug(`스스로 나간 알림. 다시 참가를 기다립니다: ${this._label()}`);
        return { left: false, moved: false, muteChanged: false };
      }
      // 다시 붙이는 중이면 쫓겨난 것이 아니다. 봇의 게이트웨이가 끊기면 디스코드가 음성 상태를 지운다. 복구가 다시 참가한다
      if (this.state === "waiting" || this.state === "recovering") {
        log.info(`디스코드가 봇을 음성 채널에서 뺐습니다. 다시 붙이는 중이라 쫓겨난 것으로 보지 않습니다: ${this._label()}`);
        this.recover("음성 상태가 지워짐");
        return { left: false, moved: false, muteChanged: false };
      }
      this._leftChannel(oldState.channelId);
      return { left: true, moved: false, muteChanged: false };
    }
    let moved = false;
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId && newState.channel) {
      this.followMove(oldState.channelId, newState.channel);
      moved = true;
    }
    return { left: false, moved, muteChanged: this._followMute(oldState, newState) };
  }

  // 서버 음소거 · 헤드셋 끄기 · 무대 발언권 없음은 들을 수 없으니 멈춘다. 멈춤이 바뀌었으면 true
  _followMute(oldState: Pick<VoiceState, "serverMute" | "serverDeaf" | "suppress">, newState: Pick<VoiceState, "serverMute" | "serverDeaf" | "suppress">) {
    const wasMuted = oldState.serverMute || oldState.serverDeaf || oldState.suppress;
    const isMuted = newState.serverMute || newState.serverDeaf || newState.suppress;
    if (!wasMuted && isMuted) return this.player.pauseFor("mute");
    if (wasMuted && !isMuted) {
      this.player.resumeFor("mute");
      return true;
    }
    return false;
  }

  // 봇이 채널에서 빠졌다. 채널이 없으면 채널 사라짐, 있으면 강제 퇴장. 빠짐 알림이 채널 삭제 알림보다 먼저 올 수 있어 캐시가 아니라 디스코드에 묻는다
  _leftChannel(channelId: string | null) {
    if (this.state === "closed") return;
    this.stop();
    this.state = "closed";
    this._channelExists(channelId)
      .then((exists) => this.player.dispose(exists ? FORCED_OUT : CHANNEL_GONE))
      .catch((error: unknown) => log.error("빠진 뒤 정리 실패:", error));
  }

  // 채널이 아직 있나. 캐시에 없으면 없다. 있으면 디스코드에 물어 없다는 답(10003)일 때만 없다(묻지 못하면 있다고 본다)
  async _channelExists(channelId: string | null) {
    if (!channelId) return true;
    const channels = this.player.guild.channels;
    if (!channels.cache.has(channelId)) return false;
    try {
      return Boolean(await channels.fetch(channelId, { force: true }));
    } catch (error) {
      return codeOf(error) !== UNKNOWN_CHANNEL;
    }
  }

  /** 봇이 음성에서 쫓겨났다. 세션을 지우고 끝난 패널로 버린다 */
  forcedOut() {
    this._end(FORCED_OUT);
  }

  /** 봇의 음성 채널이 사라졌다. 세션을 지우고 버린다 */
  channelGone() {
    this._end(CHANNEL_GONE);
  }

  _end(o: Parameters<VoiceHost["dispose"]>[0]) {
    if (this.state === "closed") return;
    this.stop();
    this.state = "closed";
    this.player.dispose(o).catch((error: unknown) => log.error(`정리 실패 (${o.reason}):`, error));
  }

  /**
   * 누가 봇을 다른 채널로 옮겼다. 음성 라이브러리는 상태 패킷으로 목적지를 따라가므로
   * 다시 붙지 않고 기록만 맞춘다. 이벤트마다 다시 붙으면 그 다시 붙기가 또 이벤트를 만들어 채널 사이를 오간다.
   *
   * 다만 라이브러리에 경쟁이 있다. 옮겨지는 순간 음성 서버 연결이 상태 패킷보다 먼저 닫히면 옛 설정으로
   * 다시 참가해 원래 채널로 되돌아간다(@discordjs/voice onNetworkingClose). 대개는 어댑터가 그 요청을 붙잡아 고쳐 보내지만
   * 늦으면 고치지 않은 채 나간다. 방금 옮겨진 곳에서 곧바로 원래 채널로 돌아왔고, 그 직전에 라이브러리가 그 채널로 고치지 않은
   * 참가 요청을 보냈으면 되돌림으로 보고 목적지로 한 번 다시 붙는다. 사람이 빠르게 되돌린 이동에는 그런 요청이 없다.
   * @returns {boolean} 되돌려 붙었나
   */
  followMove(fromId: string, toChannel: VoiceBasedChannel, now = Date.now()) {
    const player = this.player;
    const where = guildName(player);
    const target = this._bouncedFrom(fromId, toChannel, now);
    if (target) {
      this.lastBounceFix = now;
      this.lastMove = null;
      player.voiceChannel = target;
      log.warn(`음성 채널이 옮겨진 직후 원래 채널로 되돌아와 다시 옮깁니다: "${target.name ?? target.id}" (${where})`);
      player.connection?.rejoin({ channelId: target.id, selfDeaf: false, selfMute: false });
      return true;
    }
    this.lastMove = { from: fromId, to: toChannel.id, at: now };
    player.voiceChannel = toChannel;
    log.info(`음성 채널 이동: "${toChannel.name ?? toChannel.id}" (${where})`);
    return false;
  }

  // 방금 옮겨진 곳에서 곧바로 원래 채널로 되돌아왔으면 다시 붙을 목적지. 아니면(또는 막 되돌려 붙었으면) null
  _bouncedFrom(fromId: string, toChannel: VoiceBasedChannel, now: number): VoiceBasedChannel | null {
    const last = this.lastMove;
    if (!last || now - last.at >= MOVE_BOUNCE_MS || last.from !== toChannel.id || last.to !== fromId) return null;
    const sent = this.lastPlainJoin;
    if (!sent || sent.channelId !== toChannel.id || now - sent.at >= MOVE_BOUNCE_MS) return null;
    if (!this.player.connection || now - (this.lastBounceFix ?? -Infinity) < BOUNCE_FIX_GAP_MS) return null;
    const channel = this.player.guild.channels.cache.get(last.to);
    return channel?.isVoiceBased() ? channel : null;
  }

  // ── 정리 ──

  /** 기다림 · 복구를 멈춘다(플레이어를 버릴 때). 늦게 돌아온 결과는 버린다 */
  stop() {
    this.gen++;
    this._clearWait();
  }

  // 지금 연결을 떼어 비우고 돌려준다. 리스너를 먼저 떼어 부서지는 연결이 전이를 알리지 않게 한다
  _detach() {
    const connection = this.player.connection;
    this.player.connection = null;
    connection?.removeAllListeners();
    return connection;
  }

  // 지금 연결을 떼어 부순다(다시 붙기 전 · 붙기 실패)
  _drop() {
    const connection = this._detach();
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) return;
    try {
      connection.destroy();
    } catch {
      // 이미 부서짐 등. 새 연결로 진행
    }
  }

  /** 채널에는 남긴 채 이 쪽 연결만 정리한다(나감 메시지를 보내지 않는다). 재시작 뒤 같은 채널에 다시 붙는다 */
  release(reason: string) {
    this.stop();
    this.state = "closed";
    const connection = this._detach();
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) return;
    try {
      connection.destroy(false);
      log.info(`음성 연결 정리(채널에는 남음): ${this._label()} | 원인=${reason}`);
    } catch (error) {
      log.error("음성 연결 정리 실패:", error);
    }
  }

  /** 연결을 부수고 채널에서 나간다. 무음으로 나가면 왜 나갔는지 사후에 알 수 없으므로 원인을 남긴다 */
  disconnect(reason = "정리") {
    this.stop();
    this.state = "closed";
    const connection = this._detach();
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) return;
    try {
      connection.destroy();
      log.info(`음성 채널 떠남: ${this._label()} | 원인=${reason}`);
    } catch (error) {
      log.error("음성 연결 종료 실패:", error);
    }
  }
}

export { VoiceLink };
export type { VoiceHost, VoiceLib, LinkState, BotStateChange };
