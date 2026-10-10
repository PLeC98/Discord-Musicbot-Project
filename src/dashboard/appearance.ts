// 꾸미기(파비콘). 운영자가 패널에서 올린 그림을 봇의 실행 상태 폴더(database/dashboard/favicon)에 두고, 크기마다 그려 낸다.
// 받은 파일은 그대로 두지 않고 sharp 로 다시 만든다(래스터는 png: 메타데이터가 그대로 나가지 않게. svg 는 그려 보아 깨지지 않았는지 보고, 밖으로는 그린 png 만 낸다).
// 크기마다 꼭 맞는 정사각형 그림이 있으면 그대로, 없으면 가장 가까운 그림을 늘이거나 줄여서, 하나도 없으면 봇 프로필 그림을 받아 줄여서 낸다

import fs from "fs";
import path from "path";
import sharp from "sharp";
import { PROJECT } from "../infra/project-paths.ts";
import { FAVICON_MAX_UPLOADS, FAVICON_MIN_SIDE, FAVICON_SIZES, type Appearance, type FaviconUse } from "./contract/appearance.ts";
import type { Code, Params } from "../rules/problems.ts";

let dir = path.join(PROJECT.dashboardData, "favicon");
/** 래스터로 받는 형식 */
const RASTERS = ["png", "webp", "jpeg"];

/** 그림 하나. id 는 변(px) 또는 "svg". side 는 짧은 변, vector 는 svg(어느 크기로나 그대로 그린다) */
type Source = { id: string; input: Buffer; side: number; square: boolean; vector: boolean };
/** 올리기의 답: 됐거나, 거절(문제 코드 · 그 값) */
type Added = { ok: true } | { ok: false; code: Code; params?: Params };

let uploads: Source[] | null = null;
/** 바뀔 때마다 오른다. 화면이 파비콘 주소에 붙여 열린 탭의 아이콘을 바꿔 끼운다 */
let version = Date.now();
const renders = new Map<string, Buffer>();
let avatar: { url: string; source: Source | null } | null = null;

async function sourceOf(id: string, input: Buffer, vector: boolean): Promise<Source> {
  const { width = 0, height = 0 } = await sharp(input).metadata();
  return { id, input, side: Math.min(width, height), square: width === height, vector };
}

/** 올린 그림들. 처음 부를 때 폴더에서 읽고, 그 뒤로는 바꿀 때 같이 고친다(사람이 건드리지 않는 자리라) */
async function sources(): Promise<Source[]> {
  if (uploads) return uploads;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((name) => /^(\d+\.png|svg\.svg)$/.test(name));
  } catch {
    // 아직 하나도 올리지 않았다
  }
  uploads = await Promise.all(names.map((name) => sourceOf(path.parse(name).name, fs.readFileSync(path.join(dir, name)), name.endsWith(".svg"))));
  return uploads;
}

const fileOf = (id: string) => path.join(dir, id === "svg" ? "svg.svg" : `${id}.png`);

function changed() {
  version = Date.now();
  renders.clear();
}

type Refused = Extract<Added, { ok: false }>;
const refused = (code: Code, params?: Params): Refused => ({ ok: false, code, params });

/** 받은 그림을 본다(형식 · 정사각형 · 크기). 지나가면 저장할 모양: 래스터는 png 로 다시 만들고, svg 는 그려 보아 깨진 것을 거른다 */
/** 검사를 지난 그림. input 은 저장할 모양(래스터는 png 로 다시 만든 것) */
type Inspected = { ok: true; id: string; vector: boolean; input: Buffer };

async function inspect(raw: Buffer): Promise<Inspected | Refused> {
  const meta = await sharp(raw)
    .metadata()
    .catch(() => null);
  if (!meta) return refused("bad-image");
  const vector = meta.format === "svg";
  const side = meta.width ?? 0;
  if (!vector && !RASTERS.includes(meta.format ?? "")) return refused("bad-image");
  if (!vector && side !== meta.height) return refused("image-not-square");
  if (!vector && side < FAVICON_MIN_SIDE) return refused("image-too-small", { min: FAVICON_MIN_SIDE });
  try {
    const png = await sharp(raw).png().toBuffer();
    return { ok: true, id: vector ? "svg" : String(side), vector, input: vector ? raw : png };
  } catch {
    return refused("bad-image");
  }
}

/** 파비콘 그림 하나를 올린다. 정사각형 png · webp · jpeg(변 16 이상) 또는 svg. 같은 변(svg 는 svg)이 있으면 바꾼다 */
async function addFavicon(raw: Buffer): Promise<Added> {
  const image = await inspect(raw);
  if (!image.ok) return image;
  const { id, vector, input } = image;
  const list = await sources();
  if (!list.some((one) => one.id === id) && list.length >= FAVICON_MAX_UPLOADS) return refused("too-many-favicons", { max: FAVICON_MAX_UPLOADS });

  // 쓰다 끊겨도 반쪽 파일이 남지 않게 옆에 쓰고 바꿔 끼운다
  fs.mkdirSync(dir, { recursive: true });
  const file = fileOf(id);
  fs.writeFileSync(`${file}.tmp`, input);
  fs.renameSync(`${file}.tmp`, file);
  const source = await sourceOf(id, input, vector);
  uploads = [...list.filter((one) => one.id !== id), source];
  changed();
  return { ok: true };
}

/** 올린 그림 하나를 지운다. 없으면 false */
async function removeFavicon(id: string): Promise<boolean> {
  const list = await sources();
  if (!list.some((one) => one.id === id)) return false;
  fs.rmSync(fileOf(id), { force: true });
  uploads = list.filter((one) => one.id !== id);
  changed();
  return true;
}

// ── 내보내기 · 가져오기 ──

