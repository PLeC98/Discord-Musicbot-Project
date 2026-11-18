// 외부 프로그램 이전 버전 삭제(업데이트 탭의 "외부 프로그램 이전 버전" 카드). 공유 타입은 contract/old-tools.
// 도구마다 따로 하고, 하나가 실패하거나 건너뛰어도 나머지는 한다. 지금 쓰는 것을 삭제하지 않는 판단은 그 도구의 모듈이 한다
// (yt-dlp: sources/ytdlp-binary의 폴더 사용권, ffmpeg: media/ffmpeg/cleanup이 봇이 정해 둔 경로와 PATH로).
// 예전 설치 위치(vendor/bin)는 예전 설치가 둔 이름만 삭제하고, 모르는 이름이 있으면 폴더를 남긴다

import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "../infra/project-paths.ts";
import { pathHolder, treeSize } from "../infra/folder-guard.ts";
import { cleanupFfmpeg, previewFfmpegCleanup, type KeptReason } from "../media/ffmpeg/cleanup.ts";
import { resolvedPath } from "../media/ffmpeg/path.ts";
import { ytdlpBinary } from "../sources/ytdlp-binary.ts";
import { isYtdlpTag } from "../rules/ytdlp-tag.ts";
import { codeOf } from "../rules/error-kind.ts";
import { OLD_TOOLS, type OldTool, type OldToolDone, type OldToolKept, type OldToolView } from "./contract/old-tools.ts";

/** 테스트가 교체하는 것: yt-dlp, 세 폴더, 봇이 정해 둔 ffmpeg 경로(정하지 않았으면 null), PATH */
type Deps = {
  ytdlp: { oldFolders(): { previous: string | null; folders: string[] } | null; forgetPrevious(go?: () => void): Promise<string | null> };
  ytdlpDir: string;
  ffmpegDir: string;
  legacyDir: string;
  ffmpegPath(): string | null;
  pathEnv?: string;
};
const REAL: Deps = {
  ytdlp: { oldFolders: () => ytdlpBinary.oldFolders(), forgetPrevious: (go) => ytdlpBinary.forgetPrevious(go) },
  // yt-dlp 모듈이 쓰는 폴더 그대로(따로 적으면 어긋날 수 있다)
  get ytdlpDir() {
    return ytdlpBinary.io.dir;
  },
  ffmpegDir: PROJECT.ffmpeg,
  legacyDir: PROJECT.legacyBin,
  ffmpegPath: resolvedPath,
};

/** 예전 설치가 vendor/bin에 둔 이름(옛 ffmpeg 실행 파일과 그 기록, yt-dlp 폴더) */
const LEGACY_NAMES = new Set(["ffmpeg", "ffmpeg.exe", ".ffmpeg-version.json", "yt-dlp"]);
const TRASH = /^\.trash-/;

const unique = <T>(items: T[]) => [...new Set(items)];
const keptOf = (reason: KeptReason): OldToolKept => (reason === "rename-failed" ? "failed" : reason);
const view = (tool: OldTool, fields: Partial<OldToolView> = {}): OldToolView => ({ tool, versions: [], bytes: 0, kept: [], ...fields });
// 카드에 보일 것: 삭제할 것이 있거나 남기는 사유가 있다
const worth = (v: OldToolView) => v.versions.length > 0 || v.bytes > 0 || v.kept.length > 0;

// 세션 확인이 던진 예외는 도구의 실패로 삼키지 않고 그대로 올린다(라우트가 응답을 정한다)
function guarded(go?: () => void) {
  let stopped = false;
  const check = () => {
    try {
      go?.();
    } catch (error) {
      stopped = true;
      throw error;
    }
  };
  return { check, stopped: () => stopped };
}

// ── yt-dlp ──

async function previewYtdlp(d: Deps): Promise<OldToolView> {
  const old = d.ytdlp.oldFolders();
  if (!old) return view("ytdlp", { kept: ["broken"] });
  let bytes = 0;
  for (const folder of old.folders) bytes += await treeSize(path.join(d.ytdlpDir, folder));
  return view("ytdlp", { versions: unique([old.previous, ...old.folders.filter(isYtdlpTag)].filter((v): v is string => Boolean(v))), bytes });
}

