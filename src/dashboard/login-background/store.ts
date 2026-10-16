// 로그인 배경의 기록. 배경마다 폴더(database/dashboard/login-background/<id>/)에 파일을 두고, 무엇이 있는지 · 지금 배경 · 화면에서 거는 값 · 한도는 같은 자리의 index.json 에 둔다
// (파비콘과 같은 까닭: 파일과 한 자리라 백업 · 이사 · 불러오기에서 함께 움직인다). 단계를 돌리는 일은 runner.ts 가 하고, 여기는 기록과 그 규칙만 둔다.
// 규칙: 새 배경은 썸네일이 생기면 로그인 화면에 걸린다(그 전에는 쓰던 배경 그대로). 이전 배경은 걸었던 것 중 지금 배경을 빼고 마지막으로 쓴 것이다.
// 한도(보관 개수 · 최대 용량)는 다 구운 기록 중 지금 배경을 뺀 것을 마지막으로 쓴 지 오래된 것부터 지워 지킨다(이전 배경은 가장 나중에 쓴 것이라 맨 마지막).
// 이전 배경의 파일이 지워져도 그것을 보던 화면은 재생이 실패하면 배경 정보를 다시 읽어 지금 배경으로 넘어간다

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "../../infra/project-paths.ts";
import { freeBytesOf } from "../../infra/disk.ts";
import { isCode, type Code } from "../../rules/problems.ts";
import {
  LOGIN_BG_BEFORE_EDIT,
  LOGIN_BG_ENCODE_STAGES,
  LOGIN_BG_HISTORY_MAX,
  LOGIN_BG_ID,
  LOGIN_BG_LIMITS_DEFAULT,
  LOGIN_BG_OPTIONS_DEFAULT,
  LOGIN_BG_STAGES,
  SEAM_KINDS,
  SEAM_SECONDS,
  type LoginBackgroundCodec,
  type LoginBackgroundCrop,
  type LoginBackgroundEdit,
  type LoginBackgroundItem,
  type LoginBackgroundLimits,
  type LoginBackgroundOptions,
  type LoginBackgroundPhase,
  type LoginBackgroundPosition,
  type LoginBackgroundRung,
  type LoginBackgroundScene,
  type LoginBackgroundShows,
  type LoginBackgroundStage,
} from "../contract/login-background.ts";

let dir = path.join(PROJECT.dashboardData, "login-background");
/** 디스크를 꽉 채우지 않게 남겨 둘 크기(설정 DB · 로그가 쓸 자리). 올리기 · 받기 · 굽기가 이만큼은 남긴다 */
const SPACE_MARGIN = 256 * 1024 * 1024;
const INDEX = "index.json";

type Kind = LoginBackgroundItem["kind"];
type From = LoginBackgroundItem["from"];
/** 크기 어림의 기록(편집을 적용하면 지운다) */
type Estimate = { perSecond: number[]; stillBytes: number; crop: LoginBackgroundCrop; counted: [number, number] | null; encodeRatio: number; rough: boolean };
/** 구운 것: 정지 그림 폭 · 대표색 · 장면 색 · 코덱마다의 HLS 단계(공개 응답이 쓴다) */
type Media = { stills: number[]; color: string | null; scenes: LoginBackgroundScene[]; rungs: Partial<Record<LoginBackgroundCodec, LoginBackgroundRung[]>> };
/**
 * 배경 하나의 기록. link 는 링크로 받을 때의 주소(받기 단계가 쓴다), appliedAt 은 편집을 적용한 때(0 이면 아직),
 * stage 는 하던 단계(봇이 다시 켜지면 이어서 한다), resumed 는 다시 켜져 이어서 하는 중
 */
type Stored = {
  id: string;
  kind: Kind;
  from: From;
  name: string;
  link: string | null;
  at: number;
  usedAt: number;
  appliedAt: number;
  bytes: number;
  width: number;
  height: number;
  duration: number;
  fps: number;
  edit: LoginBackgroundEdit | null;
  position: LoginBackgroundPosition;
  stages: LoginBackgroundStage[];
  done: LoginBackgroundStage[];
  stage: LoginBackgroundStage | null;
  resumed: boolean;
  problem: Code | null;
  strip: { count: number; every: number } | null;
  estimate: Estimate | null;
  media: Media;
};
/** index.json 의 꼴 */
type Index = { current: string | null; items: Stored[]; options: LoginBackgroundOptions; limits: LoginBackgroundLimits };