/** 올린 그림 파일들(이름은 저장된 그대로: 변.png · svg.svg) */
async function faviconFiles(): Promise<Array<{ name: string; data: Buffer }>> {
  return (await sources()).map((one) => ({ name: path.basename(fileOf(one.id)), data: one.input }));
}

/** 받은 그림 묶음을 본다. 올릴 때와 같은 검사, 같은 변이 둘이면 뒤의 것. 지나가면 저장할 모양 */
async function checkFavicons(raws: Buffer[]): Promise<{ ok: true; images: Inspected[] } | { ok: false; problems: Refused[] }> {
  const checked = await Promise.all(raws.map(inspect));
  const problems = checked.filter((one): one is Refused => !one.ok);
  if (problems.length) return { ok: false, problems };
  const images = [...new Map(checked.filter((one): one is Inspected => one.ok).map((one) => [one.id, one])).values()];
  if (images.length > FAVICON_MAX_UPLOADS) return { ok: false, problems: [refused("too-many-favicons", { max: FAVICON_MAX_UPLOADS })] };
  return { ok: true, images };
}

/** 올린 그림을 받은 것으로 통째 바꾼다(가져오기, 검사는 checkFavicons 로 먼저) */
async function replaceFavicons(images: Inspected[]) {
  for (const one of await sources()) fs.rmSync(fileOf(one.id), { force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const { id, input } of images) {
    const file = fileOf(id);
    fs.writeFileSync(`${file}.tmp`, input);
    fs.renameSync(`${file}.tmp`, file);
  }
  uploads = await Promise.all(images.map(({ id, input, vector }) => sourceOf(id, input, vector)));
  changed();
}

// 가장 가까운 그림: 차이가 아니라 배율로 잰다(180 을 낼 때 32 는 5.6 배, 512 는 2.8 배라 512). 같으면 큰 쪽(줄이는 편이 덜 흐리다). svg 가 있으면 늘 그것
function nearest(list: Source[], want: number) {
  const vector = list.find((one) => one.vector);
  if (vector) return vector;
  const off = (one: Source) => Math.abs(Math.log(one.side / want));
  return list.reduce((best, one) => (off(one) < off(best) || (off(one) === off(best) && one.side > best.side) ? one : best));
}

async function render(source: Source, size: number, key: string): Promise<Buffer> {
  // 꼭 맞는 정사각형 png 는 손대지 않고 그대로(올릴 때 png 로 다시 만들었다)
  if (!source.vector && source.square && source.side === size) return source.input;
  const hit = renders.get(key);
  if (hit) return hit;
  // svg 는 낼 크기에 맞는 해상도로 그린다(기본 72dpi 로 그린 뒤 늘이면 흐리다). 정사각형이 아니면 잘라내지 않고 투명 여백으로 채운다
  const density = source.vector ? Math.max(72, Math.ceil((72 * size) / source.side)) : undefined;
  const out = await sharp(source.input, density ? { density } : {})
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  renders.set(key, out);
  return out;
}

/** 봇 프로필 그림(받은 것을 기억한다, 주소가 바뀌면 다시 받는다). 없거나 못 받으면 null */
async function avatarSource(url: string | null): Promise<Source | null> {
  if (!url) return null;
  if (avatar?.url === url) return avatar.source;
  let source: Source | null = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) source = await sourceOf("avatar", Buffer.from(await res.arrayBuffer()), false);
  } catch {
    // 디스코드에 닿지 못했다. 다음 요청에서 다시
    return null;
  }
  avatar = { url, source };
  return source;
}

/** 그 크기의 파비콘(png). 올린 그림이 없으면 봇 프로필 그림(avatarUrl)으로. 둘 다 없으면 null */
async function faviconPng(size: number, avatarUrl: string | null): Promise<Buffer | null> {
  const list = await sources();
  if (list.length) {
    const source = nearest(list, size);
    return render(source, size, `${source.id}:${size}`);
  }
  const source = await avatarSource(avatarUrl);
  return source && render(source, size, `avatar:${avatarUrl}:${size}`);
}

/** 올린 그림의 미리 보기(png, 128 안쪽). svg 도 그려서 낸다(올린 svg 를 그대로 내지 않는다). 없으면 null */
async function previewPng(id: string): Promise<Buffer | null> {
  const one = (await sources()).find((source) => source.id === id);
  if (!one) return null;
  const size = one.vector ? 128 : Math.min(128, one.side);
  return render(one, size, `preview:${id}:${size}`);
}

/** 운영자 패널의 꾸미기 상태. hasAvatar: 봇 프로필 그림을 대신 쓸 수 있는지 */
async function appearance(hasAvatar: boolean): Promise<Appearance> {
  const list = await sources();
  const sizes: FaviconUse[] = FAVICON_SIZES.map((size) => {
    if (!list.length) return { size, from: hasAvatar ? "avatar" : "none", upload: null };
    const one = nearest(list, size);
    return { size, from: one.vector || one.side === size ? "exact" : "resized", upload: one.id };
  });
  const uploadsView = list.map((one) => ({ id: one.id, side: one.vector ? null : one.side, bytes: one.input.length })).sort((a, b) => (a.side ?? Infinity) - (b.side ?? Infinity));
  return { favicon: { uploads: uploadsView, sizes, version } };
}

const faviconVersion = () => version;

/** 시험: 저장 폴더를 바꾸고 읽어 둔 것을 비운다 */
function _useDir(folder: string) {
  dir = folder;
  uploads = null;
  avatar = null;
  changed();
}

export { addFavicon, removeFavicon, faviconPng, previewPng, appearance, faviconVersion, faviconFiles, checkFavicons, replaceFavicons, _useDir };
export type { Added, Inspected };
