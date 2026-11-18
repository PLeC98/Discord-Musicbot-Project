// 기동 준비: 봇 업데이트(git pull, pnpm install) 뒤에 따로 실행해야 하던 작업을 기동할 때 처리한다.
// pnpm은 의존성이 그대로면 postinstall을 건너뛰어, 업데이트로 바뀐 화면 소스가 빌드되지 않은 채 남는다.
// app/main이 POToken 서버가 준비되기를 기다리는 동안 병렬로 실행한다. 실패해도 기동을 멈추지 않는다

import fs from "node:fs";
import path from "node:path";
import logger from "../infra/log/logger.ts";
import { PROJECT } from "../infra/project-paths.ts";
import { startJob, type ScriptJobInfo, type ScriptJobSpec } from "../infra/script-job.ts";
import { toolEnv } from "../config/tool-env.ts";
import config from "../config/index.ts";
import { clientFreshness } from "../dashboard/client-freshness.ts";
import { sec } from "../infra/log/seconds.ts";
const log = logger.child({ category: "core" });

/** 화면 빌드의 시간 상한(ms) */
const BUILD_MS = 5 * 60_000;
/** 실패했을 때 로그에 붙이는 출력의 마지막 줄 수 */
const TAIL_LINES = 5;

/** 작업을 시작하고 끝날 때까지 기다린다. 시작하지 못했으면(종료 중) null */
function runToEnd(spec: Omit<ScriptJobSpec, "onEnd">): Promise<ScriptJobInfo | null> {
  return new Promise((resolve) => {
    const started = startJob({ ...spec, onEnd: resolve });
    if (!started.ok) resolve(null);
  });
}

/** 저장소 루트, 화면 소스 폴더, 빌드 결과 폴더 */
type DashboardPaths = { root: string; dashboard: string; dist: string };
const DASHBOARD_PATHS: DashboardPaths = { root: PROJECT.root, dashboard: path.join(PROJECT.root, "dashboard"), dist: PROJECT.dashboardDist };

/** 화면 빌드가 없거나 소스보다 오래됐으면 빌드한다. 개발 모드(Vite 개발 서버가 화면을 제공한다)와 빌드 도구가 없는 환경은 건너뛴다(대시보드가 열린 뒤 경고가 남는다) */
async function buildDashboardIfStale({ root, dashboard: dashboardDir, dist }: DashboardPaths = DASHBOARD_PATHS): Promise<void> {
  if (config.dashboard.devOrigin) return;
  const freshness = clientFreshness(dist, root);
  if (freshness.state === "fresh") return;
  const vite = path.join(dashboardDir, "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(vite)) return;
  const why = freshness.state === "stale" ? `바뀐 화면 소스 ${freshness.changed.length}개` : freshness.state === "missing" ? "기존 빌드 결과물 없음" : "빌드 정보 없음";
  log.info(`대시보드 화면 빌드 시작: ${why}`);
  const started = Date.now();
  const info = await runToEnd({
    name: "dashboard-build",
    script: vite,
    args: ["build"],
    cwd: dashboardDir,
    env: toolEnv(),
    timeoutMs: BUILD_MS,
    succeeded: () => clientFreshness(dist, root).state === "fresh",
  });
  if (!info) return;
  if (info.state === "succeeded") return void log.info(`대시보드 화면 빌드 완료: ${sec(Date.now() - started)}초`);
  const tail = info.output.slice(-TAIL_LINES).join(" | ");
  log.warn(`대시보드 화면 빌드 실패(${info.reason ?? "?"}${info.exitCode !== null ? `, 종료 코드 ${info.exitCode}` : ""}). 기존 화면 유지: ${tail}`);
}

export { buildDashboardIfStale };
export type { DashboardPaths };