let index: Index | null = null;

const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isStage = (value: unknown): value is LoginBackgroundStage => LOGIN_BG_STAGES.some((one) => one === value);
const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
/** 맞히기 어려운 배경 id(소문자 · 숫자 24자) */
const newId = () => Array.from(crypto.randomBytes(24), (byte) => ID_CHARS[byte % ID_CHARS.length]).join("");

/** 이 배경이 하는 단계. 받기 · 미리보기 · 썸네일 · 정지 그림 · 마무리는 모두, 장면 띠 · 장면 색 · 굽기는 영상만, 고해상도 받기는 유튜브만 */
function stagesOf(kind: Kind, from: From): LoginBackgroundStage[] {
  return LOGIN_BG_STAGES.filter((stage) => {
    if (stage === "highRes") return from === "youtube";
    if (stage === "strip" || stage === "tones" || stage === "h264" || stage === "encode") return kind === "video";
    return true;
  });
}

/** 쓰다 끊겨도 반쪽 파일이 남지 않게 옆에 쓰고 바꿔 끼운다 */
function writeAtomic(file: string, data: string) {
  fs.writeFileSync(`${file}.tmp`, data);
  fs.renameSync(`${file}.tmp`, file);
}

/** 값이 이 꼴인지(index.json 은 사람이 건드리지 않지만 불러오기는 남이 준 파일이다). 못 쓰는 칸은 처음 값으로 */
function optionsFrom(raw: unknown): LoginBackgroundOptions {
  const one = raw as Partial<LoginBackgroundOptions> | null;
  const seam = one?.seam as Partial<LoginBackgroundOptions["seam"]> | undefined;
  const base = LOGIN_BG_OPTIONS_DEFAULT;
  return {
    blur: isNum(one?.blur) ? one.blur : base.blur,
    cover: isNum(one?.cover) ? one.cover : base.cover,
    follow: typeof one?.follow === "boolean" ? one.follow : base.follow,
    seam: {
      kind: SEAM_KINDS.find((kind) => kind === seam?.kind) ?? base.seam.kind,
      seconds: SEAM_SECONDS.find((seconds) => seconds === seam?.seconds) ?? base.seam.seconds,
    },
  };
}

function limitsFrom(raw: unknown): LoginBackgroundLimits {
  const one = raw as Partial<LoginBackgroundLimits> | null;
  return {
    history: isNum(one?.history) && one.history >= 0 && one.history <= LOGIN_BG_HISTORY_MAX ? Math.round(one.history) : LOGIN_BG_LIMITS_DEFAULT.history,
    maxBytes: isNum(one?.maxBytes) && one.maxBytes >= 0 ? Math.round(one.maxBytes) : LOGIN_BG_LIMITS_DEFAULT.maxBytes,
  };
}

const isStageList = (value: unknown) => Array.isArray(value) && value.every(isStage);
const isProblem = (value: unknown) => value === null || (typeof value === "string" && isCode(value));
const isPosition = (value: unknown) => isNum((value as Partial<LoginBackgroundPosition> | null)?.x) && isNum((value as Partial<LoginBackgroundPosition> | null)?.y);

/** 기록 한 줄이 쓸 만한 꼴인지(index.json 은 사람이 건드리지 않지만 불러오기는 남이 준 파일이다) */
function isStored(value: unknown): value is Stored {
  const one = value as Partial<Stored> | null;
  if (!one || typeof one.id !== "string" || !LOGIN_BG_ID.test(one.id) || typeof one.name !== "string") return false;
  const known = ["image", "video"].includes(String(one.kind)) && ["upload", "youtube", "link"].includes(String(one.from));
  const numbers = [one.at, one.usedAt, one.appliedAt, one.bytes, one.width, one.height, one.duration, one.fps].every(isNum);
  const stages = isStageList(one.stages) && isStageList(one.done) && (one.stage === null || isStage(one.stage));
  return known && numbers && stages && isProblem(one.problem) && isPosition(one.position) && Array.isArray(one.media?.stills);
}

