// 로그인 배경 백업(설정 내보내기의 login-background 종류). ZIP 의 login-background/ 아래에 index.json(다 만든 배경 · 지금 배경 · 화면 값 · 한도)과
// 배경마다 내는 파일(files.ts 의 꼴)을 저장 자리 그대로 담는다. 만드는 중 · 실패한 배경은 담지 않는다.
// 불러오기는 통째로 바꾼다(2026-10-17 사용자): 파일의 배경을 새 id 로 저장 자리에 먼저 풀고(기록에 없는 폴더라 아직 보이지 않고, 도중에 꺼지면 다음에 켤 때 치운다),
// 도는 단계를 멈춘 뒤 기록을 바꾸고 옛 배경을 지운다. 로그인 화면은 옛 배경의 파일을 못 받으면 배경 정보를 다시 읽는다.
// 남이 준 파일일 수 있어 꼴만 받는다: 기록은 다 만든 배경의 꼴, 파일은 기록에 있는 배경의 내는 파일, 목록(.m3u8)은 그 폴더 안의 파일만 가리키고, 정지 그림은 적힌 폭의 WebP

import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import { openZip, type ZipInput, type ZipItem } from "../../infra/zip.ts";
import { formatBytes } from "../../ui/format.ts";
import { isHttpLink } from "../../rules/links.ts";
import { BackgroundEditBody, BackgroundPositionBody } from "../request-schemas.ts";
import { LOGIN_BG_CODECS, type LoginBackgroundCodec, type LoginBackgroundRung, type LoginBackgroundScene } from "../contract/login-background.ts";
import type { ArchiveRow } from "../contract/settings-archive.ts";
import * as store from "./store.ts";
import * as runner from "./runner.ts";
import { PLAYLIST, STILL_FILE, isServed, servedFiles } from "./files.ts";

const DIR = "login-background/";
const INDEX_NAME = `${DIR}index.json`;
// index.json 하나의 상한(배경 50개 × 장면 색 수백 줄)
const INDEX_MAX_BYTES = 16 * 1024 * 1024;
const PLAYLIST_MAX_BYTES = 1024 * 1024;
const STILL_MAX_BYTES = 64 * 1024 * 1024;
const HEX = /^#[0-9a-f]{6}$/i;
const CODECS = /^[A-Za-z0-9.]+(,[A-Za-z0-9.]+)*$/;
/** 목록이 가리킬 수 있는 것: 코덱 목록은 단계 목록, 단계 목록은 조각 */
const RUNG_LINE = /^(\d{2,4})\/index\.m3u8$/;
const SEGMENT_LINE = /^seg-\d{3,6}\.m4s$/;
/** 단계 목록이 init 을 가리키는 줄(이 꼴만 주소를 받는다) */
const MAP_LINE = '#EXT-X-MAP:URI="init.mp4"';

type Zipped = ReturnType<typeof openZip>;
/** 불러올 것: 검사를 지난 기록과 배경마다 풀 항목 */
type Plan = { index: store.Index; files: Map<string, ZipItem[]> };

const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isTable = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

// ── 내보내기 ──

/** 내보낼 지금 배경: 지금 배경을 다 만들었으면 그것, 아직 만드는 중이면 그 전에 쓰던 다 만든 배경 */
function exportedCurrent(current: string | null, ready: store.Stored[]): string | null {
  if (ready.some((one) => one.id === current)) return current;
  return ready.filter((one) => one.usedAt > 0).sort((a, b) => b.usedAt - a.usedAt)[0]?.id ?? null;
}

/**
 * 내보낼 항목: index.json(다 만든 배경만) · 그 배경들의 내는 파일(파일째 흘려 담는다). 만드는 중인 배경은 쓰는 중인 파일이라 담지 않는다.
 * state · folderOf 는 기록과 배경 폴더(전체 백업 명령은 봇 밖에서 readIndex 로 읽은 것), prefix 는 ZIP 안 이름 앞
 */
