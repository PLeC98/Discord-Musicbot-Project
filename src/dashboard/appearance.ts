// 파비콘. 운영자가 패널에서 크기 슬롯마다 올린 그림을 봇의 실행 상태 폴더(database/dashboard/favicon)에 두고 낸다.
// 올린 파일은 그대로 두지 않고 sharp 로 다시 만든다: 슬롯 크기의 png 와 보관본 png(변 FAVICON_RESERVE_SIDE 까지). svg 도 그린 png 로만 둔다(꾸민 svg · 메타데이터가 그대로 나가지 않게).
// 슬롯마다 기록을 FAVICON_HISTORY 개까지 남겨 다시 올리지 않고 교체한다. 무엇이 있는지(슬롯마다 지금 그림 · 기록)는 같은 폴더의 index.json:
// 그림과 한 폴더라 백업 · 이사 · 불러오기에서 함께 움직인다(설정 DB 스냅샷을 복원해도 그림과 어긋나지 않는다).
// 그 크기를 낼 때: 그 슬롯의 지금 그림 > 배율로 가장 가까운 슬롯의 보관본을 줄이거나 늘림 > 봇 프로필 그림을 줄임

import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { PROJECT } from "../infra/project-paths.ts";
import { FAVICON_HISTORY, FAVICON_MIN_SIDE, FAVICON_RESERVE_SIDE, FAVICON_SIZES, type FaviconImage, type FaviconSlot, type FaviconSlots } from "./contract/appearance.ts";
import type { Code, Params } from "../rules/problems.ts";

let dir = path.join(PROJECT.dashboardData, "favicon");
const INDEX = "index.json";
/** 래스터로 받는 형식 */
const RASTERS = ["png", "webp", "jpeg"];
/** 그림 id(파일 이름에 그대로 쓴다) */
const ID = /^[a-z0-9]{8,24}$/;
/** 이 폴더에서 봇이 쓰는 파일: 목록 · 슬롯 크기 png · 보관본 png */
const FILE = /^(index\.json|[a-z0-9]{8,24}(\.reserve)?\.png)$/;

/** 저장한 그림 하나. reserveSide 는 보관본의 변 */
type Stored = FaviconImage & { reserveSide: number };
/** 슬롯 하나: 새것부터의 기록과 지금 쓰는 그림 */
type Slot = { current: string | null; history: Stored[] };
/** index.json 의 형식(슬롯 크기 → 슬롯) */
type Index = { slots: Record<string, Slot> };
/** 올리기의 답: 됐거나, 거절(문제 코드 · 그 값) */
type Added = { ok: true } | { ok: false; code: Code; params?: Params };
type Refused = Extract<Added, { ok: false }>;

let slots: Map<number, Slot> | null = null;
/** 바뀔 때마다 오른다. 화면이 파비콘 주소에 붙여 열린 탭의 아이콘을 교체한다 */
let version = Date.now();
const renders = new Map<string, Buffer>();
let avatar: { url: string; input: Buffer | null } | null = null;

