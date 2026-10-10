// 봇 상태 탭의 최근 15분. 측정(infra/vitals)이 15초 칸을 닫을 때마다 한 점을 더한다.
// 대시보드가 켜질 때 시작하므로 화면을 늦게 열어도 그래프가 차 있다

import { onWindow, startVitals, vitals, WINDOW_MS, type Window } from "../../infra/vitals.ts";
import { playState } from "../../ui/player-status.ts";
import { downloadMeter } from "../../infra/download-meter.ts";
import type { BotContext } from "../../app/bot-context.ts";
import type { StatusHistory } from "../contract/admin.ts";

const POINTS = (15 * 60_000) / WINDOW_MS;

type Series = Exclude<keyof StatusHistory, "stepMs" | "endAt">;
const history: StatusHistory = { stepMs: WINDOW_MS, endAt: Date.now(), playing: [], ping: [], loopP99: [], heapPct: [], cpuBot: [], cpuSystem: [], downloadBps: [] };

function push(series: Series, value: number) {
  const list = history[series];
  list.push(Math.round(value * 100) / 100);
  if (list.length > POINTS) list.shift();
}

/** 칸 하나: 지금 소리를 내는 플레이어 수 · 디스코드 지연 · 루프 지연 p99 · heap 사용률 · CPU · 내려받기 속도 */
function sample(bot: BotContext, window: Window) {
  const heap = process.memoryUsage().heapUsed;
  const limit = vitals().heapLimit * 1024 * 1024;
  history.endAt = Date.now();
  push("playing", [...bot.players.values()].filter((player) => playState(player) === "playing").length);
  push("ping", Math.max(0, bot.client.ws.ping));
  push("loopP99", window.loop.p99);
  push("heapPct", limit ? (heap / limit) * 100 : 0);
  push("cpuBot", window.cpu.bot);
  push("cpuSystem", window.cpu.system);
  push("downloadBps", downloadMeter().bytesPerSec);
}

/** 측정을 켜고 칸마다 모은다. 끊는 함수를 돌려준다 */
function startStatusHistory(bot: BotContext) {
  startVitals();
  return onWindow((window) => sample(bot, window));
}

const statusHistory = (): StatusHistory => history;

export { startStatusHistory, statusHistory };