function exportInputs({ state = store.loaded(), folderOf = store.folderOf, prefix = "" }: { state?: store.Index; folderOf?: (id: string) => string; prefix?: string } = {}): ZipInput[] {
  const ready = state.items.filter(store.isReady);
  const items = ready.map((one) => ({ ...one, stage: null, resumed: false, strip: null, estimate: null }));
  const json: store.Index = { current: exportedCurrent(state.current, ready), items, options: state.options, limits: state.limits };
  const files = ready.flatMap((one) => servedFiles(folderOf(one.id)).map((rel) => ({ name: `${prefix}${DIR}${one.id}/${rel}`, file: path.join(folderOf(one.id), ...rel.split("/")) })));
  return [{ name: prefix + INDEX_NAME, data: Buffer.from(`${JSON.stringify(json, null, 2)}\n`) }, ...files];
}

// ── 기록 한 줄의 꼴 ──

function rungFrom(raw: unknown): LoginBackgroundRung | null {
  if (!isTable(raw)) return null;
  const { width, height, codecs, bandwidth, frameRate } = raw;
  if (![width, height, bandwidth, frameRate].every((value) => isNum(value) && value > 0) || typeof codecs !== "string" || !CODECS.test(codecs)) return null;
  return { width: width as number, height: height as number, codecs, bandwidth: bandwidth as number, frameRate: frameRate as number };
}

/** 색(#RRGGBB) 또는 null(회색 테마) */
const isColor = (value: unknown): value is string | null => value === null || (typeof value === "string" && HEX.test(value));

function sceneFrom(raw: unknown): LoginBackgroundScene | null {
  if (!isTable(raw) || !isNum(raw.at) || raw.at < 0 || !isColor(raw.color)) return null;
  return { at: raw.at, color: raw.color };
}

/** 코덱마다의 단계(아는 코덱만, 코덱마다 하나 이상) */
function rungsFrom(raw: unknown): store.Media["rungs"] | null {
  if (!isTable(raw) || Object.keys(raw).some((key) => !LOGIN_BG_CODECS.some((codec) => codec === key))) return null;
  const rungs: store.Media["rungs"] = {};
  for (const [codec, list] of Object.entries(raw) as [LoginBackgroundCodec, unknown][]) {
    const parsed = Array.isArray(list) ? list.map(rungFrom) : [null];
    if (!parsed.length || parsed.some((one) => one === null)) return null;
    rungs[codec] = parsed as LoginBackgroundRung[];
  }
  return rungs;
}

/** 구운 것의 꼴(공개 응답에 그대로 나간다). 그림은 HLS 가 없고, 영상은 코덱 하나 이상 */
function mediaFrom(raw: unknown, kind: store.Stored["kind"]): store.Media | null {
  if (!isTable(raw) || !Array.isArray(raw.stills) || !raw.stills.length || !raw.stills.every((width) => Number.isInteger(width) && STILL_FILE.test(`still-${width}.webp`))) return null;
  const scenes = Array.isArray(raw.scenes) ? raw.scenes.map(sceneFrom) : [null];
  const rungs = rungsFrom(raw.rungs);
  if (!isColor(raw.color) || scenes.some((one) => one === null) || !rungs || (kind === "image") !== (Object.keys(rungs).length === 0)) return null;
  return { stills: [...new Set(raw.stills as number[])], color: raw.color, scenes: scenes as LoginBackgroundScene[], rungs };
}