async function removeYtdlp(d: Deps, go?: () => void): Promise<OldToolDone> {
  const before = await previewYtdlp(d);
  if (!worth(before) || before.kept.includes("broken")) return { ...before, deferred: false };
  const { check, stopped } = guarded(go);
  try {
    await d.ytdlp.forgetPrevious(check);
  } catch (error) {
    if (stopped()) throw error;
    const code = codeOf(error);
    return { ...view("ytdlp", { kept: [code === "folder-busy" ? "busy" : code === "state-broken" ? "broken" : "failed"] }), deferred: false };
  }
  // 정리가 미룬 폴더(돌고 있는 yt-dlp가 쓰는 중)는 남아 있다. 삭제한 크기는 사라진 폴더만 센다
  const left = new Set(d.ytdlp.oldFolders()?.folders ?? []);
  const deferred = before.versions.some((v) => fs.existsSync(path.join(d.ytdlpDir, v)) && !left.has(v));
  const after = await previewYtdlp(d);
  return { ...before, bytes: Math.max(0, before.bytes - after.bytes), deferred };
}

// ── ffmpeg ──

async function previewFfmpeg(d: Deps): Promise<OldToolView> {
  if (!fs.existsSync(d.ffmpegDir)) return view("ffmpeg");
  const used = d.ffmpegPath();
  if (!used) return view("ffmpeg", { kept: ["starting"] });
  const p = await previewFfmpegCleanup(d.ffmpegDir, { inUse: used, dropPrevious: true, pathEnv: d.pathEnv });
  if (p.kind === "broken") return view("ffmpeg", { kept: ["broken"] });
  return view("ffmpeg", { versions: unique(p.doomed.flatMap((x) => (x.release ? [x.release] : []))), bytes: p.bytes, kept: unique(p.kept.map((k) => keptOf(k.reason))) });
}

async function removeFfmpeg(d: Deps, go?: () => void): Promise<OldToolDone> {
  const before = await previewFfmpeg(d);
  const used = d.ffmpegPath();
  if (!used || !worth(before) || before.kept.includes("broken")) return { ...before, deferred: false };
  const { check, stopped } = guarded(go);
  let done: Awaited<ReturnType<typeof cleanupFfmpeg>>;
  try {
    done = await cleanupFfmpeg(d.ffmpegDir, { inUse: used, dropPrevious: true, go: check, pathEnv: d.pathEnv });
  } catch (error) {
    // 기록 쓰기 실패 등. 옮긴 폴더는 제자리로 돌아왔다(media/ffmpeg/cleanup)
    if (stopped()) throw error;
    return { ...view("ffmpeg", { kept: ["failed"] }), deferred: false };
  }
  if (done.kind === "busy") return { ...view("ffmpeg", { kept: ["busy"] }), deferred: false };
  if (done.kind === "broken") return { ...view("ffmpeg", { kept: ["broken"] }), deferred: false };
  const kept = unique([...done.kept.map((k) => keptOf(k.reason)), ...(done.failed.length ? (["failed"] as const) : [])]);
  return { ...view("ffmpeg", { versions: unique(done.removed.flatMap((r) => (r.release ? [r.release] : []))), bytes: done.removed.reduce((sum, r) => sum + r.bytes, 0), kept }), deferred: false };
}

// ── 예전 설치 위치(vendor/bin) ──

/** 삭제할 이름과 남기는 사유. 폴더가 없으면 null. 폴더 자체가 링크면 따라가지 않는다 */
function legacyPlan(d: Deps, inUse: string): { names: string[]; kept: OldToolKept[] } | null {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(d.legacyDir);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink()) return { names: [], kept: ["link"] };
  if (!stat.isDirectory()) return null;
  const held = pathHolder(inUse, d.pathEnv);
  const names: string[] = [];
  const kept: OldToolKept[] = [];
  for (const name of fs.readdirSync(d.legacyDir)) {
    if (!LEGACY_NAMES.has(name) && !TRASH.test(name)) continue;
    if (held(path.join(d.legacyDir, name))) kept.push("in-use");
    else names.push(name);
  }
  return { names, kept: unique(kept) };
}

async function previewLegacy(d: Deps): Promise<OldToolView> {
  const used = d.ffmpegPath();
  // ffmpeg를 정하기 전이면 FFMPEG_PATH가 이 안을 가리키는지 모른다
  if (!used) return view("legacy", fs.existsSync(d.legacyDir) ? { kept: ["starting"] } : {});
  const plan = legacyPlan(d, used);
  if (!plan) return view("legacy");
  let bytes = 0;
  for (const name of plan.names) bytes += await treeSize(path.join(d.legacyDir, name));
  return view("legacy", { bytes, kept: plan.kept });
}

