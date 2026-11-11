// 음성 연결 한 가닥. 라이브러리의 연결 전이와 게이트웨이가 알린 봇의 음성 상태를 한 곳에서 받아 다음 상태와 할 일을 정한다.
// 복구, 강제 퇴장, 채널 사라짐, 이동, 서버 음소거를 여기서만 구분한다.

import { VoiceConnectionStatus, VoiceConnectionDisconnectReason, joinVoiceChannel, entersState, type VoiceConnection, type VoiceConnectionState } from "@discordjs/voice";
import { ChannelType, PermissionFlagsBits, RESTJSONErrorCodes, type VoiceBasedChannel, type VoiceState } from "discord.js";
import type { Player } from "./player.ts";
import logger from "../infra/log/logger.ts";
import { holdingAdapterCreator, leavePayload } from "../infra/voice-adapter.ts";
import { isShuttingDown } from "../infra/shutdown-state.ts";
import { botChannelAtDiscord } from "./voice-leave.ts";
import { bindToGuild } from "../infra/guild-context.ts";
import { codeOf, codedError, describeError, errorKind, messageOf } from "../rules/error-kind.ts";

const log = logger.child({ category: "voice" });

/** 음성 라이브러리에서 부르는 것 */
/** newSessionAt: 그 샤드가 마지막으로 게이트웨이 새 세션을 받은 때(ms, infra/gateway-sessions). 없으면 새 세션을 모르는 것으로 본다 */
type VoiceLib = { joinVoiceChannel: typeof joinVoiceChannel; entersState: typeof entersState; newSessionAt?: (shardId: number) => number | null };
/** 연결을 맡으며 읽고 바꾸는 플레이어 필드 */
type VoiceHost = Pick<Player, "audioPlayer" | "connection" | "dispose" | "currentTrack" | "guild" | "onVoiceRecovered" | "voiceChannel" | "syncHolds" | "movedVoiceStatus" | "noticeStage">;
type LinkState = "idle" | "joining" | "ready" | "waiting" | "recovering" | "closed";
/** 게이트웨이의 봇 음성 상태에서 일어난 일. 억제 사유, 화면은 부른 쪽이 맞춘다(player.syncHolds) */
type BotStateChange = { left: boolean; moved: boolean };

const VOICE_LIB: VoiceLib = { joinVoiceChannel, entersState };
const JOIN_READY_MS = 30_000; // 처음 붙을 때 Ready 까지
const RECOVER_READY_MS = 15_000; // 재연결할 때 Ready 까지
const MOVE_BOUNCE_MS = 1500; // 옮겨진 뒤 이만큼 안에, 방금 고치지 않은 참가 요청을 보낸 채널로 돌아오면 라이브러리의 되돌림으로 본다
const STUCK_MS = 5000; // 참가 요청에 이만큼 답이 없으면 풀어 본다(_unstick)
const MAX_LIB_REJOINS = 5; // 라이브러리가 Ready 없이 스스로 다시 참가하는 횟수의 상한. 넘으면 우리 복구(시도 사이를 둔다)로
const RENEWED_WINDOW_MS = 30_000; // 4014 앞으로 이만큼 안에 받은 게이트웨이 새 세션은 그 4014 의 까닭으로 본다
const UNKNOWN_CHANNEL = RESTJSONErrorCodes.UnknownChannel;
const DO_NOT_RECONNECT = 4014; // 음성 서버의 닫힘 코드. 쫓겨났거나 옮겨졌다
const CALL_TERMINATED = 4022; // 음성 서버의 닫힘 코드. 통화를 끝내 모두를 끊었다(스테이지 종료, 채널 삭제 등)
const BOUNCE_FIX_GAP_MS = 10_000; // 되돌려 붙기 사이 최소 간격. 되돌림이 되풀이돼도 핑퐁이 되지 않게

// 로그에 찍을 이름
const guildName = (p: VoiceHost) => p.guild?.name ?? p.guild?.id;
const channelName = (p: VoiceHost) => p.voiceChannel?.name ?? p.voiceChannel?.id ?? "?";
const LIVE: ReadonlySet<LinkState> = new Set(["joining", "ready", "waiting", "recovering"]);
const RECOVERY_ATTEMPTS_MAX = 5; // 한 번의 끊김에 연결 복구를 시도하는 횟수. 넘으면 세션을 저장하고 정리한다
// 빠짐, 사라짐으로 버릴 때(세션 삭제)
const FORCED_OUT = { reason: "봇이 음성에서 강제 퇴장됨", session: "remove", panel: "disconnected", end: "kicked" } as const;
// 스테이지가 끝나도 쫓겨난 것과 같은 빠짐 알림만 온다. 가르는 것은 음성 서버의 닫힘 코드: 끝나면 모두를 끊어 4022, 한 명만 내보내면 4014.
// 4014 는 빠짐 알림보다 먼저, 4022 는 0.1 ~ 0.2초 뒤에 온다(실측). 코드가 끝내 오지 않으면 둘 다 말한다
const STAGE_ENDED = { reason: "스테이지가 끝남", session: "remove", panel: "disconnected", end: "stage-ended" } as const;
const STAGE_OUT = { reason: "봇이 스테이지에서 나옴(스테이지 종료 또는 강제 퇴장)", session: "remove", panel: "disconnected", end: "stage-disconnect" } as const;
const CHANNEL_GONE = { reason: "봇의 음성 채널이 사라짐", session: "remove", panel: "disconnected", end: "channel-gone" } as const;