/** 파일의 기록 한 줄을 다 만든 배경의 기록으로(꼴이 틀리면 null). 단계는 그 배경이 하는 단계를 모두 마친 것으로, 크기는 푼 뒤에 다시 잰다 */
function itemFrom(raw: unknown): store.Stored | null {
  if (!store.isStored(raw)) return null;
  const edit = BackgroundEditBody.safeParse(raw.edit);
  const position = BackgroundPositionBody.safeParse(raw.position);
  const media = mediaFrom(raw.media, raw.kind);
  const stages = store.stagesOf(raw.kind, raw.from);
  if (!edit.success || !position.success || !media || raw.problem !== null || !stages.every((stage) => raw.done.includes(stage))) return null;
  if (![raw.width, raw.height].every((side) => side > 0) || (raw.kind === "video" && !(raw.duration > 0 && raw.fps > 0))) return null;
  return {
    id: raw.id,
    kind: raw.kind,
    from: raw.from,
    name: store.cleanName(raw.name, store.LINK_MAX) || "file",
    // 링크로 받은 주소(만들 때와 같은 검사)
    link: typeof raw.link === "string" && raw.link.length <= store.LINK_MAX && isHttpLink(raw.link) ? raw.link : null,
    at: raw.at,
    usedAt: raw.usedAt,
    appliedAt: raw.appliedAt,
    bytes: 0,
    width: raw.width,
    height: raw.height,
    duration: raw.duration,
    fps: raw.fps,
    edit: edit.data,
    position: position.data,
    stages,
    done: [...stages],
    stage: null,
    resumed: false,
    problem: null,
    strip: null,
    estimate: null,
    media,
  };
}

// ── 파일 검사 ──

/** 목록의 줄이 이 폴더 안만 가리키는지. 가리키는 것(단계 폴더 · 조각 이름) */
function playlistTargets(text: string, line: RegExp, allowMap: boolean): string[] | null {
  const targets: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const one = raw.trim();
    if (!one) continue;
    if (one.startsWith("#")) {
      // 주소를 적는 꼴(URI=)은 init 을 가리키는 줄만
      if (one.includes("URI=") && !(allowMap && one === MAP_LINE)) return null;
      continue;
    }
    if (!line.test(one)) return null;
    targets.push(one);
  }
  return targets;
}

/** 배경 하나의 파일(배경 폴더 안 경로 → 항목)과 읽기 */
type Files = { has: (rel: string) => boolean; read: (rel: string, max: number) => Buffer };

/** 정지 그림이 다 있고 적힌 폭의 WebP 인지 */
async function stillsProblem(one: store.Stored, files: Files): Promise<string | null> {
  for (const width of one.media.stills) {
    const rel = `still-${width}.webp`;
    if (!files.has(rel)) return `"${one.name}" 의 정지 그림(${rel})이 없습니다.`;
    const meta = await sharp(files.read(rel, STILL_MAX_BYTES))
      .metadata()
      .catch(() => null);
    if (meta?.format !== "webp" || meta.width !== width) return `"${one.name}" 의 정지 그림(${rel})이 그 폭의 WebP 가 아닙니다.`;
  }
  return null;
}

/** 코덱마다 목록 · 단계 목록 · init · 조각이 다 있고 목록이 그 폴더 안만 가리키는지 */
function streamsProblem(one: store.Stored, { has, read }: Files): string | null {
  for (const [codec, rungs] of Object.entries(one.media.rungs) as [LoginBackgroundCodec, LoginBackgroundRung[]][]) {
    const master = `${codec}/${PLAYLIST}`;
    if (!has(master)) return `"${one.name}" 의 ${codec} 목록이 없습니다.`;
    const shorts = playlistTargets(read(master, PLAYLIST_MAX_BYTES).toString("utf8"), RUNG_LINE, false);
    if (!shorts || shorts.length !== rungs.length) return `"${one.name}" 의 ${codec} 목록을 쓸 수 없습니다.`;
    for (const line of shorts) {
      const short = RUNG_LINE.exec(line)![1];
      const playlist = `${codec}/${short}/${PLAYLIST}`;
      if (!has(playlist) || !has(`${codec}/${short}/init.mp4`)) return `"${one.name}" 의 ${codec} ${short} 단계 파일이 없습니다.`;
      const segments = playlistTargets(read(playlist, PLAYLIST_MAX_BYTES).toString("utf8"), SEGMENT_LINE, true);
      if (!segments?.length || segments.some((name) => !has(`${codec}/${short}/${name}`))) return `"${one.name}" 의 ${codec} ${short} 단계 목록을 쓸 수 없습니다.`;
    }
  }
  return null;
}

