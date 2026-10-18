// 설정 내보내기 · 불러오기. ZIP 하나: settings.json(사람이 읽는 JSON) + 파비콘이면 favicon/(파비콘 폴더 그대로: index.json · 이미지 png). 계약은 contract/settings-archive.
//   settings  봇 설정만: 운영 조절값(PC 에 매인 쿠키 출처 · POToken 쓰기도) · 장르 · 활동 문구 · AI 설정 · 프롬프트. 서버별 설정 · 키 · 쿠키는 없다(설정 스냅샷 · 명령 전체 백업에 든다).
//   favicon   파비콘: 슬롯 · 기록(봇 설정 백업에는 들지 않는다. 예전에 봇 설정과 함께 내보낸 파일의 파비콘도 불러온다)
//   login-background  로그인 배경: 다 만든 배경 · 화면 값 · 한도(login-background/archive). 불러오면 통째로 바꾼다
//   audio-cache  오디오 캐시: 캐시 파일 · 링크 데이터 · 직접 지정한 음원 · 연령 제한 · SponsorBlock 구간(audio-cache-archive). 불러오면 지금 캐시에 합친다
// 내보내기는 담을 항목을 넘기고 경로가 스트리밍으로 쓴다(writeZip). 불러올 파일은 올린 파일(archive-uploads)을 열어 목차만 읽고 필요한 항목만 메모리로 읽는다
// .env 는 어느 쪽에도 없다. 대시보드는 비밀을 읽어 내지도, .env 를 쓰지도 않는다(그건 봇 폴더의 몫: scripts/backup).
// 불러오기는 선택한 항목을 모두 저장과 같은 검사로 먼저 보고, DB 는 한 트랜잭션으로 쓴다(하나라도 틀리면 아무것도 바꾸지 않는다).
// 로그인 배경은 DB 앞에 풀어 두고(실패하면 푼 것만 삭제한다), 파비콘 · 로그인 배경은 DB 뒤에 교체한다.
// 남이 준 파일일 수 있으니 바깥으로 나가는 값(AI 요청이 가는 곳 · 봇 웹사이트 주소) · PC 에 매인 값(쿠키 출처 · POToken)이 바뀌면 미리 보기가 표시해 준다.
// 불러온 뒤 다시 시작해야 적용되는 값이 바뀌었거나 쿠키 출처가 바뀌었으면 답이 알린다(화면이 다시 시작 창 · 유튜브 탭 안내를 연다).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openZip, type ZipInput } from "../infra/zip.ts";
import { BOT_VERSION } from "../infra/version.ts";
import { codedError } from "../rules/error-kind.ts";
import * as documents from "../config/documents.ts";
import { genreProblems } from "../config/schema/genres.ts";
import { statusProblems } from "../config/schema/status.ts";
import { aiProblems, aiSwitchedOff } from "../config/schema/ai.ts";
import { promptProblems } from "../config/schema/ai-prompt.ts";
import * as tunables from "../store/tunables.ts";
import * as settingsDocs from "../store/settings-docs.ts";
import { settingsDb } from "../store/settings-db.ts";
import * as appearance from "./appearance.ts";
import * as loginBackground from "./login-background/archive.ts";
import * as audioArchive from "./audio-cache-archive.ts";
import type { ArchiveImported, ArchiveItem, ArchiveKind, ArchivePreview, ArchiveRow } from "./contract/settings-archive.ts";
import { ARCHIVE_ITEMS, ARCHIVE_KINDS } from "./contract/settings-archive.ts";

const FORMAT = 1;
const JSON_NAME = "settings.json";
const FAVICON_DIR = "favicon/";
// settings.json 하나의 상한. 설정 문서는 크지 않다(장르 수십 개 · 프롬프트 몇 KB)
const JSON_MAX_BYTES = 4 * 1024 * 1024;
// 파비콘 파일을 모두 합친 상한(슬롯 일곱 × 기록 여섯 × png 두 장 남짓)
const FAVICON_MAX_BYTES = 64 * 1024 * 1024;
// 그 PC 에 매인 운영 조절값. 담고 불러오되, 바뀌면 미리 보기가 알린다
// (쿠키 출처를 남이 정하면 봇이 이 PC 의 브라우저 쿠키를 읽는다. POToken 은 설치 여부에 매인다)
const COOKIES_KEY = "COOKIES_SOURCE";
const POTOKEN_KEY = "BGUTIL_ENABLED";