// 서버 헤드셋 끄기. 자기 헤드셋 끄기로는 디스코드가 채널의 말소리를 계속 보내온다.
// 멤버에 남아(채널을 옮기거나 다시 들어와도) 대개 서버마다 한 번 걸린다. 음성 밖에서는 걸 수 없다(40032)
const DEAFEN_REASON = "쓰지 않는 음성 수신을 끊어 트래픽 절약"; // 감사 로그에 남는 사유
const NOT_IN_VOICE = 40032;

class VoiceLink {
  player: VoiceHost;
  lib: VoiceLib;
  state: LinkState = "idle";
  /** 기다림, 복구의 세대. 바뀌면(새 기다림, 정리) 늦게 온 결과를 버린다 */
  gen = 0;
  waitTimer: NodeJS.Timeout | null = null;
  /** 기다림을 건 끊김의 닫힘 코드. 4014 면 쫓겨났거나 옮겨진 것 */
  waitCloseCode: number | null = null;
  waitAt: number | null = null; // 끊겨 기다리기 시작한 때
  readyAt: number | null = null; // 연결이 마지막으로 Ready 가 된 때
  /** 지금 음성 서버 연결이 닫힌 코드(새 연결이면 비운다). 스테이지에서 빠진 까닭을 가른다 */
  lastCloseCode: number | null = null;
  closeWaiters: Array<(code: number | null) => void> = [];
  recoveryAttempts = 0;
  // 이번 복구의 마지막 시도가 실패한 원인. 포기 줄이 싣는다(회차별 실패는 debug)
  lastRecoveryError: string | null = null;
  /** 사람이 서버 헤드셋 끄기를 풀었다. 다투지 않게 이 연결(복구, 옮겨짐 포함) 동안은 다시 걸지 않는다. 채널에 새로 들어오면 다시 건다 */
  undeafened = false;
  // 기다리는 시간. 테스트가 줄인다
  waitStartMs = 5000; // 끊긴 뒤 라이브러리가 재연결을 시작하기까지(Signalling, Connecting)
  waitReadyMs = 20_000; // 재연결을 시작한 뒤 Ready 까지
  recoveryRetryDelayMs = 3000; // 복구 시도 사이
  closeWaitMs = 1500; // 스테이지에서 빠진 뒤 닫힘 코드를 기다리는 시간
  attemptSpanMs = RECOVER_READY_MS + 3000; // 복구 시도 하나가 쓰는 시간의 하한(곧바로 실패해도 이만큼 뒤에 다음 시도)
  lastMove: { from: string; to: string; at: number } | null = null;
  lastBounceFix: number | null = null;
  /** 라이브러리가 고치지 않고 내보낸 마지막 참가 요청(어댑터가 알린다). 되돌림을 사람의 이동과 구분한다 */
  lastPlainJoin: { channelId: string; at: number } | null = null;
  /** 답 없는 참가를 풀려고 스스로 나간 채널. 그 빠짐 알림은 쫓겨난 것이 아니다 */
  selfLeave: string | null = null;
  /** 발언자가 되려고 이미 손쓴 스테이지. 들어올 때마다 한 번만(붙은 뒤 맞추기와 들어옴 알림이 겹친다) */
  stageTaken: string | null = null;
  /** 발언 요청을 이미 알린 스테이지. 끊겼다 재연결해 다시 요청해도 채널에 되풀이해 알리지 않는다 */
  stageNoticed: string | null = null;
  stuckTimer: NodeJS.Timeout | null = null;
  /** 이번 복구에서 디스코드에 닿는데도 받아 둔 음성 서버 정보로 재연결하지 못했다(정보가 낡음). 남은 시도는 새로 참가한다 */
  reattachRefused = false;

  constructor(player: VoiceHost, lib: VoiceLib = VOICE_LIB) {
    this.player = player;
    this.lib = lib;
  }

  get isRecovering() {
    return this.state === "recovering";
  }

  /** 붙어 있거나 붙는 중이다(기다림, 복구 포함). `/join` 이 "이미 접속"으로 볼지 이것으로 정한다 */
  isAlive() {
    return LIVE.has(this.state);
  }

  _label() {
    return `"${channelName(this.player)}" (${guildName(this.player)})`;
  }

  // ── 붙기 ──

  /** 음성 채널에 붙는다. 못 붙으면 던진다(부른 쪽이 처리). 종료 중이면 붙지 않고 bot-shutting-down 예외를 던진다 */
  async connect() {
    if (isShuttingDown()) throw codedError("bot-shutting-down", "종료 중이라 음성 채널에 연결하지 않음");
    this.state = "joining";
    try {
      await this._join(JOIN_READY_MS);
      this.state = "ready";
      log.info(`음성 채널 참가: ${this._label()}`);
      this._settled();
      return true;
    } catch (error) {
      this._drop({ leave: true });
      this.state = "idle";
      log.error("음성 채널 연결 실패:", messageOf(error));
      throw codedError("voice-failed", "음성 채널에 연결하지 못함", { cause: error });
    }
  }