/** 배경 하나의 파일이 다 있고 꼴이 맞는지. 문제 한 줄(없으면 null) */
async function itemProblem(zipped: Zipped, one: store.Stored, entries: ZipItem[]): Promise<string | null> {
  const prefix = `${DIR}${one.id}/`;
  const byName = new Map(entries.map((entry) => [entry.name.slice(prefix.length), entry]));
  const files: Files = { has: (rel) => byName.has(rel), read: (rel, max) => zipped.read(byName.get(rel)!, max) };
  return (await stillsProblem(one, files)) ?? streamsProblem(one, files);
}

/** 파일의 기록(index.json)을 읽는다. 못 읽으면 까닭 */
function indexFrom(zipped: Zipped, entry: ZipItem): { index: store.Index } | { problem: string } {
  if (entry.size > INDEX_MAX_BYTES) return { problem: "배경 기록(index.json)이 너무 큽니다." };
  let json: unknown;
  try {
    json = JSON.parse(zipped.read(entry, INDEX_MAX_BYTES).toString("utf8"));
  } catch {
    return { problem: "배경 기록(index.json)을 읽을 수 없습니다." };
  }
  if (!isTable(json) || !Array.isArray(json.items)) return { problem: "배경 기록(index.json)이 표 꼴이 아닙니다." };
  const items = json.items.map(itemFrom);
  if (items.some((one) => one === null)) return { problem: "다 만든 배경의 꼴이 아닌 기록이 있습니다." };
  const ids = (items as store.Stored[]).map((one) => one.id);
  if (new Set(ids).size !== ids.length) return { problem: "같은 배경이 두 번 적혀 있습니다." };
  const current = typeof json.current === "string" && ids.includes(json.current) ? json.current : null;
  return { index: { current, items: items as store.Stored[], options: store.optionsFrom(json.options), limits: store.limitsFrom(json.limits) } };
}

/** 파일을 검사한다. 파일에 배경 기록이 없으면 null, 걸리면 problems, 지나면 불러올 것 */
async function planOf(zipped: Zipped): Promise<{ problems: string[]; plan: Plan | null; bytes: number } | null> {
  const indexEntry = zipped.entries.find((entry) => entry.name === INDEX_NAME);
  if (!indexEntry) return null;
  const read = indexFrom(zipped, indexEntry);
  if ("problem" in read) return { problems: [read.problem], plan: null, bytes: 0 };
  const files = new Map(read.index.items.map((one) => [one.id, [] as ZipItem[]]));
  const unknown: string[] = [];
  for (const entry of zipped.entries) {
    if (!entry.name.startsWith(DIR) || entry.name === INDEX_NAME || entry.name.endsWith("/")) continue;
    const [id, ...rest] = entry.name.slice(DIR.length).split("/");
    const list = files.get(id);
    if (list && isServed(rest)) list.push(entry);
    else unknown.push(entry.name);
  }
  if (unknown.length) return { problems: [`모르는 파일이 있습니다: ${unknown.slice(0, 3).join(" · ")}${unknown.length > 3 ? ` 외 ${unknown.length - 3}개` : ""}`], plan: null, bytes: 0 };
  const problems: string[] = [];
  for (const one of read.index.items) {
    const problem = await itemProblem(zipped, one, files.get(one.id)!);
    if (problem) problems.push(problem);
  }
  const bytes = [...files.values()].flat().reduce((sum, entry) => sum + entry.size, 0);
  const room = store.room();
  if (bytes > room) problems.push(`저장 공간이 모자랍니다(풀 크기 ${formatBytes(bytes)} · 남은 공간 ${formatBytes(room)}).`);
  return { problems, plan: problems.length ? null : { index: read.index, files }, bytes };
}

// ── 미리 보기 · 불러오기 ──

/** 같은 배경인지 볼 때의 값: 만든 때 · 이름과 내는 파일(이름 · 크기). 불러오면 id 가 새로 붙으니 id 는 보지 않는다 */
const signatureOf = (one: store.Stored, files: Array<[string, number]>) => JSON.stringify([one.at, one.name, [...files].sort(([a], [b]) => a.localeCompare(b))]);

