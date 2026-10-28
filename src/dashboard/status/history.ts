// 봇 상태 탭의 최근 15분. 측정(infra/vitals)이 15초 구간을 닫을 때마다 한 점을 더한다.
// 대시보드가 켜질 때 시작하므로 화면을 늦게 열어도 그래프가 차 있다

import { onWindow, startVitals, vitals, WINDOW_MS, type Window } from "../../infra/vitals.ts";
import { playState } from "../../ui/player-status.ts";
import { downloadMeter } from "../../infra/download-meter.ts";
import { encodePool } from "../../media/encode-pool.ts";
import { closeUploadWindow, startUpload, type ReadSystem } from "./upload.ts";
import type { BotContext } from "../../app/bot-context.ts";
import type { StatusHistory } from "../contract/admin.ts";

const POINTS = (15 * 60_000) / WINDOW_MS;

type Series = Exclude<keyof StatusHistory, "stepMs" | "endAt">;
const history: StatusHistory = { stepMs: WINDOW_MS, endAt: Date.now(), playing: [], ping: [], loopP99: [], heapPct: [], cpuBot: [], cpuSystem: [], downloadBps: [], encodeRtt: [], encodeLate: [], uploadBot: [], uploadSystem: [] };
// 누락 프레임은 풀이 켜진 뒤의 합이라 구간마다 늘어난 만큼을 넣는다
let lateBefore = 0;

function push(series: Series, value: number) {
  const list = history[series];
  list.push(Math.round(value * 100) / 100);
  if (list.length > POINTS) list.shift();
}

/** 구간 하나: 지금 소리를 내는 플레이어 수 · 디스코드 지연 · 루프 지연 p99 · heap 사용률 · CPU · 다운로드 · 인코딩 워커 응답 시간 · 누락 프레임 · 업로드.
 * 시스템 업로드를 받을 때까지 기다렸다 한꺼번에 넣는다(점들이 같은 구간을 가리키게) */
async function sample(bot: BotContext, window: Window) {
  const upload = await closeUploadWindow();
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
  push("encodeRtt", encodePool.takePeakRtt());
  const late = encodePool.stats().late;
  push("encodeLate", Math.max(0, late - lateBefore));
  lateBefore = late;
  push("uploadBot", upload.bot);
  push("uploadSystem", upload.system ?? 0);
}

/** 측정을 켜고 구간마다 모은다. 끊는 함수를 돌려준다. readSystem: 시스템 업로드 누계를 읽는 것(테스트가 바꾼다) */
function startStatusHistory(bot: BotContext, { readSystem }: { readSystem?: ReadSystem } = {}) {
  startVitals();
  lateBefore = encodePool.stats().late;
  void startUpload(readSystem);
  return onWindow((window) => void sample(bot, window));
}

const statusHistory = (): StatusHistory => history;

export { startStatusHistory, statusHistory };