  // 새 연결을 만들어 상태 변화 이벤트를 걸고 오디오 플레이어를 구독한 뒤, 준비될 때까지 기다린다. 모든 새 음성 연결이 여기를 지난다.
  // 종료 중에는 부르지 않는다(connect 와 복구 루프가 바로 앞에서 확인한다)
  async _join(readyMs: number) {
    const player = this.player;
    const channelId = player.voiceChannel?.id;
    if (!channelId) throw new Error("음성 채널 없음");
    // debug: 라이브러리의 진행 줄(음성 서버, 네트워킹)을 받는다(_watch). 켜면 라이브러리가 웹소켓 메시지마다 문자열을 만들어 trace 를 남길 때만
    const connection = this.lib.joinVoiceChannel({ channelId, guildId: player.guild.id, adapterCreator: this._adapterCreator(), debug: log.level === "trace" });
    player.connection = connection;
    this._watch(connection);
    connection.subscribe(player.audioPlayer);
    this._armUnstick(connection, channelId, 0);
    try {
      await this.lib.entersState(connection, VoiceConnectionStatus.Ready, readyMs);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error(`${readyMs / 1000}초 안에 음성 채널에 연결하지 못함`, { cause: error });
      throw error;
    } finally {
      this._clearUnstick();
      // 나감 알림은 참가의 답(Ready)보다 먼저 온다. 끝났으면 기다릴 것이 없다
      this.selfLeave = null;
    }
  }

  _armUnstick(connection: VoiceConnection, channelId: string, tries: number) {
    this._clearUnstick();
    this.stuckTimer = setTimeout(() => {
      this._unstick(connection, channelId, tries).catch((error: unknown) => log.warn(`응답 없는 음성 채널 참가 요청 정리 실패: ${messageOf(error)}`));
    }, STUCK_MS);
  }

  _clearUnstick() {
    if (this.stuckTimer) clearTimeout(this.stuckTimer);
    this.stuckTimer = null;
  }

  // 참가 요청에 답이 없다. 끊긴 동안 보낸 요청이 사라졌거나, 디스코드가 봇이 이미 그 채널에 있다고 보아(나가기 요청이 닿지 못한 채 남음)
  // 같은 채널 참가에 답하지 않는 것이다. 디스코드에 물어(캐시는 끊긴 동안 낡는다) 묻지 못하면 기다리고, 처음에는 참가를 다시 보낸다.
  // 다시 보내도 답이 없고 봇이 그 채널에 있으면 게이트웨이로 나갔다가 다시 참가한다(REST 로 빼기는 멤버 옮기기 권한이 든다)
  async _unstick(connection: VoiceConnection, channelId: string, tries: number) {
    if (!this._stillSignalling(connection)) return;
    const at = await this._botChannelAtDiscord("unstick", "대기");
    // 묻는 사이에 붙었거나 연결이 바뀌었으면 할 일이 없다
    const state = connection.state;
    if (connection !== this.player.connection || state.status !== VoiceConnectionStatus.Signalling) return;
    if (at === undefined) return this._armUnstick(connection, channelId, tries);
    if (tries === 0 || at !== channelId) {
      const line = `음성 채널 참가 요청에 응답이 없어 재전송: ${this._label()}`;
      if (tries === 0) log.warn(line);
      else log.debug(line);
      connection.rejoin();
      return this._armUnstick(connection, channelId, tries + 1);
    }
    const { selfDeaf, selfMute } = connection.joinConfig;
    this.selfLeave = channelId;
    if (!state.adapter.sendPayload(leavePayload(this.player.guild.id, { selfDeaf, selfMute }))) {
      this.selfLeave = null;
      return this._armUnstick(connection, channelId, tries);
    }
    log.warn(`채널에 남아 있던 이전 연결을 끊고 다시 참가: ${this._label()} | 참가 요청 응답 없음(디스코드상에는 채널에 남아 있음)`);
    connection.rejoin();
  }

  _stillSignalling(connection: VoiceConnection) {
    return connection === this.player.connection && connection.state.status === VoiceConnectionStatus.Signalling;
  }

  // 디스코드가 보는 봇의 음성 채널(REST). 채널에 없으면 null, 묻지 못하면 undefined
  _botChannelAtDiscord(caller: string, fallback: string): Promise<string | null | undefined> {
    return botChannelAtDiscord(this.player.guild, caller, fallback);
  }

  // 옮겨질 때 옛 채널로 다시 참가하지 않게 참가 요청을 잠깐 붙잡는 어댑터(infra/voice-adapter)
  _adapterCreator() {
    const player = this.player;
    return holdingAdapterCreator(player.guild.voiceAdapterCreator, {
      onRewrite: (from: string, to: string) => log.info(`음성 재참가 요청 대상을 이동된 채널로 변경: ${from} → ${to} (${guildName(player)})`),
      onSend: (channelId: string, rewritten: boolean) => {
        if (!rewritten) this.lastPlainJoin = { channelId, at: Date.now() };
      },
    });
  }

