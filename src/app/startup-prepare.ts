// 기동 준비: 봇 업데이트(git pull, pnpm install) 뒤에 따로 실행해야 하던 작업을 기동할 때 처리한다(화면 빌드, ffmpeg 맞추기).
// pnpm은 의존성이 그대로면 postinstall을 건너뛰어, 업데이트로 바뀐 화면 소스와 ffmpeg 기본값이 반영되지 않은 채 남는다.
// app/main이 POToken 서버가 준비되기를 기다리는 동안 병렬로 실행한다. 작업 실행기는 한 번에 하나만 실행하므로 둘은 차례로 돈다. 실패해도 기동을 멈추지 않는다

import fs from "node:fs";
import path from "node:path";
import logger from "../infra/log/logger.ts";
import { PROJECT } from "../infra/project-paths.ts";
import { startJob, type ScriptJobInfo, type ScriptJobSpec } from "../infra/script-job.ts";
import { toolEnv } from "../config/tool-env.ts";
import config from "../config/index.ts";
import { clientFreshness } from "../dashboard/client-freshness.ts";
import { sec } from "../infra/log/seconds.ts";
import { TARGETS } from "../media/ffmpeg/release.ts";
import { cleanupFfmpeg } from "../media/ffmpeg/cleanup.ts";
const log = logger.child({ category: "core" });

/** 화면 빌드, ffmpeg 맞추기(다운로드, 압축 풀기, 실행 확인)의 시간 상한(ms) */
const BUILD_MS = 5 * 60_000;
const FFMPEG_MS = 10 * 60_000;
/** 실패했을 때 로그에 붙이는 출력의 마지막 줄 수 */
const TAIL_LINES = 5;

/** 작업을 시작하고 끝날 때까지 기다린다. 시작하지 못했으면 null(종료 중이면 조용히 넘어가고, 다른 작업이 도는 중이면 경고) */
function runToEnd(spec: Omit<ScriptJobSpec, "onEnd">): Promise<ScriptJobInfo | null> {
  return new Promise((resolve) => {
    const started = startJob({ ...spec, onEnd: resolve });
    if (started.ok) return;
    if (started.reason === "busy") log.warn(`${spec.name} 건너뜀: 다른 작업(${started.running?.name ?? "?"})이 도는 중`);
    resolve(null);
  });
}

/** 실패한 작업을 한 줄로 요약한다. 사유, 종료 코드, 출력의 마지막 줄들 */
const failedText = (info: ScriptJobInfo) => `${info.reason ?? "?"}${info.exitCode !== null ? `, 종료 코드 ${info.exitCode}` : ""}): ${info.output.slice(-TAIL_LINES).join(" | ")}`;

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
  log.warn(`대시보드 화면 빌드 실패(${failedText(info)}. 기존 화면 유지`);
}

/**
 * ffmpeg를 목표(고정, 없으면 코드의 기본값)에 맞춘다. 설치 스크립트를 인자 없이 자식 프로세스로 실행하고 끝난 뒤 쓰지 않는 폴더를 정리한다.
 * FFMPEG_PATH를 쓰거나 이 환경의 빌드가 없으면(macOS 등) 하지 않는다. 실패하면 경고만 하고 받아 둔 것으로 뜬다(media/ffmpeg/path)
 */
async function alignFfmpegAtStartup(dir = PROJECT.ffmpeg, script = path.join(PROJECT.root, "scripts", "install-ffmpeg.ts")): Promise<void> {
  if (config.ffmpeg.path || !TARGETS[`${process.platform}-${process.arch}`]) return;
  const info = await runToEnd({ name: "ffmpeg-install", script, args: [], cwd: PROJECT.root, env: toolEnv(), timeoutMs: FFMPEG_MS, succeeded: () => true });
  if (info?.state === "succeeded") {
    // 이미 맞으면(대부분의 기동) 조용히 넘어가고, 바꿨으면 스크립트의 결과 줄을 남긴다
    const last = info.output.at(-1) ?? "";
    if (!last.includes("이미 ")) log.info(`ffmpeg 맞추기: ${last}`);
  } else if (info) log.warn(`ffmpeg 맞추기 실패(${failedText(info)}. 받아 둔 ffmpeg로 뜸`);
  const cleaned = await cleanupFfmpeg(dir);
  if (cleaned.kind === "ok" && cleaned.removed.length) log.info(`ffmpeg 옛 폴더 정리: ${cleaned.removed.map((r) => r.name).join(", ")}`);
}

/** 기동 준비 전체. 작업 실행기의 자리가 하나라 차례로 실행한다 */
async function prepareStartup(): Promise<void> {
  await buildDashboardIfStale();
  await alignFfmpegAtStartup();
}

export { buildDashboardIfStale, alignFfmpegAtStartup, prepareStartup };
export type { DashboardPaths };