function sameAsNow(plan: Plan): boolean {
  const now = store.items();
  if (now.length !== plan.index.items.length || now.some((one) => !store.isReady(one))) return false;
  const nowSigs = now.map((one) =>
    signatureOf(
      one,
      servedFiles(store.folderOf(one.id)).map((rel) => [rel, fs.statSync(path.join(store.folderOf(one.id), ...rel.split("/"))).size]),
    ),
  );
  const fileSigs = plan.index.items.map((one) =>
    signatureOf(
      one,
      plan.files.get(one.id)!.map((entry) => [entry.name.slice(`${DIR}${one.id}/`.length), entry.size]),
    ),
  );
  const currentSig = (list: string[], ids: string[], current: string | null) => (current ? list[ids.indexOf(current)] : null);
  return (
    [...nowSigs].sort().join("\n") === [...fileSigs].sort().join("\n") &&
    currentSig(
      nowSigs,
      now.map((one) => one.id),
      store.loaded().current,
    ) ===
      currentSig(
        fileSigs,
        plan.index.items.map((one) => one.id),
        plan.index.current,
      )
  );
}

/** 지금 기록이 어떻게 되는지(통째로 바뀐다) */
function warningsFor(plan: Plan): string[] {
  const now = store.items();
  const making = now.filter((one) => !store.isReady(one) && one.problem === null).length;
  return [...(now.length ? [`지금 배경 ${now.length}개를 모두 지우고 파일의 배경으로 바꿔요.`] : []), ...(making ? [`만들고 있는 배경 ${making}개도 멈추고 지워요.`] : []), ...(plan.index.items.length ? [] : ["파일에 배경이 없어 로그인 화면이 봇 프로필 그림으로 돌아가요."])];
}

/** 미리 보기 한 줄과 불러올 것(검사에 걸리면 plan 이 null) */
async function check(file: string): Promise<{ row: ArchiveRow; plan: Plan | null }> {
  const zipped = openZip(file);
  try {
    const checked = await planOf(zipped);
    if (!checked) return { row: { item: "login-background", inFile: false, same: false, problems: [], warnings: [], count: null }, plan: null };
    const count = checked.plan?.index.items.length ?? null;
    const same = checked.plan ? sameAsNow(checked.plan) : false;
    return { row: { item: "login-background", inFile: true, same, problems: checked.problems, warnings: checked.plan ? warningsFor(checked.plan) : [], count }, plan: checked.plan };
  } finally {
    zipped.close();
  }
}

/** 파일의 배경을 새 id 로 저장 자리에 푼다(아직 기록에 없어 보이지 않는다). commit 은 기록을 바꾸고, abort 는 푼 것을 지운다 */
async function stage(file: string, plan: Plan): Promise<{ commit: () => void; abort: () => void }> {
  // 처음 읽을 때 목록에 없는 폴더를 지우므로 먼저 읽어 둔다
  store.loaded();
  const ids = new Map(plan.index.items.map((one) => [one.id, store.newId()]));
  const made: string[] = [];
  const abort = () => {
    for (const id of made) store.removeFolder(id);
  };
  const zipped = openZip(file);
  try {
    for (const one of plan.index.items) {
      const folder = store.folderOf(ids.get(one.id)!);
      made.push(ids.get(one.id)!);
      for (const entry of plan.files.get(one.id)!) {
        const to = path.join(folder, ...entry.name.slice(`${DIR}${one.id}/`.length).split("/"));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        await pipeline(zipped.stream(entry), fs.createWriteStream(to));
      }
    }
  } catch (error) {
    abort();
    throw error;
  } finally {
    zipped.close();
  }
  const commit = () => {
    runner.stopAll();
    const items = plan.index.items.map((one) => {
      const id = ids.get(one.id)!;
      return { ...one, id, bytes: store.folderBytes(id) };
    });
    store.replace({ ...plan.index, current: plan.index.current ? ids.get(plan.index.current)! : null, items });
    runner.kick();
  };
  return { commit, abort };
}

export { exportInputs, check, stage };
export type { Plan };