/** 기록. 처음 부를 때 index.json 을 읽고(하던 단계가 있으면 이어서 할 것으로 적고, 목록에 없는 폴더는 지운다), 그 뒤로는 바꿀 때 같이 고친다 */
function loaded(): Index {
  if (index) return index;
  let raw: Partial<Index> | null = null;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, INDEX), "utf8")) as Partial<Index>;
  } catch {
    // 아직 없거나 망가졌다: 빈 기록으로
  }
  const items = (Array.isArray(raw?.items) ? raw.items : []).filter(isStored).filter((one) => fs.existsSync(path.join(dir, one.id)));
  for (const one of items) if (one.stage) one.resumed = true;
  const current = items.some((one) => one.id === raw?.current) ? (raw!.current as string) : null;
  index = { current, items, options: optionsFrom(raw?.options), limits: limitsFrom(raw?.limits) };
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    // 아직 하나도 올리지 않았다
  }
  const kept = new Set(items.map((one) => one.id));
  for (const name of names) if (LOGIN_BG_ID.test(name) && !kept.has(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  return index;
}

function save() {
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, INDEX), `${JSON.stringify(loaded(), null, 2)}\n`);
}

const items = () => loaded().items;
const find = (id: string) => (LOGIN_BG_ID.test(id) ? (items().find((one) => one.id === id) ?? null) : null);
/** 배경의 폴더 */
const folderOf = (id: string) => path.join(dir, id);
/** 올리거나 받은 원본(받기 단계가 읽어 보고, 다 구우면 지운다) */
const sourceOf = (id: string) => path.join(folderOf(id), "source");

/** 다 구웠나 */
const isReady = (one: Stored) => one.problem === null && one.edit !== null && one.stages.every((stage) => one.done.includes(stage));
/** 로그인 화면에 걸 수 있는 것이 있나(썸네일) */
const canShow = (one: Stored) => one.problem === null && one.done.includes("thumb");
/** 다음에 할 단계(없으면 null). 편집을 적용하기 전에는 편집 전 단계만 */
function nextStage(one: Stored): LoginBackgroundStage | null {
  const left = one.stages.find((stage) => !one.done.includes(stage)) ?? null;
  if (left === null || one.problem !== null) return null;
  return one.edit === null && !LOGIN_BG_BEFORE_EDIT.includes(left) ? null : left;
}

/** 이전 배경: 로그인 화면에 걸었던 것 중 지금 배경을 빼고 마지막으로 쓴 것 */
function previousId(): string | null {
  const { current } = loaded();
  return (
    items()
      .filter((one) => one.id !== current && canShow(one) && one.usedAt > 0)
      .sort((a, b) => b.usedAt - a.usedAt)[0]?.id ?? null
  );
}

/** 로그인 화면을 이 배경으로(null 이면 봇 프로필 그림). 쓰던 배경과 새 배경에 쓴 때를 적는다 */
function show(id: string | null) {
  const state = loaded();
  const now = Date.now();
  const old = state.current ? find(state.current) : null;
  if (old) old.usedAt = now;
  const next = id ? find(id) : null;
  if (next) next.usedAt = now;
  state.current = next?.id ?? null;
}

/** 썸네일이 생긴 배경을 건다. 그 사이 더 나중에 적용한 배경이 걸렸으면 그대로 */
function showIfLatest(one: Stored) {
  const now = loaded().current ? find(loaded().current!) : null;
  if (!now || one.appliedAt >= now.appliedAt) show(one.id);
}

/** 배경 하나를 기록에서 뺀다(폴더째 지운다). 걸려 있던 배경이면 이전 배경으로 */
function remove(id: string) {
  const state = loaded();
  const back = state.current === id ? previousId() : undefined;
  state.items = state.items.filter((one) => one.id !== id);
  fs.rmSync(folderOf(id), { recursive: true, force: true });
  if (back !== undefined) show(back);
}