type DocItem = Extract<ArchiveItem, documents.DocName>;
const DOC_ITEMS: readonly DocItem[] = ["genres", "status", "ai", "ai-prompt"];
const isDocItem = (item: ArchiveItem): item is DocItem => (DOC_ITEMS as readonly string[]).includes(item);
/** 설정 DB 가 아니라 저장 위치의 파일 · 캐시 DB 인 항목(스냅샷을 뜨지 않는다) */
const FILE_ITEMS: readonly ArchiveItem[] = ["favicon", "login-background", ...audioArchive.AUDIO_ITEMS];

/** settings.json 의 형식. 읽을 때는 필드마다 따로 본다(빠진 필드는 그 항목이 파일에 없는 것) */
type ArchiveJson = {
  format: number;
  kind: ArchiveKind;
  exportedAt: string;
  botVersion: string;
  /** settings 만 */
  tunables?: Record<string, string>;
  documents?: Partial<Record<DocItem, unknown>>;
  /** favicon 만(예전 파일은 settings 에도). 함께 담은 파비콘 파일 이름(favicon/ 아래, index.json 과 이미지 png). index.json 이 없으면 파비콘이 없는 파일로 본다 */
  favicons?: string[];
};

/** 읽은 파일. favicons 는 favicon/ 아래 파일들, file 은 올린 파일(로그인 배경은 거기서 스트리밍으로 읽는다) */
type Parsed = { json: Partial<ArchiveJson>; favicons: Array<{ name: string; data: Buffer }>; file: string };

const badArchive = (why: string) => codedError("BAD_ARCHIVE", why);
const isTable = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const digest = (data: Buffer) => crypto.createHash("sha256").update(data).digest("hex");

/** 다운로드할 파일 이름(종류 · 만든 때) */
function fileName(kind: ArchiveKind, at = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `musicbot-${kind}-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.zip`;
}

const manifest = (kind: ArchiveKind, rest: Partial<ArchiveJson>): ArchiveJson => ({ format: FORMAT, kind, exportedAt: new Date().toISOString(), botVersion: BOT_VERSION, ...rest });
const jsonEntry = (json: ArchiveJson) => ({ name: JSON_NAME, data: Buffer.from(`${JSON.stringify(json, null, 2)}\n`) });

const KEEP_NOTHING = () => undefined;

/**
 * 지금 설정 중 그 종류를 ZIP 에 담을 항목으로(경로가 스트리밍으로 쓴다). release 는 다 보냈거나 끊겼을 때 부른다(오디오 캐시가 담을 파일을 지키는 것을 푼다)
 * @param withFiles  오디오 캐시: 캐시 파일까지(아니면 행 목록만)
 */
function build(kind: ArchiveKind, { withFiles = true }: { withFiles?: boolean } = {}): { inputs: ZipInput[]; release: () => void } {
  if (kind === "audio-cache") {
    const audio = audioArchive.exportInputs({ withFiles });
    return { inputs: [jsonEntry(manifest(kind, {})), ...audio.inputs], release: audio.release };
  }
  if (kind === "login-background") return { inputs: [jsonEntry(manifest(kind, {})), ...loginBackground.exportInputs()], release: KEEP_NOTHING };
  if (kind === "favicon") {
    const favicons = appearance.faviconFiles();
    return { inputs: [jsonEntry(manifest(kind, { favicons: favicons.map((one) => one.name) })), ...favicons.map((one) => ({ name: FAVICON_DIR + one.name, data: one.data }))], release: KEEP_NOTHING };
  }
  return { inputs: [jsonEntry(manifest(kind, { tunables: tunables.view().values, documents: Object.fromEntries(DOC_ITEMS.map((name) => [name, documents.get(name)])) }))], release: KEEP_NOTHING };
}

