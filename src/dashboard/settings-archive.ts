// 설정 내보내기 · 가져오기. ZIP 하나: settings.json(사람이 읽는 JSON) + favicon/(올린 그림 그대로). 계약은 contract/settings-archive.
// 비밀(서비스 키 · AI 키 · 쿠키)과 세션은 넣지 않는다. 설정 문서 · 운영 조절값은 비밀이 들어갈 수 없는 꼴로 검사를 지난 것만 저장돼 있다.
// 가져오기는 고른 항목을 모두 저장과 같은 검사로 먼저 보고, DB 는 한 트랜잭션으로 쓴다(하나라도 틀리면 아무것도 바꾸지 않는다). 그림은 DB 뒤에 바꾼다.

import crypto from "node:crypto";
import { zip, unzip } from "../infra/zip.ts";
import { BOT_VERSION } from "../infra/version.ts";
import { codedError } from "../rules/error-kind.ts";
import * as documents from "../config/documents.ts";
import { genreProblems } from "../config/schema/genres.ts";
import { statusProblems } from "../config/schema/status.ts";
import { aiProblems, aiSwitchedOff } from "../config/schema/ai.ts";
import { promptProblems } from "../config/schema/ai-prompt.ts";
import * as tunables from "../store/tunables.ts";
import * as guildSettings from "../store/guild-settings.ts";
import * as settingsDocs from "../store/settings-docs.ts";
import { settingsDb } from "../store/settings-db.ts";
import * as appearance from "./appearance.ts";
import type { Code } from "../rules/problems.ts";
import type { ArchiveItem, ArchivePreview, ArchiveRow } from "./contract/settings-archive.ts";
import { ARCHIVE_ITEMS } from "./contract/settings-archive.ts";

const FORMAT = 1;
const JSON_NAME = "settings.json";
const FAVICON_DIR = "favicon/";
// settings.json 하나의 상한. 설정 문서는 크지 않다(장르 수십 개 · 프롬프트 몇 KB)
const JSON_MAX_BYTES = 2 * 1024 * 1024;

type DocItem = Extract<ArchiveItem, documents.DocName>;
const DOC_ITEMS: readonly DocItem[] = ["genres", "status", "ai", "ai-prompt"];
const isDocItem = (item: ArchiveItem): item is DocItem => (DOC_ITEMS as readonly string[]).includes(item);

/** settings.json 의 꼴. 읽을 때는 칸마다 따로 본다(빠진 칸은 그 항목이 파일에 없는 것) */
type ArchiveJson = {
  format: number;
  exportedAt: string;
  botVersion: string;
  tunables: Record<string, string>;
  documents: Partial<Record<DocItem, unknown>>;
  guilds: Record<string, guildSettings.GuildDoc>;
  /** 함께 담은 그림 파일 이름(favicon/ 아래). 비었어도 적는다: 가져오면 그림이 없는 상태가 된다 */
  favicons: string[];
};

/** 읽은 파일. favicons 는 favicon/ 아래 파일들 */
type Parsed = { json: Partial<ArchiveJson>; favicons: Array<{ name: string; data: Buffer }> };

const badArchive = (why: string) => codedError("BAD_ARCHIVE", why);

/** 내려받을 파일 이름(만든 때를 붙인다) */
function fileName(at = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `musicbot-settings-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.zip`;
}

/** 지금 설정을 ZIP 으로 */
async function build(): Promise<Buffer> {
  const favicons = await appearance.faviconFiles();
  const json: ArchiveJson = {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    botVersion: BOT_VERSION,
    tunables: tunables.view().values,
    documents: Object.fromEntries(DOC_ITEMS.map((name) => [name, documents.get(name)])),
    guilds: guildSettings.allDocs(),
    favicons: favicons.map((one) => one.name),
  };
  return zip([{ name: JSON_NAME, data: Buffer.from(`${JSON.stringify(json, null, 2)}\n`) }, ...favicons.map((one) => ({ name: FAVICON_DIR + one.name, data: one.data }))]);
}