  // 연결의 전이, 오류를 듣는다. 옛 연결은 부수기 전에 리스너를 떼므로(_detach) 여기로 오는 것은 지금 연결의 소식이다
  // 연결은 라이브러리가 쏜다. 이 서버의 문맥에 묶어 새어 나온 오류가 이 서버로 돌아오게 한다(infra/guild-context)
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
    // 음성 웹소켓 메시지, 상태 바뀜마다 나오는 양이라 trace. 실린 토큰, 암호 키는 로그 sink 가 가린다
    connection.on("debug", (message: string) => log.trace(`${message} | ${this._label()}`));
  }

  _onStateChange(oldState: VoiceConnectionState, newState: VoiceConnectionState) {
    if (this.state === "closed") return;
    this._watchNetworking(oldState, newState);
    if (oldState.status !== newState.status) log.debug(`연결 상태: ${oldState.status} → ${newState.status} | ${this._label()}`);
    if (newState.status === VoiceConnectionStatus.Ready) this.readyAt = Date.now();
    if (newState.status === VoiceConnectionStatus.Ready && this.state === "waiting") {
      this._clearWait();
      this.state = "ready";
      log.info({ tags: ["recovered"] }, `자동 재연결 성공: ${this._label()}`);
      this._settled();
      return;
    }
    // 옮겨질 때처럼 우리 상태는 그대로인 채 라이브러리가 새 음성 서버에 다시 붙었다
    if (newState.status === VoiceConnectionStatus.Ready && oldState.status !== VoiceConnectionStatus.Ready && this.state === "ready") {
      this._settled();
      return;
    }
    if (newState.status === VoiceConnectionStatus.Disconnected && this.state === "ready") {
      if (newState.reason === VoiceConnectionDisconnectReason.Manual) return;
      this._wait(newState.reason, "closeCode" in newState ? newState.closeCode : undefined);
      return;
    }
    if (newState.status === VoiceConnectionStatus.Destroyed) this.recover("연결이 부서짐");
  }

  // 음성 서버 연결의 닫힘 코드. 4014 가 아니면 라이브러리가 끊김 없이 스스로 다시 참가해(Ready → Signalling) 전이에는 까닭이 없다.
  // 연결이 다시 참가하기 전에 찍도록 앞에 건다
  _watchNetworking(oldState: VoiceConnectionState, newState: VoiceConnectionState) {
    const networking = "networking" in newState ? newState.networking : null;
    if (!networking || ("networking" in oldState && oldState.networking === networking)) return;
    this.lastCloseCode = null;
    networking.prependOnceListener("close", (code: number) => {
      const line = `음성 서버 연결 닫힘: 코드 ${code} | ${this._label()}`;
      if (code !== DO_NOT_RECONNECT && code !== CALL_TERMINATED && this.state === "ready" && this.player.connection?.state.status === VoiceConnectionStatus.Ready) log.warn(line);
      else log.debug(line);
      this.lastCloseCode = code;
      for (const done of this.closeWaiters.splice(0)) done(code);
      this._noRejoin(networking, code);
      this._capRejoins(networking, code);
    });
  }

  // 봇이 이미 채널에서 빠졌다(스테이지 종료 등). 라이브러리는 4014 가 아닌 닫힘이면 같은 채널로 다시 참가하므로(잠깐 청중으로 들어갔다 나온다)
  // 이 리스너가 먼저 도는 동안 나가기 요청 없이 부순다. 봇은 디스코드가 이미 채널에서 뺐다
  _noRejoin(networking: object, code: number) {
    const connection = this.player.connection;
    if (this.state !== "closed" || code === DO_NOT_RECONNECT || !connection) return;
    if (!("networking" in connection.state) || connection.state.networking !== networking) return;
    connection.destroy(false);
  }

  // 라이브러리는 4014 가 아닌 닫힘마다 쉬지 않고 같은 채널로 다시 참가한다(다시 붙지 말라는 4021 요청 제한에도). 이 리스너가 라이브러리보다 먼저 돌 때 부순다.
  // 상태 리스너 안에서 부수면 라이브러리가 바꾼 상태의 어댑터를 읽다 던진다. 부서짐은 _onStateChange 가 복구로 넘기고, 복구 중이면 다음 시도가 새로 참가한다
  _capRejoins(networking: object, code: number) {
    const connection = this.player.connection;
    if (this.state === "closed" || this.state === "idle" || code === DO_NOT_RECONNECT || !connection) return;
    if (!("networking" in connection.state) || connection.state.networking !== networking) return;
    if (connection.rejoinAttempts < MAX_LIB_REJOINS) return;
    log.warn(`음성 서버 연결이 Ready 전에 ${connection.rejoinAttempts}회 닫혀(마지막 코드 ${code}) 라이브러리 자동 재연결을 중단하고 직접 재연결: ${this._label()}`);
    connection.destroy(false);
  }

  _onError(error: Error) {
    if (this.state === "closed") return;
    // 네트워크가 끊긴 것은 복구 시작 줄이 까닭과 함께 남긴다
    if (errorKind(error) === "network-error") {
      this.recover(`네트워크 오류(${messageOf(error)})`);
      return;
    }
    log.warn(`음성 연결 오류: ${this._label()} | 상태=${this.state} | 분류=${errorKind(error)} | ${describeError(error)}`);
    this.recover("연결 오류");
  }

  // ── 끊김: 라이브러리가 스스로 재연결하기를 기다린다 ──

  _wait(reason: VoiceConnectionDisconnectReason, closeCode: number | undefined) {
    this.state = "waiting";
    this.waitCloseCode = closeCode ?? null;
    this.waitAt = Date.now();
    const gen = ++this.gen;
    const line = `연결 끊김: ${this._label()} | 원인=${reason}${closeCode ? `(${closeCode})` : ""} | 자동 재연결 대기`;
    // 4014 는 내보냄, 옮겨짐, 봇의 게이트웨이 끊김 중 하나다. 어느 쪽인지는 뒤따르는 줄(떠남, 이동, 복구)이 남긴다
    if (closeCode === DO_NOT_RECONNECT) log.debug(line);
    else log.warn(line);
    this._clearWait();
    this.waitTimer = setTimeout(() => {
      if (gen !== this.gen || this.state !== "waiting") return;
      const status = this.player.connection?.state.status;
      // 재연결을 시작했으면 Ready 까지 조금 더 기다린다
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

  // 기다려도 재연결되지 않았다. 봇이 채널에 없으면(퇴장 알림이 아직 안 옴) 빠진 것으로, 있으면 우리가 재연결한다
  _afterWait() {
    const inChannel = this.player.guild.members?.me?.voice?.channelId;
    if (inChannel === null) {
      if (this._renewedSession()) return;
      this._leftChannel(this.player.voiceChannel?.id ?? null);
      return;
    }
    log.warn(`자동 재연결 실패(직접 재연결): ${this._label()}`);
    this.recover("자동 재연결 안 됨");
  }

  // ── 복구: 우리가 재연결한다 ──

  /** 연결을 재연결한다. 붙어 있거나 끊겨 기다리는 중일 때만 받는다(이미 복구 중, 끝남, 붙는 중이면 아무것도 안 한다) */
  recover(why: string) {
    // 붙는 중에 부서지면 connect() 가 실패를 받는다
    if (this.state !== "ready" && this.state !== "waiting") return;
    this._clearWait();
    this.state = "recovering";
    this.recoveryAttempts = 0;
    this.lastRecoveryError = null;
    this.reattachRefused = false;
    const gen = ++this.gen;
    log.warn(`연결 복구 시작: ${this._label()} | 원인=${why} | 최대 ${RECOVERY_ATTEMPTS_MAX}회`);
    this._recoverLoop(gen).catch((error: unknown) => log.error("연결 복구 루프 오류:", error));
  }

  // 시도 → 기다림 → 쉼을 차례로 되풀이한다. 세대가 바뀌면(정리, 새 복구) 늦게 돌아온 결과로 아무것도 하지 않는다
  async _recoverLoop(gen: number) {
    // 종료가 시작되면 복구를 멈춘다(새 연결을 만들지 않는다. 남은 연결은 종료가 정리한다)
    const active = () => gen === this.gen && this.state === "recovering" && !isShuttingDown();
    while (active()) {
      this.recoveryAttempts++;
      if (this.recoveryAttempts > RECOVERY_ATTEMPTS_MAX) return this._giveUp();
      if (!this._liveChannel()) return this.channelGone();
      const started = Date.now();
      const joined = await this._rejoin(active);
      if (!active()) return;
      if (joined) {
        this.state = "ready";
        log.info({ tags: ["recovered"] }, `연결 복구 완료: ${this._label()} | 시도 ${this.recoveryAttempts}회`);
        this._settled();
        await this.player.onVoiceRecovered();
        return;
      }
      // 곧바로 실패한 시도(네트워크가 끊겨 있다)도 한 시도만큼의 시간은 쓴다. 끊긴 동안 시도를 다 써 버리지 않게
      const rest = Math.max(this.recoveryRetryDelayMs, this.attemptSpanMs - (Date.now() - started));
      await new Promise((resolve) => setTimeout(resolve, rest));
    }
  }

  // 한 번 재연결해 본다. 됐으면 true. 채널에서는 나가지 않는다.
  // 디스코드가 봇을 이 채널에 있다고 보는 동안은 같은 채널 참가에 답하지 않으므로, 연결이 받아 둔 음성 서버 정보로 음성 서버에 재연결한다.
  // 디스코드가 봇을 채널에서 뺐으면(게이트웨이가 끊겼던 것) 그 정보는 쓸 수 없어 옛 연결을 버리고 새로 참가한다.
  // 디스코드와 통신이 되는데도 재연결이 실패했으면 그 정보가 만료된 것이라 다음부터 새로 참가한다(답이 없으면 _unstick이 푼다).
  // 디스코드에 조회하는 사이 정리됐으면(active가 false) 아무것도 하지 않는다. 그 뒤에 만든 연결은 정리할 곳이 없다
  async _rejoin(active: () => boolean) {
    const connection = this.player.connection;
    const at = connection && connection.state.status !== VoiceConnectionStatus.Destroyed ? await this._botChannelAtDiscord("rejoin", "재연결") : null;
    if (!active()) return false;
    try {
      if (connection && this._mayReattach(at) && this._reattach(connection)) {
        log.debug(`연결 복구 ${this.recoveryAttempts}회차: 캐시된 음성 서버 정보로 재연결: ${this._label()}`);
        try {
          await this.lib.entersState(connection, VoiceConnectionStatus.Ready, RECOVER_READY_MS);
        } catch (error) {
          // 제한 시간 안에 답이 없었다. 곧바로 난 실패(네트워크가 아직 불안정)는 정보가 낡은 것이 아니다
          if (at !== undefined && error instanceof Error && error.name === "AbortError") this.reattachRefused = true;
          throw error;
        }
      } else {
        log.debug(`연결 복구 ${this.recoveryAttempts}회차: 새로 참가: ${this._label()}`);
        this._drop({ leave: false });
        await this._join(RECOVER_READY_MS);
      }
      return true;
    } catch (error) {
      // 중간 시도의 실패. 다음 시도가 받고, 끝내 못 붙으면 포기 줄이 남긴다
      log.debug(`연결 복구 ${this.recoveryAttempts}회차 실패: ${messageOf(error)}`);
      this.lastRecoveryError = messageOf(error);
      return false;
    }
  }

  // 캐시된 음성 서버 정보로 재연결해도 되는지 확인한다. 디스코드가 봇을 이 채널에 있다고 보거나 조회하지 못했고(at이 undefined), 이번 복구에서 그 정보가 만료됐다고 보지 않았다
  _mayReattach(at: string | null | undefined) {
    return !this.reattachRefused && (at === undefined || at === this.player.voiceChannel?.id);
  }

  // 받아 둔 음성 서버 정보로 음성 서버에 재연결을 시작한다. 시작했으면 true(정보가 없거나 부서진 연결이면 라이브러리가 아무것도 하지 않는다)
  _reattach(connection: VoiceConnection) {
    connection.configureNetworking();
    return connection.state.status === VoiceConnectionStatus.Connecting;
  }

  // 서버에 아직 있는 음성 채널. 삭제됐으면 없다
  _liveChannel() {
    const channelId = this.player.voiceChannel?.id;
    return channelId ? this.player.guild.channels.cache.get(channelId) : null;
  }

  // 4014 로 끊겨 봇이 채널에서 빠졌는데 그 앞뒤에 봇의 게이트웨이가 새 세션을 받았다. 내보낸 것이 아니라 디스코드가 음성 상태를 지운 것이라 다시 참가한다.
  // 아래쪽 경계(연결이 마지막으로 Ready 된 때)는 기동, 재연결 직후 사람이 내보낸 것을 복구로 보지 않게
  _renewedSession() {
    if (this.state !== "waiting" || this.waitCloseCode !== DO_NOT_RECONNECT || this.waitAt === null) return false;
    const shardId = this.player.guild.shardId;
    const renewed = typeof shardId === "number" ? this.lib.newSessionAt?.(shardId) : null;
    if (!renewed || renewed < Math.max(this.waitAt - RENEWED_WINDOW_MS, this.readyAt ?? 0)) return false;
    log.warn(`게이트웨이 세션 초기화로 음성 채널에 다시 참가(강제 퇴장 아님): ${this._label()}`);
    this.recover("게이트웨이 새 세션");
    return true;
  }

  // 재연결하지 못했다. 세션을 저장하고 버린다. /join 이 저장된 세션으로 이어서 튼다
  _giveUp() {
    log.error(`연결 복구 포기: ${this._label()} | 최대 ${RECOVERY_ATTEMPTS_MAX}회 넘음(세션을 저장하고 정리)${this.lastRecoveryError ? ` | 마지막 오류=${this.lastRecoveryError}` : ""}`);
    this._end({ reason: "음성 연결 복구 포기", session: "save", panel: "disconnected", end: "voice-lost" });
  }

  // ── 게이트웨이: 봇 자신의 음성 상태 ──

  /** 게이트웨이가 알린 봇의 음성 상태. 빠짐(강제 퇴장, 채널 사라짐), 옮겨짐, 서버 음소거를 구분한다 */
  onBotState(oldState: Pick<VoiceState, "channelId"> & Partial<Pick<VoiceState, "serverDeaf">>, newState: Pick<VoiceState, "channelId" | "suppress" | "channel"> & Partial<Pick<VoiceState, "serverDeaf">>): BotStateChange {
    if (oldState.channelId && !newState.channelId) {
      this.stageTaken = null; // 다시 들어오면 다시 발언자가 된다
      // 답 없는 참가를 풀려고 스스로 나갔다. 다시 참가가 뒤따른다
      if (this.selfLeave === oldState.channelId) {
        this.selfLeave = null;
        log.debug(`봇이 직접 끊은 연결의 퇴장 이벤트라 재참가 대기: ${this._label()}`);
        return { left: false, moved: false };
      }
      // 재연결하는 중이면 쫓겨난 것이 아니다. 봇의 게이트웨이가 끊기면 디스코드가 음성 상태를 지운다. 복구가 다시 참가한다
      // 4014("재연결하지 말 것")로 끊겨 기다리는 중이면 쫓겨난 것이다(게이트웨이 새 세션은 _renewedSession 이 가른다). 음성 서버의 닫힘이 게이트웨이의 빠짐 알림보다 먼저 올 때가 있다
      if (this.state === "recovering" || (this.state === "waiting" && this.waitCloseCode !== DO_NOT_RECONNECT)) {
        log.info(`디스코드에서 음성 채널 연결이 해제됐으나 재연결 중이라 강제 퇴장으로 처리하지 않음: ${this._label()}`);
        this.recover("음성 상태가 지워짐");
        return { left: false, moved: false };
      }
      if (this._renewedSession()) return { left: false, moved: false };
      this._leftChannel(oldState.channelId);
      return { left: true, moved: false };
    }
    this._undeafened(oldState, newState);
    let moved = false;
    let bounced = false;
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId && newState.channel) {
      bounced = this.followMove(oldState.channelId, newState.channel);
      moved = true;
    }
    // 되돌려 붙는 중이면 그 채널은 곧 떠난다
    if (newState.channelId !== oldState.channelId && !bounced) this._entered(newState);
    return { left: false, moved };
  }

  // 채널에 들어왔다(부름, 옮겨짐, 재연결). 스테이지에 청중으로 들어왔으면 발언자가 되려 한다. 들어올 때만: 모더레이터가 청중으로 내린 것은 따른다.
  // 음성 서버 연결이 붙기 전에 발언자가 되면 소리를 보내도 들리지 않는다. 그때는 붙은 뒤(_settled)에 한다
  _entered(now: Pick<VoiceState, "channelId" | "suppress" | "channel">) {
    if (this.stageTaken !== now.channelId) this.stageTaken = null;
    if (now.suppress && now.channel && this._linked()) this._enterStage(now.channel);
  }

  _linked() {
    return this.state === "ready" && this.player.connection?.state.status === VoiceConnectionStatus.Ready;
  }

  // 붙었다(참가, 자동 재연결, 복구, 옮겨진 채널). 이미 음소거, 청중인 채로 붙으면 바뀜 알림이 오지 않으므로 지금 상태로 맞추고,
  // 스테이지 청중이면 발언자가 되려 한다. 게이트웨이를 다시 붙어도 캐시는 새로 차지만 voiceStateUpdate 는 오지 않는다
  _settled() {
    this.player.syncHolds();
    const now = this.player.guild.members.me?.voice;
    if (now?.channelId && now.suppress && now.channel) this._enterStage(now.channel);
    this._deafen();
  }

  // 권한이 있고 봇이 플레이어의 채널에 붙어 있으며 아직 걸리지 않았을 때만
  _deafen() {
    const me = this.player.guild.members.me;
    const voice = me?.voice;
    if (this.undeafened || !me || !voice?.channel) return;
    if (voice.serverDeaf !== false || voice.channelId !== this.player.voiceChannel?.id || typeof voice.setDeaf !== "function") return;
    if (!voice.channel.permissionsFor?.(me)?.has(PermissionFlagsBits.DeafenMembers)) return;
    voice.setDeaf(true, DEAFEN_REASON).then(
      () => log.debug(`서버 헤드셋 끄기: ${this._label()}`),
      (error: unknown) => {
        if (codeOf(error) !== NOT_IN_VOICE) log.warn(`서버 헤드셋 끄기 실패: ${this._label()} | ${messageOf(error)}`);
      },
    );
  }

  // 같은 채널에서 서버 헤드셋 끄기가 풀렸다. 봇은 풀지 않으므로 사람이 푼 것이다
  _undeafened(oldState: Partial<Pick<VoiceState, "channelId" | "serverDeaf">>, newState: Partial<Pick<VoiceState, "channelId" | "serverDeaf">>) {
    if (!oldState.channelId || oldState.channelId !== newState.channelId || oldState.serverDeaf !== true || newState.serverDeaf !== false) return;
    if (this.undeafened) return;
    this.undeafened = true;
    log.info(`서버 헤드셋 끄기 수동 해제(이번 참가 중 다시 적용 안 함): ${this._label()}`);
  }

  _enterStage(channel: VoiceBasedChannel) {
    if (channel.type !== ChannelType.GuildStageVoice || this.stageTaken === channel.id) return;
    this.stageTaken = channel.id;
    void this._takeStage(channel);
  }

  /**
   * 스테이지에서는 발언자여야 들린다. 멤버 음소거 권한이 있으면 스스로 발언자가 되고, 없으면 발언을 요청한다.
   * 모더레이터가 받아 주면 suppress 가 풀려 이어 튼다(player.syncHolds). 둘 다 안 되면 알린다
   */
  async _takeStage(channel: VoiceBasedChannel) {
    const me = this.player.guild.members.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    try {
      if (me && permissions?.has(PermissionFlagsBits.MuteMembers)) {
        await me.voice.setSuppressed(false);
        log.info(`스테이지 발언자가 됨: ${this._label()}`);
      } else if (me && permissions?.has(PermissionFlagsBits.RequestToSpeak)) {
        await me.voice.setRequestToSpeak(true);
        log.info(`스테이지 발언 요청(모더레이터의 수락 대기): ${this._label()}`);
        if (this.stageNoticed !== channel.id) this.player.noticeStage("stage-requested");
        this.stageNoticed = channel.id;
      } else {
        log.warn(`스테이지에서 발언자가 될 수도 발언권을 요청할 수도 없음(멤버 음소거 및 발언권 요청 권한 없음): ${this._label()}`);
        this.player.noticeStage("stage-cannot-speak");
      }
    } catch (error) {
      log.warn(`스테이지 발언자 되기 실패: ${this._label()} | ${describeError(error)}`);
    }
  }

  // 봇이 채널에서 빠졌다. 채널이 없으면 채널 사라짐, 있으면 강제 퇴장. 빠짐 알림이 채널 삭제 알림보다 먼저 올 수 있어 캐시가 아니라 디스코드에 묻는다
  _leftChannel(channelId: string | null) {
    if (this.state === "closed") return;
    this.stop();
    this.state = "closed";
    const closed = this._closeCode();
    this._channelExists(channelId)
      .then(async (exists) => this.player.dispose(exists ? this._outOf(await closed) : CHANNEL_GONE))
      .catch((error: unknown) => log.error("음성 채널 퇴장 후 정리 실패:", error));
  }

  // 채널이 아직 있나. 캐시에 없으면 없다. 있으면 디스코드에 물어 없다는 답(10003)일 때만 없다(묻지 못하면 있다고 본다)
  async _channelExists(channelId: string | null) {
    if (!channelId) return true;
    const channels = this.player.guild.channels;
    if (!channels.cache.has(channelId)) return false;
    try {
      return Boolean(await channels.fetch(channelId, { force: true }));
    } catch (error) {
      if (codeOf(error) === UNKNOWN_CHANNEL) return false;
      // 접근 권한 없음(50001)은 채널이 봇에게 숨겨진 것이라 있는 것으로 본다
      if (codeOf(error) === RESTJSONErrorCodes.MissingAccess) log.debug(`디스코드에서 채널 조회 실패(채널이 있는 것으로 간주): ${describeError(error)}`);
      else log.warn(`음성 채널에서 나간 뒤 채널 REST 조회 실패(강제 퇴장으로 간주): ${this._label()} | ${describeError(error)}`);
      return true;
    }
  }

  /** 봇이 음성에서 쫓겨났다. 세션을 삭제하고 끝난 패널로 버린다 */
  forcedOut() {
    this._end(FORCED_OUT);
  }

  // 채널이 남아 있는데 빠졌다. 스테이지면 닫힘 코드로 끝남, 쫓겨남을 가른다
  _outOf(code: number | null) {
    if (this.player.voiceChannel?.type !== ChannelType.GuildStageVoice) return FORCED_OUT;
    if (code === CALL_TERMINATED) return STAGE_ENDED;
    if (code === DO_NOT_RECONNECT) return FORCED_OUT;
    return STAGE_OUT;
  }

  // 빠진 때의 닫힘 코드. 스테이지에서 아직 닫히지 않았으면 닫히기를 기다린다(시간 안에 닫히지 않으면 null)
  _closeCode() {
    if (this.lastCloseCode !== null || this.player.voiceChannel?.type !== ChannelType.GuildStageVoice) return Promise.resolve(this.lastCloseCode);
    return new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        this.closeWaiters = this.closeWaiters.filter((one) => one !== done);
        resolve(null);
      }, this.closeWaitMs);
      const done = (code: number | null) => {
        clearTimeout(timer);
        resolve(code);
      };
      this.closeWaiters.push(done);
    });
  }

  /** 봇의 음성 채널이 사라졌다. 세션을 삭제하고 버린다 */
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
   * 재연결하지 않고 기록만 맞춘다. 이벤트마다 재연결하면 그 재연결이 또 이벤트를 만들어 채널 사이를 오간다.
   *
   * 다만 라이브러리에 경쟁이 있다. 옮겨지는 순간 음성 서버 연결이 상태 패킷보다 먼저 닫히면 옛 설정으로
   * 다시 참가해 원래 채널로 되돌아간다(@discordjs/voice onNetworkingClose). 대개는 어댑터가 그 요청을 붙잡아 고쳐 보내지만
   * 늦으면 고치지 않은 채 나간다. 방금 옮겨진 곳에서 곧바로 원래 채널로 돌아왔고, 그 직전에 라이브러리가 그 채널로 고치지 않은
   * 참가 요청을 보냈으면 되돌림으로 보고 목적지로 한 번 재연결한다. 사람이 빠르게 되돌린 이동에는 그런 요청이 없다.
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
      log.warn(`음성 채널 이동 직후 원래 채널로 되돌려져 대상 채널로 다시 이동: "${target.name ?? target.id}" (${where})`);
      const connection = player.connection;
      if (connection) connection.rejoin({ channelId: target.id, selfDeaf: connection.joinConfig.selfDeaf, selfMute: connection.joinConfig.selfMute });
      return true;
    }
    this.lastMove = { from: fromId, to: toChannel.id, at: now };
    player.voiceChannel = toChannel;
    log.info(`음성 채널 이동: "${toChannel.name ?? toChannel.id}" (${where})`);
    player.movedVoiceStatus(fromId);
    return false;
  }

  // 방금 옮겨진 곳에서 곧바로 원래 채널로 되돌아왔으면 재연결할 목적지. 아니면(또는 막 되돌려 붙었으면) null
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

  /** 기다림, 복구를 멈춘다(플레이어를 버릴 때). 늦게 돌아온 결과는 버린다 */
  stop() {
    this.gen++;
    this._clearWait();
    this._clearUnstick();
  }

  // 지금 연결을 떼어 비우고 돌려준다. 리스너를 먼저 떼어 부서지는 연결이 전이를 알리지 않게 한다
  _detach() {
    const connection = this.player.connection;
    this.player.connection = null;
    connection?.removeAllListeners();
    return connection;
  }

  // 지금 연결을 떼어 부순다. 붙기에 실패했으면 나가기 요청을 보내고, 재연결 전이면 보내지 않는다(보내면 디스코드가 봇을 채널에서 뺀다)
  _drop({ leave }: { leave: boolean }) {
    const connection = this._detach();
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) return;
    const status = connection.state.status;
    try {
      connection.destroy(leave);
    } catch (error) {
      // 새 연결로 진행
      log.warn(`기존 음성 연결 정리 실패(새 연결 진행): ${this._label()} | 이전 상태=${status}, 나가기 요청=${leave} | ${messageOf(error)}`);
    }
  }

  /** 나가기 요청을 보내지 않고 이 쪽 연결만 정리한다. 채널에서 빠지는 것은 게이트웨이 세션에 따른다: 정상 종료는 연결을 닫자마자, 프로세스가 죽으면 세션이 끝날 때 디스코드가 뺀다 */
  release(reason: string) {
    this.stop();
    this.state = "closed";
    const connection = this._detach();
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) return;
    try {
      connection.destroy(false);
      log.info(`음성 연결 정리: ${this._label()} | 원인=${reason}`);
    } catch (error) {
      log.error("음성 연결 정리 실패:", error);
    }
  }

  /** 연결을 부수고 채널에서 나간다. 로그 없이 나가면 왜 나갔는지 나중에 알 수 없으므로 원인을 남긴다 */
  disconnect(reason = "정리") {
    this.stop();
    this.state = "closed";
    const connection = this._detach();
    if (!connection) return;
    try {
      // 이미 부순 연결(채널에서 빠진 뒤 다시 참가하지 않게 부숨)이면 채널에서도 이미 빠졌다
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      log.info(`음성 채널 떠남: ${this._label()} | 원인=${reason}`);
    } catch (error) {
      log.error("음성 연결 종료 실패:", error);
    }
  }
}

export { VoiceLink };
export type { VoiceHost, VoiceLib, LinkState, BotStateChange };
