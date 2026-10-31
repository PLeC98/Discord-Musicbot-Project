// 봇 상태 탭(/api/admin/status)의 응답. 3초마다 불리므로 비싼 값은 모아 둔 것을 준다.
// 모으는 것(측정, 최근 15분, 게이트웨이, 프로세스 메모리, 저장공간)은 대시보드가 켜질 때 startStatus 로 시작한다

import os from "node:os";
import type { Client } from "discord.js";
import config from "../../config/index.ts";
import { vitals } from "../../infra/vitals.ts";
import { BOT_VERSION } from "../../infra/version.ts";
import * as YouTube from "../../sources/youtube/index.ts";
import type { BotContext } from "../../app/bot-context.ts";
import type { AdminStatus, StatusQuery } from "../contract/admin.ts";
import { gateway } from "./gateway.ts";
import { startStatusHistory, statusHistory } from "./history.ts";
import { linkRows } from "./links.ts";
import { playerRows } from "./players.ts";
import { processSummary, watchProcesses } from "./processes.ts";
import { storageView, watchStorage } from "./storage.ts";
import { envStatus, recentProblems } from "./env.ts";
import { downloadMeter } from "../../infra/download-meter.ts";
import { TrackDownloader } from "../../media/cache-download.ts";
import { encodePool } from "../../media/encode-pool.ts";
import { uploadView } from "./upload.ts";
import type { PlayerStream } from "../player-stream.ts";

const MB = 1024 * 1024;

// 봇 연결 상태. 로그인 전이면 사용자가 없다
function botStatus(client: Client, uptime: number) {
  return {
    tag: client.user?.tag || "Connecting...",
    id: client.user?.id || null,
    guilds: client.guilds.cache.size,
    ping: client.ws.ping,
    status: client.ws.status,
    uptime: Math.floor(uptime),
    startedAt: Math.round(Date.now() - uptime * 1000),
    version: BOT_VERSION,
    ...gateway(),
  };
}

/**
 * query: 목록(플레이어, 자식 프로세스)의 구간, 필터링, 정렬. viewer: 보는 운영자와 그 운영자의 서버 목록(플레이어 행의 멤버 표시, 받지 못했으면 null),
 * stream: 대시보드 연결(연결 수), launcher: 다시 시작할 수 있는가
 */
function adminStatus({ client, players, commands }: BotContext, query: StatusQuery, viewer: { id: string; memberIds: ReadonlySet<string> | null }, stream: Pick<PlayerStream, "subs">, launcher = false): AdminStatus {
  const uptime = process.uptime();
  const mem = process.memoryUsage();
  const { cpu, loop, heapLimit } = vitals();
  const cpus = os.cpus();
  return {
    bot: botStatus(client, uptime),
    node: { version: process.version, platform: process.platform, arch: process.arch, memory: { heapUsed: Math.round(mem.heapUsed / MB), heapTotal: Math.round(mem.heapTotal / MB), heapLimit, rss: Math.round(mem.rss / MB) } },
    system: { cpus: cpus.length, cpuModel: cpus[0]?.model.trim() ?? "", totalMem: Math.round(os.totalmem() / MB), freeMem: Math.round(os.freemem() / MB), loadAvg: os.loadavg(), uptime: Math.floor(os.uptime()) },
    cpu,
    loop,
    download: { ...downloadMeter(), active: TrackDownloader.activeCount() },
    upload: uploadView(),
    activePlayers: players.size,
    players: playerRows(client, players, query, viewer.id, viewer.memberIds),
    // 자식 프로세스. 오래 살아 있는 항목, 플레이어 없는 서버의 재생 일이 새는 신호다
    processes: processSummary(client, players, query),
    // 유튜브 접속 경로. 어느 것이 실행 중 제외됐는지는 여기서만 보인다(기동 로그는 설정만 보여준다).
    youtube: YouTube.statusSnapshot(),
    links: linkRows(client),
    storage: storageView(),
    recent: recentProblems(),
    // 이벤트 루프 지연은 메인 스레드 것이라 인코딩이 밀리는 것은 여기서 본다
    encoding: encodePool.stats(),
    env: envStatus(commands.size, stream.subs.size, launcher),
    history: statusHistory(),
    // 로그 뷰어의 레벨 토글 초기 상태를 정하는 값. 서버가 debug를 안 보내고 있으면
    // 그 칩을 꺼진 채로 시작해야 한다(눌러 켜도 이후에 오는 것부터 보인다).
    logLevel: config.logging.level,
  };
}

/** 모으기 시작한다(측정, 최근 15분, 프로세스 메모리, 저장공간). 게이트웨이는 기동이 로그인 전에 듣는다 */
function startStatus(bot: BotContext) {
  startStatusHistory(bot);
  watchProcesses();
  watchStorage();
}

export { adminStatus, startStatus };