/** 올린 파일을 읽는다(목차와 settings.json · 파비콘만 메모리로). 이 봇의 내보내기가 아니면 BAD_ARCHIVE(ZIP 자체가 깨졌으면 BAD_ZIP) */
function parse(file: string): Parsed {
  const zipped = openZip(file);
  try {
    const entry = zipped.entries.find((one) => one.name === JSON_NAME);
    if (!entry) throw badArchive(`${JSON_NAME} 이 없습니다. 이 봇의 설정 내보내기 파일이 아닙니다.`);
    if (entry.size > JSON_MAX_BYTES) throw badArchive(`${JSON_NAME} 이 너무 큽니다.`);
    let json: unknown;
    try {
      json = JSON.parse(zipped.read(entry, JSON_MAX_BYTES).toString("utf8"));
    } catch {
      throw badArchive(`${JSON_NAME} 이 JSON 이 아닙니다.`);
    }
    if (!isTable(json)) throw badArchive(`${JSON_NAME} 이 객체 형식이 아닙니다.`);
    if (json.format !== FORMAT) throw badArchive(`모르는 형식입니다(format ${String(json.format)}). 이 봇이 읽는 형식은 ${FORMAT} 입니다.`);
    const faviconEntries = zipped.entries.filter((one) => one.name.startsWith(FAVICON_DIR) && one.name.length > FAVICON_DIR.length);
    if (faviconEntries.reduce((sum, one) => sum + one.size, 0) > FAVICON_MAX_BYTES) throw badArchive("파비콘 파일이 너무 큽니다.");
    const favicons = faviconEntries.map((one) => ({ name: one.name.slice(FAVICON_DIR.length), data: zipped.read(one, FAVICON_MAX_BYTES) }));
    return { json: json as Partial<ArchiveJson>, favicons, file };
  } finally {
    zipped.close();
  }
}

// 같은지 볼 때 필드 순서에 흔들리지 않게 키를 정렬해 문자열로
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

// ── 항목마다의 미리 보기 ──

const absent = (item: ArchiveItem): ArchiveRow => ({ item, inFile: false, same: false, problems: [], warnings: [], count: null });

const textOf = (values: Record<string, unknown>, key: string) => (typeof values[key] === "string" ? (values[key] as string) : "");
// 쿠키 출처의 이름(빈 값은 쓰지 않음, file 은 직접 입력, 그 밖은 브라우저 이름)
const cookiesName = (value: string) => (value === "" ? "쓰지 않음" : value === "file" ? "쿠키 직접 입력" : value);

function tunablesRow(json: Partial<ArchiveJson>): ArchiveRow {
  if (!isTable(json.tunables)) return absent("tunables");
  const value = json.tunables;
  const now = tunables.view().values;
  const warnings: string[] = [];
  const [website, cookies] = [textOf(value, "WEBSITE"), textOf(value, COOKIES_KEY)];
  if (website !== (now.WEBSITE ?? "")) warnings.push(website ? `봇 웹사이트 주소가 바뀌어요: ${website}` : "봇 웹사이트 주소가 비워져요.");
  if (cookies !== (now[COOKIES_KEY] ?? "")) warnings.push(`쿠키 출처가 바뀌어요: ${cookiesName(now[COOKIES_KEY] ?? "")} → ${cookiesName(cookies)}`);
  if (textOf(value, POTOKEN_KEY) !== (now[POTOKEN_KEY] ?? "")) warnings.push("POToken 사용이 바뀌어요(다시 시작해야 적용돼요)");
  return { item: "tunables", inFile: true, same: stable(value) === stable(now), problems: tunables.problemsOf(value), warnings, count: null };
}

/** 문서 하나의 검사. 프롬프트는 AI 를 켠 설정과 함께일 때만 {{list}} 를 따진다 */
function docProblems(item: DocItem, data: unknown, aiDoc: unknown): string[] {
  if (item === "ai-prompt") return Array.isArray(data) ? promptProblems(data, !aiSwitchedOff(aiDoc)) : ["프롬프트가 섹션 목록이 아닙니다."];
  if (!isTable(data)) return ["객체 형식이 아닙니다."];
  return { genres: genreProblems, status: statusProblems, ai: aiProblems }[item](data);
}

// AI 요청이 가는 곳: 직접 적는 주소(custom)는 그 호스트, 나머지는 프로바이더 이름
function aiTarget(doc: unknown) {
  if (!isTable(doc) || aiSwitchedOff(doc) || !doc.provider || doc.provider === "off") return "";
  if (doc.provider !== "custom") return String(doc.provider);
  try {
    return new URL(String(doc.baseUrl)).host;
  } catch {
    return String(doc.baseUrl ?? "");
  }
}

