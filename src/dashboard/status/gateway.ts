// 디스코드 게이트웨이 연결: 끊김 · 다시 붙음 · 다시 붙지 않음을 로그로 남기고, 봇이 켜진 뒤 다시 붙은(재수립) 횟수와 지금 몇 번째 시도인지를 센다.
// discord.js 는 연결이 닫힐 때마다 shardReconnecting 을, 다시 붙으면 shardResume(이어 붙임) · shardReady(새로 붙음)를,
// 다시 붙어도 같은 닫힘 코드면(토큰 · 인텐트) shardDisconnect 를 낸다. 연결 오류는 shardError 로 온다.
// 까닭과 오류는 모아 두었다가 끊김 하나에 줄 하나(정상 절차면 다시 붙을 때 info 한 줄, 아니면 끊길 때 warn · 붙을 때 info)로 남긴다

import { Events, GatewayCloseCodes, type Client } from "discord.js";
import logger from "../../infra/log/logger.ts";
import { messageOf } from "../../rules/error-kind.ts";
const log = logger.child({ category: "discord" });

let reconnects = 0;
/** 지금 끊긴 뒤 시도 횟수. 붙어 있으면 0 */
let attempt = 0;
/** 이번 끊김에서 연결을 닫은 까닭(첫 번째). 붙을 때마다 비운다 */
let closedBy: { reason: string; code: number } | null = null;
/** 이번 끊김에서 난 연결 오류(첫 글과 횟수) */
let errors: { first: string; count: number } | null = null;
/** 이번 끊김을 warn 으로 알렸나 */
let announced = false;

// @discordjs/ws 는 연결을 닫을 때마다 debug 로 "Destroying shard / Reason / Code" 를 낸다. 열린 소켓이면 그 뒤 shardReconnecting 이,
// 디스코드가 닫았으면 shardReconnecting 이 먼저 온다. 열리기 전에 닫았으면 shardReconnecting 없이 다시 붙는다
const DESTROYED = /Destroying shard\n\tReason: (.*)\n\tCode: (\d+)/;
const REASONS: Record<string, string> = {
  "Told to reconnect by Discord": "디스코드가 다시 붙으라고 함(op 7)",
  "Zombie connection": "하트비트 응답 없음",
  "Got disconnected by Discord": "디스코드가 끊음",
  "Invalid session": "세션이 무효",
};
// 디스코드가 정상 절차로 다시 붙게 한 것(오류가 아니다)
const ROUTINE_REASONS = new Set(["Told to reconnect by Discord", "Got disconnected by Discord", "Invalid session"]);
const ROUTINE_CODES = new Set([1000, 1001]);

const routine = () => errors === null && closedBy !== null && (ROUTINE_REASONS.has(closedBy.reason) || (closedBy.reason === "none" && ROUTINE_CODES.has(closedBy.code)));

function causeText() {
  const parts: string[] = [];
  if (closedBy) parts.push(closedBy.reason === "none" ? `닫힘 코드 ${closedBy.code}` : `${REASONS[closedBy.reason] ?? closedBy.reason} · 코드 ${closedBy.code}`);
  if (errors) parts.push(`연결 오류 ${errors.count}번(첫: ${errors.first})`);
  return parts.join(" · ") || "모름";
}

// 끊김이 정상 절차가 아니면 끊길 때 알린다(오래 못 붙으면 그동안 아무 줄도 없게 되지 않게). 까닭이 시도 알림보다 늦게 올 수 있어 둘 다에서 부른다
function announce(shardId: number) {
  if (announced || !attempt || !closedBy || routine()) return;
  announced = true;
  log.warn(`게이트웨이 연결이 끊겼습니다 (샤드 ${shardId}): ${causeText()}. 다시 붙는 중입니다`);
}

function onDebug(message: string, shardId: number) {
  const found = DESTROYED.exec(message);
  if (!found) return;
  // 여러 번 시도한 끊김은 처음 까닭을 남긴다
  if (!closedBy) closedBy = { reason: found[1], code: Number(found[2]) };
  announce(shardId);
}

function onError(error: Error, shardId: number) {
  errors = errors ? { ...errors, count: errors.count + 1 } : { first: messageOf(error), count: 1 };
  announce(shardId);
}

function onReconnecting(shardId: number) {
  attempt += 1;
  log.debug(`게이트웨이 연결이 끊겨 다시 붙는 중입니다(${attempt}번째 시도).`);
  announce(shardId);
}

function onConnected(how: string) {
  // 처음 붙은 것은 재수립이 아니다. 열리기 전에 닫힌 것(시도 알림 없음)도 남긴다
  if (attempt || errors || closedBy) {
    if (attempt) reconnects += 1;
    const line = `게이트웨이에 다시 붙었습니다(${how}, ${attempt}번 시도, 까닭: ${causeText()}).`;
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
  log.error(`게이트웨이 연결이 닫혀 다시 붙지 않습니다 (샤드 ${shardId}): 닫힘 코드 ${code}${name ? ` ${name}` : ""}${errors ? ` · ${errors.first}` : ""}`);
  attempt = 0;
  closedBy = null;
  errors = null;
  announced = false;
}

/** 게이트웨이 이벤트를 듣는다. 끊는 함수를 돌려준다 */
function watchGateway(client: Client) {
  const debug = (message: string) => {
    // "[WS => Shard 0] …" 의 샤드 번호
    const shard = /^\[WS => Shard (\d+)\]/.exec(message);
    onDebug(message, shard ? Number(shard[1]) : 0);
  };
  const resumed = () => onConnected("이어 붙음");
  const ready = () => onConnected("새로 붙음");
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

/** reconnects: 재수립 횟수. retryAttempt: 끊겨 다시 붙으려는 중이면 몇 번째 시도, 붙어 있으면 null */
const gateway = () => ({ reconnects, retryAttempt: attempt || null });

/** 테스트: 센 값을 비운다 */
function _reset() {
  reconnects = attempt = 0;
  closedBy = null;
  errors = null;
  announced = false;
}

export { watchGateway, gateway, _reset };