/** ZIP 을 읽는다. 이 봇의 내보내기가 아니면 BAD_ARCHIVE(ZIP 자체가 깨졌으면 BAD_ZIP) */
function parse(buf: Buffer): Parsed {
  const entries = unzip(buf);
  const jsonEntry = entries.find((one) => one.name === JSON_NAME);
  if (!jsonEntry) throw badArchive(`${JSON_NAME} 이 없습니다. 이 봇의 설정 내보내기 파일이 아닙니다.`);
  if (jsonEntry.data.length > JSON_MAX_BYTES) throw badArchive(`${JSON_NAME} 이 너무 큽니다.`);
  let json: unknown;
  try {
    json = JSON.parse(jsonEntry.data.toString("utf8"));
  } catch {
    throw badArchive(`${JSON_NAME} 이 JSON 이 아닙니다.`);
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw badArchive(`${JSON_NAME} 이 표 꼴이 아닙니다.`);
  const format = (json as { format?: unknown }).format;
  if (format !== FORMAT) throw badArchive(`모르는 형식입니다(format ${String(format)}). 이 봇이 읽는 형식은 ${FORMAT} 입니다.`);
  const favicons = entries.filter((one) => one.name.startsWith(FAVICON_DIR) && one.name.length > FAVICON_DIR.length).map((one) => ({ name: one.name.slice(FAVICON_DIR.length), data: one.data }));
  return { json: json as Partial<ArchiveJson>, favicons };
}

// 같은지 볼 때 칸 차례에 흔들리지 않게 키를 정렬해 글로
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

const isTable = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const digest = (data: Buffer) => crypto.createHash("sha256").update(data).digest("hex");

// 그림 검사에 걸린 까닭(올리기의 거절 코드)을 한 줄로
const FAVICON_WHY: Partial<Record<Code, (params: Record<string, unknown>) => string>> = {
  "bad-image": () => "png · webp · jpg · svg 그림이 아닌 파일이 있습니다.",
  "image-not-square": () => "정사각형이 아닌 그림이 있습니다.",
  "image-too-small": ({ min }) => `한 변이 ${String(min)}px 보다 작은 그림이 있습니다.`,
  "too-many-favicons": ({ max }) => `그림이 ${String(max)}장보다 많습니다.`,
};

/** 문서 하나의 검사. 프롬프트는 AI 를 켠 설정과 함께일 때만 {{목록}} 을 따진다 */
function docProblems(item: DocItem, data: unknown, aiDoc: unknown): string[] {
  if (item === "ai-prompt") return Array.isArray(data) ? promptProblems(data, !aiSwitchedOff(aiDoc)) : ["프롬프트가 섹션 목록이 아닙니다."];
  if (!isTable(data)) return ["표 꼴이 아닙니다."];
  return { genres: genreProblems, status: statusProblems, ai: aiProblems }[item](data);
}

// 항목 하나의 미리 보기(그림 말고)
function rowOf(item: Exclude<ArchiveItem, "favicon">, json: Partial<ArchiveJson>, aiDoc: unknown): ArchiveRow {
  if (item === "tunables") {
    const value = json.tunables;
    if (!isTable(value)) return { item, inFile: false, same: false, problems: [], count: null };
    return { item, inFile: true, same: stable(value) === stable(tunables.view().values), problems: tunables.problemsOf(value), count: null };
  }
  if (item === "guilds") {
    const value = json.guilds;
    if (!isTable(value)) return { item, inFile: false, same: false, problems: [], count: null };
    return { item, inFile: true, same: stable(value) === stable(guildSettings.allDocs()), problems: guildSettings.docsProblems(value), count: Object.keys(value).length };
  }
  const docs = isTable(json.documents) ? json.documents : {};
  if (!(item in docs)) return { item, inFile: false, same: false, problems: [], count: null };
  const value = docs[item];
  return { item, inFile: true, same: stable(value) === stable(documents.get(item)), problems: docProblems(item, value, aiDoc), count: null };
}

async function faviconRow(parsed: Parsed): Promise<ArchiveRow> {
  if (!Array.isArray(parsed.json.favicons)) return { item: "favicon", inFile: false, same: false, problems: [], count: null };
  const checked = await appearance.checkFavicons(parsed.favicons.map((one) => one.data));
  const problems = checked.ok ? [] : [...new Set(checked.problems.map((one) => FAVICON_WHY[one.code]?.(one.params ?? {}) ?? one.code))];
  const now = (await appearance.faviconFiles()).map((one) => digest(one.data)).sort();
  const theirs = parsed.favicons.map((one) => digest(one.data)).sort();
  return { item: "favicon", inFile: true, same: stable(now) === stable(theirs), problems, count: parsed.favicons.length };
}

// 프롬프트를 따질 때 볼 AI 설정: 파일의 것을 함께 가져오면 그것, 아니면 지금 것
function aiDocFor(json: Partial<ArchiveJson>, takingAi: boolean) {
  const fromFile = isTable(json.documents) ? json.documents.ai : undefined;
  return takingAi && fromFile !== undefined ? fromFile : documents.get("ai");
}

/** 파일을 읽어 항목마다 지금과 같은지 · 검사 문제를 본다. 아무것도 바꾸지 않는다 */
async function preview(buf: Buffer): Promise<ArchivePreview> {
  const parsed = parse(buf);
  const { json } = parsed;
  const aiDoc = aiDocFor(json, true);
  const rows = ARCHIVE_ITEMS.filter((item) => item !== "favicon").map((item) => rowOf(item, json, aiDoc));
  rows.push(await faviconRow(parsed));
  return { exportedAt: typeof json.exportedAt === "string" ? json.exportedAt : null, botVersion: typeof json.botVersion === "string" ? json.botVersion : null, rows };
}

const LABEL: Record<ArchiveItem, string> = { tunables: "운영 조절값", genres: "자동재생 장르", status: "활동 문구", ai: "AI 설정", "ai-prompt": "AI 프롬프트", guilds: "서버별 설정", favicon: "파비콘" };

// 고른 항목이 모두 파일에 있고 검사를 지나는지. 아니면 CONFIG_INVALID(problems: "항목: 까닭"). 지나면 저장할 그림
async function checkChosen(parsed: Parsed, items: ArchiveItem[]): Promise<appearance.Inspected[]> {
  const aiDoc = aiDocFor(parsed.json, items.includes("ai"));
  const rows = items.filter((one) => one !== "favicon").map((item) => rowOf(item as Exclude<ArchiveItem, "favicon">, parsed.json, aiDoc));
  if (items.includes("favicon")) rows.push(await faviconRow(parsed));
  const problems = rows.flatMap((row) => [...(row.inFile ? [] : ["파일에 없습니다."]), ...row.problems].map((line) => `${LABEL[row.item]}: ${line}`));
  if (problems.length) throw Object.assign(codedError("CONFIG_INVALID", problems.join("\n")), { problems });
  if (!items.includes("favicon")) return [];
  const checked = await appearance.checkFavicons(parsed.favicons.map((one) => one.data));
  return checked.ok ? checked.images : [];
}

/**
 * 고른 항목을 덮어쓴다. 파일에 없거나 검사에 걸린 항목이 있으면 CONFIG_INVALID(problems: "항목: 까닭")로 아무것도 바꾸지 않는다.
 * before: DB 를 쓰기 바로 앞에 부른다(스냅샷)
 */
async function apply(buf: Buffer, items: ArchiveItem[], { before }: { before?: () => Promise<unknown> } = {}): Promise<ArchiveItem[]> {
  const parsed = parse(buf);
  const { json } = parsed;
  const images = await checkChosen(parsed, items);

  await before?.();
  const docs = isTable(json.documents) ? json.documents : {};
  const docItems = items.filter(isDocItem);
  settingsDb.get().transaction(() => {
    if (docItems.length) settingsDocs.writeAll(docItems.map((name) => ({ name, data: docs[name], revision: settingsDocs.read(name).revision })));
    if (items.includes("tunables")) tunables.writeRaw(json.tunables ?? {});
    if (items.includes("guilds")) guildSettings.replaceAll(json.guilds ?? {});
  })();

  // 메모리를 DB 에 맞춘다(설정 문서 · 운영 조절값 · 서버별 설정의 기억)
  if (docItems.length) documents.reload();
  if (items.includes("tunables")) tunables.reload();
  if (items.includes("guilds")) guildSettings._reset();
  if (items.includes("favicon")) await appearance.replaceFavicons(images);
  return items;
}

export { build, parse, preview, apply, fileName };
export type { ArchiveJson };
