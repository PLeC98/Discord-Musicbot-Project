// 봇 상태 탭의 환경(봇 정보 탭이 그린다)과 지난 1시간 경고 · 오류

import { version as discordJs } from "discord.js";
import config from "../../config/index.ts";
import logSink from "../../infra/log/sink.ts";
import { ffmpegVersion } from "../../media/ffmpeg/path.ts";
import { ytdlpBinary } from "../../sources/ytdlp-binary.ts";
import { bgutilVersion } from "../../sources/bgutil-version.ts";
import type { AdminStatus } from "../contract/admin.ts";

/** commandCount: 켜진 슬래시 명령 수, dashboardClients: 지금 열린 대시보드 연결 수, launcher: 다시 시작할 수 있는가(조립이 넘긴 다시 시작이 있다) */
function envStatus(commandCount: number, dashboardClients: number, launcher: boolean): AdminStatus["env"] {
  const state = ytdlpBinary.state;
  return {
    discordJs,
    ffmpeg: ffmpegVersion(),
    pid: process.pid,
    launcher,
    // 스스로 새 버전을 다운로드하는가(알리기만 하는 notify · 버전 고정은 아니다). 다음 확인은 알리기만 해도 있다
    ytdlp: { version: state?.version ?? null, autoUpdate: config.ytdlp.update === "auto" && !config.ytdlp.version, checkedAt: state?.lastChecked || null, nextCheckAt: ytdlpBinary.nextAt },
    bgutil: bgutilVersion.state(),
    commands: { count: commandCount, scope: config.discord.guildId ? "guild" : "global" },
    dashboardClients,
  };
}

/** 보이는 줄 수. 나머지는 실시간 로그에서 */
const SHOWN = 3;

/** 지난 1시간 경고 · 오류 수와 가장 최근 몇 가지. 같은 글은 한 줄로(횟수 · 마지막 때) */
function recentProblems(): AdminStatus["recent"] {
  const problems = logSink.recentProblems();
  const by = new Map<string, { ts: number; level: "warn" | "error"; text: string; count: number }>();
  for (const one of problems) {
    const key = `${one.level}:${one.text}`;
    const seen = by.get(key);
    if (seen) {
      seen.count += 1;
      seen.ts = Math.max(seen.ts, one.ts);
    } else by.set(key, { ...one, count: 1 });
  }
  return {
    warn: problems.filter((one) => one.level === "warn").length,
    error: problems.filter((one) => one.level === "error").length,
    lines: [...by.values()].sort((a, b) => b.ts - a.ts).slice(0, SHOWN),
  };
}

export { envStatus, recentProblems };
