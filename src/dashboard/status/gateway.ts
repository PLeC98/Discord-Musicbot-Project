// 디스코드 게이트웨이 연결: 끊김, 재연결, 재연결하지 않음을 로그로 남기고, 봇이 켜진 뒤 재연결한 횟수와 지금 몇 번째 시도인지를 센다.
// discord.js는 연결이 닫힐 때마다 shardReconnecting을, 재연결되면 shardResume(세션 재개), shardReady(새 세션)를,
// 재연결해도 같은 닫힘 코드면(토큰, 인텐트) shardDisconnect를 낸다. 연결 오류는 shardError로 온다.
// 이유와 오류는 모아 두었다가 끊김 하나에 줄 하나(정상 절차면 재연결될 때 info 한 줄, 아니면 끊길 때 warn, 재연결될 때 info)로 남긴다

import { Events, GatewayCloseCodes, type Client } from "discord.js";
import logger from "../../infra/log/logger.ts";
import { messageOf } from "../../rules/error-kind.ts";
import { L } from "../../infra/log/text.ts";
import { asText, type LogText } from "../../infra/log/log-text.ts";
const log = logger.child({ category: "discord" });

let reconnects = 0;
/** 지금 끊긴 뒤 시도 횟수. 연결돼 있으면 0 */
let attempt = 0;
/** 이번 끊김에서 연결을 닫은 이유(첫 번째). 연결될 때마다 비운다 */
let closedBy: { reason: string; code: number } | null = null;
/** 이번 끊김에서 난 연결 오류(첫 글과 횟수) */
let errors: { first: string; count: number } | null = null;
/** 이번 끊김을 warn으로 알렸나 */
let announced = false;
/** 봇이 연결을 직접 닫았나(끄는 중). 다시 시작도 프로세스를 새로 띄우므로 되돌리지 않는다 */
let destroyed = false;

// @discordjs/ws는 연결을 닫을 때마다 debug로 "Destroying shard / Reason / Code"를 낸다. 열린 소켓이면 그 뒤 shardReconnecting이,
// 디스코드가 닫았으면 shardReconnecting이 먼저 온다. 열리기 전에 닫았으면 shardReconnecting 없이 재연결한다
const DESTROYED = /Destroying shard\n\tReason: (.*)\n\tCode: (\d+)/;
const REASONS: Record<string, LogText> = {
  "Told to reconnect by Discord": L.discord.gatewayReasonReconnect(),
  "Zombie connection": L.discord.gatewayReasonZombie(),
  "Got disconnected by Discord": L.discord.gatewayReasonDisconnected(),
  "Invalid session": L.discord.gatewayReasonInvalidSession(),
};
// 디스코드가 정상 절차로 재연결하게 한 것(오류가 아니다)
const ROUTINE_REASONS = new Set(["Told to reconnect by Discord", "Got disconnected by Discord", "Invalid session"]);
// client.destroy()가 닫을 때의 이유. discord.js는 이때도 shardReconnecting을 내지만 재연결하지 않는다
const SELF_CLOSE = "Manager was destroyed";
const ROUTINE_CODES = new Set([1000, 1001]);

const routine = () => errors === null && closedBy !== null && (ROUTINE_REASONS.has(closedBy.reason) || (closedBy.reason === "none" && ROUTINE_CODES.has(closedBy.code)));

function causeText() {
  const parts: LogText[] = [];
  if (closedBy) parts.push(closedBy.reason === "none" ? L.discord.gatewayCloseCode({ code: closedBy.code }) : L.discord.gatewayCloseReason({ reason: REASONS[closedBy.reason] ?? closedBy.reason, code: closedBy.code }));
  if (errors) parts.push(L.discord.gatewayErrors({ count: errors.count, first: errors.first }));
  return parts.map(asText).join("; ") || L.discord.gatewayCauseUnknown();
}

// 끊김이 정상 절차가 아니면 끊길 때 알린다(오래 연결되지 못하면 그동안 아무 줄도 없게 되지 않게). 이유가 시도 알림보다 늦게 올 수 있어 둘 다에서 부른다
function announce(shardId: number) {
  if (destroyed || announced || !attempt || !closedBy || routine()) return;
  announced = true;
  log.warn(L.discord.gatewayDisconnected({ shardId, cause: causeText() }));
}

function onDebug(message: string, shardId: number) {
  const found = DESTROYED.exec(message);
  if (!found) return;
  if (found[1] === SELF_CLOSE) {
    destroyed = true;
    attempt = 0;
    return;
  }
  // 여러 번 시도한 끊김은 처음 이유를 남긴다
  if (!closedBy) closedBy = { reason: found[1], code: Number(found[2]) };
  announce(shardId);
}

function onError(error: Error, shardId: number) {
  errors = errors ? { ...errors, count: errors.count + 1 } : { first: messageOf(error), count: 1 };
  announce(shardId);
}

function onReconnecting(shardId: number) {
  if (destroyed) return;
  attempt += 1;
  log.debug(L.discord.gatewayReconnecting({ attempt }));
  announce(shardId);
}

function onConnected(how: LogText) {
  // 처음 연결된 것은 재연결이 아니다. 열리기 전에 닫힌 것(시도 알림 없음)도 남긴다
  if (attempt || errors || closedBy) {
    if (attempt) reconnects += 1;
    const line = L.discord.gatewayReconnected({ how, attempt, cause: causeText() });
    if (announced || routine()) log.info(line);
    else log.warn(line);
  }
  attempt = 0;
  closedBy = null;
  errors = null;
  announced = false;
}

function onDisconnect(code: number, shardId: number) {
  const name = (GatewayCloseCodes as Record<number, string | undefined>)[code];
  log.error(L.discord.gatewayClosed({ shardId, code, closeName: name ? ` ${name}` : "", firstError: errors ? ` · ${errors.first}` : "" }));
  attempt = 0;
  closedBy = null;
  errors = null;
  announced = false;
}

/** 게이트웨이 이벤트를 듣는다. 끊는 함수를 돌려준다 */
function watchGateway(client: Client) {
  const debug = (message: string) => {
    // "[WS => Shard 0] …"의 샤드 번호
    const shard = /^\[WS => Shard (\d+)\]/.exec(message);
    onDebug(message, shard ? Number(shard[1]) : 0);
  };
  const resumed = () => onConnected(L.discord.gatewaySessionResumed());
  const ready = () => onConnected(L.discord.gatewayNewSession());
  const disconnected = (event: { code: number }, shardId: number) => onDisconnect(event.code, shardId);
  client.on(Events.Debug, debug);
  client.on(Events.ShardError, onError);
  client.on(Events.ShardReconnecting, onReconnecting);
  client.on(Events.ShardResume, resumed);
  client.on(Events.ShardReady, ready);
  client.on(Events.ShardDisconnect, disconnected);
  return () => {
    client.off(Events.Debug, debug);
    client.off(Events.ShardError, onError);
    client.off(Events.ShardReconnecting, onReconnecting);
    client.off(Events.ShardResume, resumed);
    client.off(Events.ShardReady, ready);
    client.off(Events.ShardDisconnect, disconnected);
  };
}

/** reconnects: 재연결 횟수. retryAttempt: 끊겨 재연결하려는 중이면 몇 번째 시도, 연결돼 있으면 null */
const gateway = () => ({ reconnects, retryAttempt: attempt || null });

/** 테스트: 센 값을 비운다 */
function _reset() {
  reconnects = attempt = 0;
  closedBy = null;
  errors = null;
  announced = false;
  destroyed = false;
}

export { watchGateway, gateway, _reset };