const linksIn = (value: unknown) => new Set(JSON.stringify(value ?? null).match(/https?:\/\/[^\s"'\\]+/g) ?? []);

/** 바깥으로 나가는 값이 바뀌는지(남이 준 파일로 모르고 가져오지 않게) */
function docWarnings(item: DocItem, value: unknown): string[] {
  if (item === "ai") {
    const before = aiTarget(documents.get("ai"));
    const after = aiTarget(value);
    return after && after !== before ? [`AI 요청이 가는 곳이 바뀌어요: ${after}`] : [];
  }
  if (item === "status") {
    const known = linksIn(documents.get("status"));
    const added = [...linksIn(value)].filter((link) => !known.has(link));
    return added.length ? [`활동 문구에 새 링크가 들어와요: ${added.join(" · ")}`] : [];
  }
  return [];
}

function docRow(item: DocItem, json: Partial<ArchiveJson>, aiDoc: unknown): ArchiveRow {
  const docs = isTable(json.documents) ? json.documents : {};
  if (!(item in docs)) return absent(item);
  const value = docs[item];
  return { item, inFile: true, same: stable(value) === stable(documents.get(item)), problems: docProblems(item, value, aiDoc), warnings: docWarnings(item, value), count: null };
}

// 파비콘 검사에 걸린 까닭을 한 줄로
const FAVICON_WHY: Record<appearance.FaviconFault, string> = {
  index: "파비콘 목록(index.json)을 읽을 수 없습니다.",
  missing: "목록에 있는 이미지 파일이 빠져 있습니다.",
  broken: "망가졌거나 크기가 맞지 않는 이미지가 있습니다.",
};

/** 파일에 파비콘이 있는지: 목록(index.json)이 함께 담겼어야 한다 */
const hasFavicons = (parsed: Parsed) => Array.isArray(parsed.json.favicons) && parsed.favicons.some((one) => one.name === "index.json");

async function faviconRow(parsed: Parsed): Promise<ArchiveRow> {
  if (!hasFavicons(parsed)) return absent("favicon");
  const checked = await appearance.checkFavicons(parsed.favicons);
  const problems = checked.ok ? [] : checked.faults.map((one) => FAVICON_WHY[one]);
  const now = appearance
    .faviconFiles()
    .map((one) => digest(one.data))
    .sort();
  const theirs = parsed.favicons.map((one) => digest(one.data)).sort();
  // 이미지마다 보관본이 하나씩이라 그 수가 이미지 수
  const count = parsed.favicons.filter((one) => one.name.endsWith(".reserve.png")).length;
  return { item: "favicon", inFile: true, same: stable(now) === stable(theirs), problems, warnings: [], count };
}

// 프롬프트를 따질 때 볼 AI 설정: 파일의 것을 함께 가져오면 그것, 아니면 지금 것
function aiDocFor(json: Partial<ArchiveJson>, takingAi: boolean) {
  const fromFile = isTable(json.documents) ? json.documents.ai : undefined;
  return takingAi && fromFile !== undefined ? fromFile : documents.get("ai");
}

// 항목 하나의 미리 보기
async function rowFor(item: ArchiveItem, parsed: Parsed, aiDoc: unknown): Promise<ArchiveRow> {
  if (item === "tunables") return tunablesRow(parsed.json);
  if (item === "favicon") return faviconRow(parsed);
  if (item === "login-background") return (await loginBackground.check(parsed.file)).row;
  if (!isDocItem(item)) return absent(item);
  return docRow(item, parsed.json, aiDoc);
}

/** 파일의 종류(모르는 종류는 봇 설정만으로 본다) */
const kindOf = (json: Partial<ArchiveJson>): ArchiveKind => ARCHIVE_KINDS.find((kind) => kind === json.kind) ?? "settings";
/** 그 종류의 항목(예전에 봇 설정과 함께 내보낸 파비콘이 있으면 그것도) */
function itemsOf(parsed: Parsed): ArchiveItem[] {
  const kind = kindOf(parsed.json);
  if (kind === "audio-cache") return [...audioArchive.AUDIO_ITEMS];
  if (kind === "favicon" || kind === "login-background") return [kind];
  const items = ARCHIVE_ITEMS.filter((item) => !FILE_ITEMS.includes(item));
  return hasFavicons(parsed) ? [...items, "favicon"] : items;
}

/** 파일을 읽어 항목마다 지금과 같은지 · 검사 문제 · 바깥으로 나가는 값의 변화를 본다. 아무것도 바꾸지 않는다 */
async function preview(file: string): Promise<Omit<ArchivePreview, "token">> {
  const parsed = parse(file);
  const { json } = parsed;
  const head = { kind: kindOf(json), exportedAt: typeof json.exportedAt === "string" ? json.exportedAt : null, botVersion: typeof json.botVersion === "string" ? json.botVersion : null };
  if (head.kind === "audio-cache") return { ...head, rows: audioArchive.previewRows(audioArchive.readBundle(file)), room: audioArchive.roomForCache() };
  const aiDoc = aiDocFor(json, true);
  return { ...head, rows: await Promise.all(itemsOf(parsed).map((item) => rowFor(item, parsed, aiDoc))) };
}

/** 항목 이름(검사 문제 · 로그) */
const ITEM_LABELS: Record<ArchiveItem, string> = {
  tunables: "운영 조절값",
  genres: "자동재생 장르",
  status: "활동 문구",
  ai: "AI 설정",
  "ai-prompt": "AI 프롬프트",
  favicon: "파비콘",
  "login-background": "로그인 배경",
  "audio-files": "캐시 파일",
  "audio-ledger": "자동 검색 결과",
  "audio-pins": "직접 지정한 음원",
  "audio-age": "연령 제한 기록",
  "audio-sponsorblock": "SponsorBlock 구간",
};

// 선택한 항목이 모두 파일에 있고 검사를 지나는지. 아니면 CONFIG_INVALID(problems: "항목: 까닭"). 지나면 저장할 파비콘 · 불러올 로그인 배경(선택하지 않았으면 null)
async function checkChosen(parsed: Parsed, items: ArchiveItem[]): Promise<{ favicons: appearance.Prepared | null; background: loginBackground.Plan | null }> {
  const aiDoc = aiDocFor(parsed.json, items.includes("ai"));
  const background = items.includes("login-background") ? await loginBackground.check(parsed.file) : null;
  // 오디오 캐시 항목은 오디오 캐시 파일에만 있다(행 목록이 없는 파일이면 읽기가 BAD_ARCHIVE)
  const audioRows = items.some(audioArchive.isAudioItem) ? (kindOf(parsed.json) === "audio-cache" ? audioArchive.previewRows(audioArchive.readBundle(parsed.file)) : []) : [];
  const audioRow = (item: ArchiveItem) => audioRows.find((one) => one.item === item) ?? { item, inFile: false, same: false, problems: [], warnings: [], count: null };
  const rows = await Promise.all(items.map((item) => (item === "login-background" ? background!.row : audioArchive.isAudioItem(item) ? audioRow(item) : rowFor(item, parsed, aiDoc))));
  const problems = rows.flatMap((row) => [...(row.inFile ? [] : ["파일에 없습니다."]), ...row.problems].map((line) => `${ITEM_LABELS[row.item]}: ${line}`));
  if (problems.length) throw Object.assign(codedError("CONFIG_INVALID", problems.join("\n")), { problems });
  const checked = items.includes("favicon") ? await appearance.checkFavicons(parsed.favicons) : null;
  return { favicons: checked?.ok ? checked.prepared : null, background: background?.plan ?? null };
}

// DB 에 쓴다(한 트랜잭션)
function writeChosen(json: Partial<ArchiveJson>, items: ArchiveItem[]) {
  const docs = isTable(json.documents) ? json.documents : {};
  const docItems = items.filter(isDocItem);
  settingsDb.get().transaction(() => {
    if (docItems.length) settingsDocs.writeAll(docItems.map((name) => ({ name, data: docs[name], revision: settingsDocs.read(name).revision })));
    if (items.includes("tunables")) tunables.writeRaw(isTable(json.tunables) ? json.tunables : {});
  })();
  return docItems;
}

/**
 * 선택한 항목을 덮어쓴다. 파일에 없거나 검사에 걸린 항목이 있으면 CONFIG_INVALID(problems: "항목: 까닭")로 아무것도 바꾸지 않는다.
 * before: DB 를 쓰기 바로 앞에 부른다(스냅샷).
 * restart: 다시 시작해야 적용되는 값이 기동 때 값과 다르다 · cookiesSource: 쿠키 출처가 바뀌었으면 새 값(꺼졌거나 그대로면 null)
 */
async function apply(file: string, items: ArchiveItem[], { before }: { before?: () => Promise<unknown> } = {}): Promise<ArchiveImported> {
  const parsed = parse(file);
  const { favicons, background } = await checkChosen(parsed, items);
  // 로그인 배경은 먼저 풀어 둔다(오래 걸리고 디스크가 차면 실패한다. 아직 보이지 않는다)
  const staged = background ? await loginBackground.stage(file, background) : null;
  const cookiesBefore = tunables.view().values[COOKIES_KEY] ?? "";
  let docItems: DocItem[];
  try {
    // 스냅샷은 설정 DB 의 것이라 DB 항목을 가져올 때만(파비콘 · 로그인 배경만이면 뜨지 않는다. 가져오기 전 스냅샷은 몇 개만 남는다)
    if (items.some((item) => !FILE_ITEMS.includes(item))) await before?.();
    docItems = writeChosen(parsed.json, items);
  } catch (error) {
    staged?.abort();
    throw error;
  }

  // 메모리를 DB 에 맞춘다(설정 문서 · 운영 조절값)
  if (docItems.length) documents.reload();
  if (items.includes("tunables")) tunables.reload();
  if (favicons) appearance.replaceFavicons(favicons);
  staged?.commit();
  const added = items.some(audioArchive.isAudioItem) ? await audioArchive.applyBundle(file, items) : null;
  return { ...importedOf(items, cookiesBefore), ...(added ? { added } : {}) };
}

// 가져온 뒤 알릴 것: 다시 시작해야 적용되는 값 · 바뀐 쿠키 출처(꺼졌거나 그대로면 null)
function importedOf(items: ArchiveItem[], cookiesBefore: string): ArchiveImported {
  const after = tunables.view();
  const cookies = after.values[COOKIES_KEY] ?? "";
  return { imported: items, restart: items.includes("tunables") && after.pending.length > 0, cookiesSource: cookies && cookies !== cookiesBefore ? cookies : null };
}

/** 명령 전체 백업이 풀어 둔 오디오 캐시 번들의 이름(DB 폴더 안). 다음 기동이 합친 뒤 삭제한다 */
const STAGED_AUDIO = "audio-cache.restore.zip";

/**
 * 기동 때(설정을 올린 뒤 · 봇을 켜기 전). 명령 전체 백업의 오디오 캐시 번들이 있으면 대시보드 불러오기와 같은 합치기로 파일에 있는 항목을 모두 가져오고 삭제한다.
 * 번들이 없으면 null. 읽을 수 없는 번들(ZIP 이 깨졌거나 오디오 캐시가 아님)은 삭제하고 던진다(매번 다시 하지 않게). 그 밖의 실패는 번들을 남기고 던진다(다음 기동이 다시 한다)
 */
async function applyStagedAudio(dir: string): Promise<ArchiveImported | null> {
  const file = path.join(dir, STAGED_AUDIO);
  if (!fs.existsSync(file)) return null;
  try {
    const shown = await preview(file);
    if (shown.kind !== "audio-cache") throw codedError("BAD_ARCHIVE", "오디오 캐시 번들이 아닙니다");
    const items = shown.rows.filter((row) => row.inFile).map((row) => row.item);
    const done = items.length ? await apply(file, items) : { imported: [], restart: false, cookiesSource: null };
    fs.rmSync(file, { force: true });
    return done;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "BAD_ZIP" || code === "BAD_ARCHIVE") fs.rmSync(file, { force: true });
    throw error;
  }
}

export { build, parse, preview, apply, applyStagedAudio, fileName, STAGED_AUDIO, ITEM_LABELS };
export { exportProblem } from "./audio-cache-archive.ts";
export type { ArchiveJson };
