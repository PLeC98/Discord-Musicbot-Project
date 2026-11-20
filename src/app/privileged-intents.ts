// 특권 인텐트: 기동이 읽은 앱 설정(GET /applications/@me, app/app-info)로 개발자 포털에서 켜진 것만 요청한다. 꺼진 것은 빼고 그것에 기대는 기능만 끈다(infra/gateway-intents).
// 거절되면 인텐트를 줄여서 다시 로그인하지 않는다. discord.js는 로그인에 실패하면 클라이언트를 자체적으로 destroy() 하고(app/login), 대시보드와 패널이 로그인 전에 이미 그 클라이언트를 쓴다.
// 그래서 앱 설정을 못 읽으면 특권 인텐트를 모두 요청하고, 그래도 거절되면(4014) 무엇을 켜면 되는지 알리고 멈춘다

import { GatewayIntentBits } from "discord.js";
import logger from "../infra/log/logger.ts";
import { APPROVAL_SERVERS, INTENT_NAMES as NAMES, needsApproval, switchesOf, useLoggedIn, type AppFlags, type Privileged, type Switches } from "../infra/gateway-intents.ts";

const log = logger.child({ category: "core" });

const PORTAL = "개발자 포털 → 앱 → Bot → Privileged Gateway Intents";
const TURNED_OFF: Record<Privileged, string> = { messageContent: "전용 채널에 채팅으로 곡을 넣는 기능", guildMembers: "대시보드의 서버 화면(운영자 패널은 그대로)" };
const ALL_ON: Switches = { messageContent: true, guildMembers: true };

// 마지막으로 읽은 앱 설정. 로그인이 거절됐을 때 승인이 필요한 규모인지 안내에 쓴다
let lastApp: AppFlags | null = null;

// 꺼진 스위치를 어떻게 켜나. 승인이 필요한 규모면 스위치가 아니라 신청
const howToEnable = (app: AppFlags | null) => (needsApproval(app) ? `서버가 ${APPROVAL_SERVERS}개 이상이라 디스코드의 승인이 필요함(${PORTAL}에서 신청)` : `${PORTAL}에서 켜고 다시 시작`);

/**
 * 요청할 인텐트를 고르고 이 프로세스의 인텐트로 적는다. 앱 설정을 못 읽었거나(null, 경고는 app/app-info가 남긴다) flags가 없으면 다 요청한다(모르는 것은 꺼짐이 아니다)
 */
function choosePrivilegedIntents(app: AppFlags | null): GatewayIntentBits[] {
  lastApp = app;
  const switches = switchesOf(app);
  if (app && !switches) log.warn("앱 설정에 인텐트 플래그(flags)가 없어 특권 인텐트를 모두 요청함");
  const chosen = switches ?? ALL_ON;
  for (const name of ["messageContent", "guildMembers"] as const) {
    if (!chosen[name]) log.warn(`특권 인텐트 ${NAMES[name]} 꺼짐: ${TURNED_OFF[name]}을 끄고 기동 | ${howToEnable(app)}`);
  }
  useLoggedIn(chosen);
  return intentsFor(chosen);
}

/** 요청할 인텐트. 특권 둘은 켜진 것만 */
function intentsFor(switches: Switches): GatewayIntentBits[] {
  return [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, ...(switches.messageContent ? [GatewayIntentBits.MessageContent] : []), ...(switches.guildMembers ? [GatewayIntentBits.GuildMembers] : [])];
}

/** 로그인이 특권 인텐트 거절(4014)로 실패했을 때의 안내. 어느 스위치인지 모르므로 둘 다 */
function refusedAtLogin() {
  return `로그인 거절: 개발자 포털에서 꺼진 특권 인텐트를 요청함 | ${NAMES.guildMembers}, ${NAMES.messageContent}: ${howToEnable(lastApp)}`;
}

/**
 * 실행 중에 게이트웨이가 특권 인텐트 거절(4014)로 닫았다(포털에서 스위치를 끔). 다시 붙지 않는다.
 * restart: 다시 실행해 줄 실행기가 있으면 세션을 저장하고 다시 시작한다(다음 기동이 켜진 것만 요청한다). 없으면 알리고 남는다
 */
function onRefusedWhileRunning(restart: ((why: string) => void) | null) {
  if (restart) {
    log.error("게이트웨이가 꺼진 특권 인텐트를 거절해 연결이 끊김(4014) | 다시 시작해 켜진 특권 인텐트만 요청함");
    restart("특권 인텐트 거절");
    return;
  }
  log.error(`게이트웨이가 꺼진 특권 인텐트를 거절해 연결이 끊김(4014), 재연결하지 않음 | 봇을 다시 시작하면 꺼진 인텐트가 필요한 기능만 끄고 기동, 켜려면 ${PORTAL}`);
}

/** 테스트: 마지막으로 읽은 앱 설정을 비운다 */
function _resetPrivilegedIntents() {
  lastApp = null;
}

export { choosePrivilegedIntents, intentsFor, refusedAtLogin, onRefusedWhileRunning, _resetPrivilegedIntents };
