// 디스코드 게이트웨이 연결: 봇이 켜진 뒤 끊겼다 다시 붙은(재수립) 횟수와, 지금 다시 붙으려는 중이면 몇 번째 시도인지.
// discord.js 는 연결이 닫힐 때마다 shardReconnecting 을, 다시 붙으면 shardResume(이어 붙임) · shardReady(새로 붙음)를 낸다

import { Events, type Client } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "discord" });

let reconnects = 0;
/** 지금 끊긴 뒤 시도 횟수. 붙어 있으면 0 */
let attempt = 0;
/** 이번 끊김의 까닭. 다시 붙을 때 찍고 비운다 */
let cause: string | null = null;

// @discordjs/ws 는 연결을 닫을 때마다(끊기기 앞이든 뒤든 한 번) debug 로 "Destroying shard / Reason / Code" 를 낸다
const DESTROYED = /Destroying shard\n\tReason: (.*)\n\tCode: (\d+)/;
const REASONS: Record<string, string> = {
  "Told to reconnect by Discord": "디스코드가 다시 붙으라고 함(op 7)",
  "Zombie connection": "하트비트 응답 없음",
  "Got disconnected by Discord": "디스코드가 끊음",
  "Invalid session": "세션이 무효",
};

function onDebug(message: string) {
  const found = DESTROYED.exec(message);
  // 여러 번 시도한 끊김은 처음 까닭을 남긴다
  if (!found || cause) return;
  const [, reason, code] = found;
  cause = reason === "none" ? `닫힘 코드 ${code}` : `${REASONS[reason] ?? reason} · 코드 ${code}`;
}

function onReconnecting() {
  attempt += 1;
  log.debug(`게이트웨이 연결이 끊겨 다시 붙는 중입니다(${attempt}번째 시도).`);
}

// 처음 붙은 것은 재수립이 아니다(끊긴 적이 없으면 attempt 가 0)
function onConnected(how: string) {
  if (!attempt) return;
  reconnects += 1;
  log.debug(`게이트웨이에 다시 붙었습니다(${how}, ${attempt}번 시도, 까닭: ${cause ?? "모름"}).`);
  attempt = 0;
  cause = null;
}

/** 게이트웨이 이벤트를 듣는다. 끊는 함수를 돌려준다 */
function watchGateway(client: Client) {
  const resumed = () => onConnected("이어 붙음");
  const ready = () => onConnected("새로 붙음");
  client.on(Events.Debug, onDebug);
  client.on(Events.ShardReconnecting, onReconnecting);
  client.on(Events.ShardResume, resumed);
  client.on(Events.ShardReady, ready);
  return () => {
    client.off(Events.Debug, onDebug);
    client.off(Events.ShardReconnecting, onReconnecting);
    client.off(Events.ShardResume, resumed);
    client.off(Events.ShardReady, ready);
  };
}

/** reconnects: 재수립 횟수. retryAttempt: 끊겨 다시 붙으려는 중이면 몇 번째 시도, 붙어 있으면 null */
const gateway = () => ({ reconnects, retryAttempt: attempt || null });

/** 테스트: 센 값을 비운다 */
function _reset() {
  reconnects = attempt = 0;
  cause = null;
}

export { watchGateway, gateway, _reset };