const refused = (code: Code, params?: Params): Refused => ({ ok: false, code, params });
const pngOf = (id: string) => path.join(dir, `${id}.png`);
const reserveOf = (id: string) => path.join(dir, `${id}.reserve.png`);
const newId = () => `${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** 쓰다 끊겨도 반쪽 파일이 남지 않게 옆에 쓰고 교체한다 */
function writeAtomic(file: string, data: Buffer | string) {
  fs.writeFileSync(`${file}.tmp`, data);
  fs.renameSync(`${file}.tmp`, file);
}

/** 기록 한 줄이 쓸 만한 형식인지(index.json 은 사람이 건드리지 않지만 불러오기는 남이 준 파일이다) */
function isStored(value: unknown): value is Stored {
  const one = value as Partial<Stored> | null;
  return !!one && typeof one.id === "string" && ID.test(one.id) && isNum(one.bytes) && isNum(one.width) && isNum(one.height) && typeof one.vector === "boolean" && isNum(one.at) && isNum(one.reserveSide) && one.reserveSide > 0 && one.reserveSide <= FAVICON_RESERVE_SIDE;
}

/** index.json 을 슬롯으로 읽는다. 모르는 크기 · 형식이 틀린 줄은 버리고, 기록은 FAVICON_HISTORY 개까지, 지금 그림이 기록에 없으면 빈 슬롯. has: 그 id 의 파일이 다 있는지 */
function slotsFrom(raw: unknown, has: (id: string) => boolean): Map<number, Slot> {
  const table = (raw as Partial<Index> | null)?.slots;
  return new Map(
    FAVICON_SIZES.map((size) => {
      const one = table && typeof table === "object" ? (table as Record<string, Partial<Slot>>)[String(size)] : undefined;
      const history = (Array.isArray(one?.history) ? one.history : [])
        .filter(isStored)
        .filter((image) => has(image.id))
        .slice(0, FAVICON_HISTORY);
      const current = history.some((image) => image.id === one?.current) ? (one!.current as string) : null;
      return [size, { current, history }];
    }),
  );
}

const indexOf = (map: Map<number, Slot>): Index => ({ slots: Object.fromEntries([...map].map(([size, slot]) => [String(size), slot])) });

/** 슬롯들. 처음 부를 때 폴더에서 읽고(목록에 없는 파일은 삭제한다), 그 뒤로는 바꿀 때 같이 고친다(사람이 건드리지 않는 위치라) */
function loaded(): Map<number, Slot> {
  if (slots) return slots;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    // 아직 하나도 올리지 않았다
  }
  let raw: unknown = null;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, INDEX), "utf8"));
  } catch {
    // 목록이 없거나 망가졌다: 빈 슬롯으로
  }
  const present = new Set(names);
  slots = slotsFrom(raw, (id) => present.has(`${id}.png`) && present.has(`${id}.reserve.png`));
  const kept = new Set([INDEX, ...[...slots.values()].flatMap((slot) => slot.history.flatMap((one) => [`${one.id}.png`, `${one.id}.reserve.png`]))]);
  for (const name of names) if (FILE.test(name) && !kept.has(name)) fs.rmSync(path.join(dir, name), { force: true });
  return slots;
}

function save(map: Map<number, Slot>) {
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, INDEX), `${JSON.stringify(indexOf(map), null, 2)}\n`);
}

function changed() {
  version = Date.now();
  renders.clear();
}

const slotOf = (size: number) => loaded().get(size)!;
const currentOf = (size: number) => {
  const slot = slotOf(size);
  return slot.history.find((one) => one.id === slot.current) ?? null;
};

/** 받은 그림을 본다(형식 · 래스터는 정사각형 · 변). 지나가면 그 크기의 png 와 보관본을 그린다 */
async function inspect(raw: Buffer, size: number): Promise<{ ok: true; image: Stored; png: Buffer; reserve: Buffer } | Refused> {
  const meta = await sharp(raw)
    .metadata()
    .catch(() => null);
  if (!meta) return refused("bad-image");
  const vector = meta.format === "svg";
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!vector && !RASTERS.includes(meta.format ?? "")) return refused("bad-image");
  if (!vector && width !== height) return refused("image-not-square");
  if (!vector && width < FAVICON_MIN_SIDE) return refused("image-too-small", { min: FAVICON_MIN_SIDE });
  // svg 는 낼 크기에 맞는 해상도로 그린다(기본 72dpi 로 그린 뒤 늘이면 흐리다). 정사각형이 아니면 잘라내지 않고 투명 여백으로 채운다
  const draw = (side: number) =>
    sharp(raw, vector ? { density: Math.max(72, Math.ceil((72 * side) / Math.max(1, Math.min(width, height)))) } : {})
      .resize(side, side, { fit: vector ? "contain" : "cover", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  const reserveSide = vector ? FAVICON_RESERVE_SIDE : Math.min(width, FAVICON_RESERVE_SIDE);
  try {
    const [png, reserve] = await Promise.all([draw(size), draw(reserveSide)]);
    return { ok: true, image: { id: newId(), bytes: raw.length, width, height, vector, at: Date.now(), reserveSide }, png, reserve };
  } catch {
    return refused("bad-image");
  }
}

/** 그 크기에 그림을 올린다(정사각형 png · webp · jpeg, 변 16 이상, 또는 svg). 기록 맨 앞에 두어 지금 그림으로 쓰고, 기록을 넘친 옛 그림은 삭제한다 */
async function addFavicon(size: number, raw: Buffer): Promise<Added> {
  const checked = await inspect(raw, size);
  if (!checked.ok) return checked;
  const { image, png, reserve } = checked;
  const map = loaded();
  const slot = map.get(size)!;
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(pngOf(image.id), png);
  writeAtomic(reserveOf(image.id), reserve);
  const history = [image, ...slot.history];
  map.set(size, { current: image.id, history: history.slice(0, FAVICON_HISTORY) });
  save(map);
  for (const old of history.slice(FAVICON_HISTORY)) dropFiles(old.id);
  changed();
  return { ok: true };
}

function dropFiles(id: string) {
  fs.rmSync(pngOf(id), { force: true });
  fs.rmSync(reserveOf(id), { force: true });
}

/** 기록의 그림으로 교체한다. 기록에 없으면 false */
function useFavicon(size: number, id: string): boolean {
  const map = loaded();
  const slot = map.get(size)!;
  if (!slot.history.some((one) => one.id === id)) return false;
  map.set(size, { ...slot, current: id });
  save(map);
  changed();
  return true;
}

/** 슬롯을 비운다(기록은 남긴다). 비어 있었으면 false */
function clearFavicon(size: number): boolean {
  const map = loaded();
  const slot = map.get(size)!;
  if (!slot.current) return false;
  map.set(size, { ...slot, current: null });
  save(map);
  changed();
  return true;
}

/** 기록에서 삭제한다(지금 쓰는 그림이면 슬롯도 빈다). 기록에 없으면 false */
function removeFavicon(size: number, id: string): boolean {
  const map = loaded();
  const slot = map.get(size)!;
  if (!slot.history.some((one) => one.id === id)) return false;
  map.set(size, { current: slot.current === id ? null : slot.current, history: slot.history.filter((one) => one.id !== id) });
  save(map);
  dropFiles(id);
  changed();
  return true;
}

// 빈 슬롯이 빌려 쓸 슬롯: 지금 그림이 있는 슬롯 중 배율로 가장 가까운 슬롯(차이가 아니라 배율: 180 을 낼 때 32 는 5.6 배, 512 는 2.8 배라 512). 같으면 큰 쪽(줄이는 편이 덜 흐리다)
function nearestSlot(size: number): number | null {
  const off = (side: number) => Math.abs(Math.log(side / size));
  let best: number | null = null;
  for (const side of FAVICON_SIZES) if (side !== size && currentOf(side) && (best === null || off(side) < off(best) || (off(side) === off(best) && side > best))) best = side;
  return best;
}

async function cached(key: string, make: () => Promise<Buffer>): Promise<Buffer> {
  const hit = renders.get(key);
  if (hit) return hit;
  const out = await make();
  renders.set(key, out);
  return out;
}

const resized = (input: Buffer, size: number) => sharp(input).resize(size, size, { fit: "cover" }).png().toBuffer();

/** 봇 프로필 그림(다운로드한 것을 기억한다, 주소가 바뀌면 다시 다운로드한다). 없거나 다운로드하지 못하면 null */
async function avatarInput(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  if (avatar?.url === url) return avatar.input;
  let input: Buffer | null = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) input = Buffer.from(await res.arrayBuffer());
  } catch {
    // 디스코드에 닿지 못했다. 다음 요청에서 다시
    return null;
  }
  avatar = { url, input };
  return input;
}

/** 그 크기의 파비콘(png). 그 슬롯의 그림 > 가까운 슬롯의 보관본 > 봇 프로필 그림(avatarUrl). 셋 다 없으면 null */
async function faviconPng(size: number, avatarUrl: string | null): Promise<Buffer | null> {
  const own = currentOf(size);
  if (own) return cached(`own:${own.id}`, async () => fs.readFileSync(pngOf(own.id)));
  const borrow = nearestSlot(size);
  if (borrow !== null) {
    const lent = currentOf(borrow)!;
    return cached(`reserve:${lent.id}:${size}`, async () => resized(fs.readFileSync(reserveOf(lent.id)), size));
  }
  const input = await avatarInput(avatarUrl);
  if (!input || !avatarUrl) return null;
  return cached(`avatar:${avatarUrl}:${size}`, () => resized(input, size));
}

/** 기록의 그림을 슬롯 크기로(미리 보기). 없으면 null */
function previewPng(size: number, id: string): Buffer | null {
  if (!slotOf(size).history.some((one) => one.id === id)) return null;
  return fs.readFileSync(pngOf(id));
}

/** 운영자 패널의 파비콘 상태. hasAvatar: 봇 프로필 그림을 대신 쓸 수 있는지 */
function faviconSlots(hasAvatar: boolean): FaviconSlots {
  const list: FaviconSlot[] = FAVICON_SIZES.map((size) => {
    const slot = slotOf(size);
    const history = slot.history.map(({ id, bytes, width, height, vector, at }) => ({ id, bytes, width, height, vector, at }));
    const base = { size, current: slot.current, history, source: null, sourceSide: null };
    if (slot.current) return { ...base, from: "upload" };
    const borrow = nearestSlot(size);
    if (borrow !== null) return { ...base, from: "scaled", source: borrow, sourceSide: currentOf(borrow)!.reserveSide };
    return { ...base, from: hasAvatar ? "avatar" : "none" };
  });
  return { slots: list, version };
}

const faviconVersion = () => version;

// ── 내보내기 · 가져오기 · 전체 백업 ──

/** 이 폴더에서 봇이 쓰는 파일인지(전체 백업이 담을 것) */
const isFaviconFile = (name: string) => FILE.test(name);

/** 저장한 파일들: index.json 과 그림마다 슬롯 크기 png · 보관본 png(이름은 저장된 그대로) */
function faviconFiles(): Array<{ name: string; data: Buffer }> {
  const map = loaded();
  const images = [...map.values()].flatMap((slot) => slot.history);
  return [{ name: INDEX, data: Buffer.from(`${JSON.stringify(indexOf(map), null, 2)}\n`) }, ...images.flatMap((one) => [`${one.id}.png`, `${one.id}.reserve.png`].map((name) => ({ name, data: fs.readFileSync(path.join(dir, name)) })))];
}

/** 검사를 지나 저장할 모양: 슬롯들과 파일(다시 만든 png) */
type Prepared = { slots: Map<number, Slot>; files: Map<string, Buffer> };
/** 가져온 파일들을 쓸 수 없는 까닭: 목록이 없거나 읽을 수 없음 · 목록에 있는 그림 파일이 없음 · 그림이 망가졌거나 크기가 맞지 않음 */
type FaviconFault = "index" | "missing" | "broken";

/** 그림 하나를 본다: png 로 읽히고 정사각형 side 인지. 지나가면 다시 만든 png(메타데이터를 남기지 않게) */
async function remade(data: Buffer | undefined, side: number): Promise<Buffer | "missing" | "broken"> {
  if (!data) return "missing";
  try {
    const meta = await sharp(data).metadata();
    if (meta.format !== "png" || meta.width !== side || meta.height !== side) return "broken";
    return await sharp(data).png().toBuffer();
  } catch {
    return "broken";
  }
}

/** 가져온 파일들(내보내기의 favicon/ 아래)을 본다. 목록의 그림마다 두 파일이 있고 크기가 맞아야 한다. 지나가면 저장할 모양 */
async function checkFavicons(files: Array<{ name: string; data: Buffer }>): Promise<{ ok: true; prepared: Prepared } | { ok: false; faults: FaviconFault[] }> {
  const byName = new Map(files.map((one) => [one.name, one.data]));
  let raw: unknown;
  try {
    raw = JSON.parse(byName.get(INDEX)?.toString("utf8") ?? "");
  } catch {
    return { ok: false, faults: ["index"] };
  }
  const map = slotsFrom(raw, () => true);
  const out = new Map<string, Buffer>();
  const faults = new Set<FaviconFault>();
  for (const [size, slot] of map)
    for (const one of slot.history)
      for (const [name, side] of [[`${one.id}.png`, size] as const, [`${one.id}.reserve.png`, one.reserveSide] as const]) {
        const png = await remade(byName.get(name), side);
        if (typeof png === "string") faults.add(png);
        else out.set(name, png);
      }
  return faults.size ? { ok: false, faults: [...faults] } : { ok: true, prepared: { slots: map, files: out } };
}

/** 슬롯들을 가져온 것으로 통째 바꾼다(가져오기, 검사는 checkFavicons 로 먼저) */
function replaceFavicons({ slots: next, files }: Prepared) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, data] of files) writeAtomic(path.join(dir, name), data);
  save(next);
  const kept = new Set([INDEX, ...files.keys()]);
  for (const name of fs.readdirSync(dir)) if (FILE.test(name) && !kept.has(name)) fs.rmSync(path.join(dir, name), { force: true });
  slots = next;
  changed();
}

/** 올린 파비콘 그림 수(크기마다의 기록, 초기화 카드) */
function faviconCount(): number {
  return [...loaded().values()].reduce((sum, slot) => sum + slot.history.length, 0);
}

/** 파비콘을 모두 비운다(디스플레이 설정 초기화). 지운 그림 수 */
function clearFavicons(): number {
  const removed = faviconCount();
  replaceFavicons({ slots: slotsFrom(null, () => false), files: new Map() });
  return removed;
}

/** 테스트: 저장 폴더를 바꾸고 읽어 둔 것을 비운다 */
function _useDir(folder: string) {
  dir = folder;
  slots = null;
  avatar = null;
  changed();
}

export { addFavicon, useFavicon, clearFavicon, removeFavicon, faviconPng, previewPng, faviconSlots, faviconVersion, isFaviconFile, faviconFiles, checkFavicons, replaceFavicons, faviconCount, clearFavicons, _useDir };
export type { Added, FaviconFault, Prepared };