/** 한도를 지킨다. 지운 배경의 이름 */
function enforceLimits(): string[] {
  const state = loaded();
  const victims = items()
    .filter((one) => isReady(one) && one.id !== state.current)
    .sort((a, b) => a.usedAt - b.usedAt || a.at - b.at);
  const history = () => items().filter((one) => isReady(one) && one.id !== state.current).length;
  const used = () => items().reduce((sum, one) => sum + one.bytes, 0);
  const removed: string[] = [];
  for (const one of victims) {
    if (history() <= state.limits.history && (!state.limits.maxBytes || used() <= state.limits.maxBytes)) break;
    remove(one.id);
    removed.push(one.name);
  }
  return removed;
}

/** 새 배경의 폴더를 먼저 잡는다(올리는 동안은 기록에 없어 단계가 시작되지 않는다. 끊기면 지우고, 봇이 꺼지면 다음에 읽을 때 지운다) */
function reserve(): string {
  // 처음 읽을 때 목록에 없는 폴더를 지우므로 먼저 읽어 둔다
  loaded();
  const id = newId();
  fs.mkdirSync(folderOf(id), { recursive: true });
  return id;
}

/** 새 배경의 기록(폴더가 없으면 만든다). 종류는 받기 단계가 원본을 읽고 다시 정한다 */
function create(fields: { kind: Kind; from: From; name: string; link?: string; id?: string }): Stored {
  const one: Stored = {
    id: fields.id ?? newId(),
    kind: fields.kind,
    from: fields.from,
    name: fields.name,
    link: fields.link ?? null,
    at: Date.now(),
    usedAt: 0,
    appliedAt: 0,
    bytes: 0,
    width: 0,
    height: 0,
    duration: 0,
    fps: 0,
    edit: null,
    position: { x: 50, y: 50 },
    stages: stagesOf(fields.kind, fields.from),
    done: [],
    stage: null,
    resumed: false,
    problem: null,
    strip: null,
    estimate: null,
    media: { stills: [], color: null, scenes: [], rungs: {} },
  };
  // 처음 읽을 때 목록에 없는 폴더를 지우므로 먼저 읽고 폴더를 만든다
  const index = loaded();
  fs.mkdirSync(folderOf(one.id), { recursive: true });
  index.items.unshift(one);
  return one;
}

/** 폴더의 파일 크기 합 */
function folderBytes(id: string): number {
  let sum = 0;
  const walk = (at: string) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const file = path.join(at, entry.name);
      if (entry.isDirectory()) walk(file);
      else sum += fs.statSync(file).size;
    }
  };
  try {
    walk(folderOf(id));
  } catch {
    // 폴더가 없다
  }
  return sum;
}

/** 배경이 있는 곳. running 은 단계가 도는 중인가 */
function phaseOf(one: Stored, running: boolean): LoginBackgroundPhase {
  if (one.problem !== null) return "failed";
  if (one.edit === null) return LOGIN_BG_BEFORE_EDIT.every((stage) => !one.stages.includes(stage) || one.done.includes(stage)) ? "editing" : "preparing";
  if (isReady(one)) return "ready";
  const next = nextStage(one);
  return !running && next !== null && LOGIN_BG_ENCODE_STAGES.includes(next) ? "queued" : "encoding";
}

/** 로그인 화면에 걸 수 있는 것 */
function showsOf(one: Stored | null): LoginBackgroundShows {
  if (!one || !canShow(one)) return "none";
  if (isReady(one)) return "full";
  return one.done.includes("h264") ? "partial" : "thumb";
}

const freeBytes = () => {
  fs.mkdirSync(dir, { recursive: true });
  return freeBytesOf(dir) ?? 0;
};

/** 테스트: 다른 폴더를 쓰고 읽은 기록을 버린다 */
function _useDir(folder: string) {
  dir = folder;
  index = null;
}

export { SPACE_MARGIN, loaded, save, items, find, folderOf, sourceOf, folderBytes, isReady, canShow, nextStage, previousId, show, showIfLatest, remove, enforceLimits, reserve, create, phaseOf, showsOf, stagesOf, freeBytes, _useDir };
export type { Stored, Estimate, Media };
