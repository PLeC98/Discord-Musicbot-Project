// 봇 상태 탭의 특권 인텐트: 이 프로세스가 로그인할 때 요청한 것과 지금 앱 설정(개발자 포털의 스위치)을 비교한다.
// 앱 설정은 상태를 만들 때 기다리지 않고 백그라운드에서 읽어 잠깐 캐시한다(상태는 3초마다 만든다). 실행 중에 스위치를 켰으면 "다시 시작하면 적용"으로 보인다

import { Routes, type Client } from "discord.js";
import logger from "../../infra/log/logger.ts";
import { messageOf } from "../../rules/error-kind.ts";
import { loggedInIntents, needsApproval, switchesOf, type AppFlags, type Privileged, type Switches } from "../../infra/gateway-intents.ts";
import type { AdminStatus } from "../contract/admin.ts";

const log = logger.child({ category: "dashboard" });

/** 앱 설정을 다시 읽기까지 */
const APP_FRESH_MS = 60_000;

type Known = { switches: Switches | null; approval: boolean; at: number };
let known: Known | null = null;
let reading: Promise<void> | null = null;

// 캐시가 오래됐으면 백그라운드에서 다시 읽는다. 실패하면 이전 값을 두고 다음 간격에 재시도한다. 이 조회가 어떻게 실패해도 상태는 만든다
function refresh(client: Client, now: number) {
  if (reading || !client.isReady() || (known && now - known.at < APP_FRESH_MS)) return;
  reading = Promise.resolve()
    .then(() => client.rest.get(Routes.currentApplication()) as Promise<AppFlags>)
    .then((app) => {
      known = { switches: switchesOf(app), approval: needsApproval(app), at: now };
    })
    .catch((error: unknown) => {
      log.debug(`봇 상태: 앱 설정(특권 인텐트) 읽기 실패: ${messageOf(error)}`);
      if (known) known = { ...known, at: now };
    })
    .finally(() => {
      reading = null;
    });
}

/** 바뀌었을 것이다(켜기 버튼). 다음 상태에서 다시 읽는다 */
function forgetAppIntents() {
  known = null;
}

/** 특권 인텐트마다 로그인한 것(loggedIn)과 지금 앱 설정(now, 모르면 null). approval: 스위치가 아니라 디스코드의 승인이 필요한 규모 */
function intentStatus(client: Client, now = Date.now()): AdminStatus["intents"] {
  refresh(client, now);
  const loggedIn = loggedInIntents();
  const row = (name: Privileged) => ({ loggedIn: loggedIn[name], now: known?.switches?.[name] ?? null });
  return { messageContent: row("messageContent"), guildMembers: row("guildMembers"), approval: known?.approval ?? false };
}

/** 테스트: 기억한 것을 비운다 */
function _resetIntentStatus() {
  known = null;
  reading = null;
}

export { intentStatus, forgetAppIntents, _resetIntentStatus, APP_FRESH_MS };