async function removeLegacy(d: Deps, go?: () => void): Promise<OldToolDone> {
  const before = await previewLegacy(d);
  const used = d.ffmpegPath();
  const plan = used ? legacyPlan(d, used) : null;
  if (!plan || plan.names.length === 0) return { ...before, deferred: false };
  go?.();
  let bytes = 0;
  const kept = [...plan.kept];
  for (const name of plan.names) {
    const from = path.join(d.legacyDir, name);
    const trash = TRASH.test(name) ? from : path.join(d.legacyDir, `.trash-${name}-${process.pid}-${Date.now()}`);
    try {
      if (trash !== from) await fs.promises.rename(from, trash);
      const size = await treeSize(trash);
      await fs.promises.rm(trash, { recursive: true, force: true, maxRetries: 2 });
      bytes += size;
    } catch {
      kept.push("failed");
    }
  }
  // 모르는 이름이 남았으면 폴더를 남긴다
  if (fs.readdirSync(d.legacyDir).length === 0) await fs.promises.rmdir(d.legacyDir).catch(() => undefined);
  return { ...view("legacy", { bytes, kept: unique(kept) }), deferred: false };
}

// ── 묶음 ──

/** 카드가 보이는 것. 삭제할 것이나 남기는 사유가 있는 도구만 */
async function previewOldTools(d: Deps = REAL): Promise<OldToolView[]> {
  return [await previewYtdlp(d), await previewFfmpeg(d), await previewLegacy(d)].filter(worth);
}

/**
 * 삭제한다. 도구마다 잠금 안에서 지금 상태로 다시 판단한다(화면이 보던 양이 아니라). 세션 확인(go)은 바꾸기 전에 부르고, 예외를 던지면 그 뒤의 도구도 하지 않는다
 * @param only  그 도구만(카드의 줄마다 삭제). 없으면 모두(카드 헤더의 모두 삭제)
 * @returns 삭제한 것, 미룬 것, 남기는 사유가 있는 도구만
 */
async function removeOldTools(go?: () => void, d: Deps = REAL, only?: OldTool): Promise<OldToolDone[]> {
  const steps: Record<OldTool, () => Promise<OldToolDone>> = { ytdlp: () => removeYtdlp(d, go), ffmpeg: () => removeFfmpeg(d, go), legacy: () => removeLegacy(d, go) };
  const done: OldToolDone[] = [];
  for (const tool of OLD_TOOLS) if (!only || only === tool) done.push(await steps[tool]());
  return done.filter((t) => worth(t) || t.deferred);
}

const KEPT_TEXT: Record<OldToolKept, string> = { "in-use": "사용 중", starting: "기동 중", broken: "기록 읽기 실패", "only-build": "유일한 빌드", link: "심볼릭 링크", busy: "다른 프로세스가 사용 중", failed: "삭제 실패" };
const TOOL_TEXT: Record<OldTool, string> = { ytdlp: "yt-dlp", ffmpeg: "ffmpeg", legacy: "vendor/bin" };
const MB = (bytes: number) => Math.round(bytes / 1024 / 1024);

/** 삭제 결과를 로그 한 줄로: 도구마다 삭제한 버전과 크기, 남긴 것과 그 사유 */
function doneLine(tools: OldToolDone[]): string {
  const removed = tools.filter((t) => t.bytes > 0 || t.versions.length > 0).map((t) => `${TOOL_TEXT[t.tool]}${t.versions.length ? ` ${t.versions.join(", ")}` : ""}(${MB(t.bytes)}MB${t.deferred ? ", 사용 중인 폴더는 다음 정리 때 삭제" : ""})`);
  const kept = tools.filter((t) => t.kept.length > 0).map((t) => `${TOOL_TEXT[t.tool]}(${t.kept.map((k) => KEPT_TEXT[k]).join(", ")})`);
  return `${removed.join(", ") || "삭제한 것 없음"}${kept.length ? `. 남김: ${kept.join(", ")}` : ""}`;
}

export { previewOldTools, removeOldTools, doneLine };
export type { Deps as OldToolsDeps };
