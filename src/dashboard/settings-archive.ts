// 설정 내보내기 · 불러오기. ZIP 하나: settings.json(사람이 읽는 JSON) + favicon/(올린 그림 그대로). 계약은 contract/settings-archive.
//   settings  봇 설정만: 남에게 나눠 줄 설정. 서버별 설정 · 키가 없고, PC 에 매인 운영 조절값(쿠키 출처 · POToken 쓰기)도 뺀다
//   full      암호화된 설정까지: settings + 서버별 설정 + 키 · 쿠키의 암호문(같은 SECRETS_KEY 에서만 풀린다. 끝 네 글자는 넣지 않는다)
// .env 는 어느 쪽에도 없다. 대시보드는 비밀을 읽어 내지도, .env 를 쓰지도 않는다(그건 봇 폴더의 몫: scripts/backup).
// 불러오기는 고른 항목을 모두 저장과 같은 검사로 먼저 보고, DB 는 한 트랜잭션으로 쓴다(하나라도 틀리면 아무것도 바꾸지 않는다). 그림은 DB 뒤에 바꾼다.
// 남이 준 파일일 수 있으니 바깥으로 나가는 값(AI 요청이 가는 곳 · 봇이 보이는 링크)이 바뀌면 미리 보기가 짚어 준다.

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
import * as secrets from "../store/secrets.ts";
import * as serviceKeys from "../store/service-keys.ts";
import { settingsDb } from "../store/settings-db.ts";
import * as appearance from "./appearance.ts";
import type { Code } from "../rules/problems.ts";
import type { ArchiveItem, ArchiveKind, ArchivePreview, ArchiveRow } from "./contract/settings-archive.ts";
import { ARCHIVE_ITEMS } from "./contract/settings-archive.ts";

const FORMAT = 1;
const JSON_NAME = "settings.json";
const FAVICON_DIR = "favicon/";
// settings.json 하나의 상한. 설정 문서는 크지 않다(장르 수십 개 · 프롬프트 몇 KB). 쿠키 암호문이 들면 조금 커진다
const JSON_MAX_BYTES = 4 * 1024 * 1024;
// 그 PC 에만 맞는 운영 조절값. 봇 설정만 내보내기에서 빼고, 그 파일을 불러올 때는 지금 값을 지킨다
// (쿠키 출처를 남이 정하면 봇이 이 PC 의 브라우저 쿠키를 읽는다. POToken 은 설치 여부에 매인다)
const MACHINE_KEYS: readonly string[] = ["COOKIES_SOURCE", "BGUTIL_ENABLED"];

type DocItem = Extract<ArchiveItem, documents.DocName>;
const DOC_ITEMS: readonly DocItem[] = ["genres", "status", "ai", "ai-prompt"];
const isDocItem = (item: ArchiveItem): item is DocItem => (DOC_ITEMS as readonly string[]).includes(item);

/** settings.json 의 꼴. 읽을 때는 칸마다 따로 본다(빠진 칸은 그 항목이 파일에 없는 것) */
type ArchiveJson = {
  format: number;
  kind: ArchiveKind;
  exportedAt: string;
  botVersion: string;
  tunables: Record<string, string>;
  documents: Partial<Record<DocItem, unknown>>;
  /** full 만 */
  guilds?: Record<string, guildSettings.GuildDoc>;
  /** full 만. 암호문 그대로 */
  secrets?: secrets.Sealed[];
  /** 함께 담은 그림 파일 이름(favicon/ 아래). 비었어도 적는다: 가져오면 그림이 없는 상태가 된다 */
  favicons: string[];
};

/** 읽은 파일. favicons 는 favicon/ 아래 파일들 */
type Parsed = { json: Partial<ArchiveJson>; favicons: Array<{ name: string; data: Buffer }> };

const badArchive = (why: string) => codedError("BAD_ARCHIVE", why);
const isTable = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const digest = (data: Buffer) => crypto.createHash("sha256").update(data).digest("hex");
const without = (values: Record<string, string>, keys: readonly string[]) => Object.fromEntries(Object.entries(values).filter(([key]) => !keys.includes(key)));

/** 내려받을 파일 이름(종류 · 만든 때) */
function fileName(kind: ArchiveKind, at = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `musicbot-${kind === "full" ? "full" : "settings"}-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.zip`;
}

/** 지금 설정을 ZIP 으로 */
async function build(kind: ArchiveKind): Promise<Buffer> {
  const favicons = await appearance.faviconFiles();
  const values = tunables.view().values;
  const json: ArchiveJson = {
    format: FORMAT,
    kind,
    exportedAt: new Date().toISOString(),
    botVersion: BOT_VERSION,
    tunables: kind === "full" ? values : without(values, MACHINE_KEYS),
    documents: Object.fromEntries(DOC_ITEMS.map((name) => [name, documents.get(name)])),
    ...(kind === "full" ? { guilds: guildSettings.allDocs(), secrets: secrets.sealedAll() } : {}),
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
  if (!isTable(json)) throw badArchive(`${JSON_NAME} 이 표 꼴이 아닙니다.`);
  if (json.format !== FORMAT) throw badArchive(`모르는 형식입니다(format ${String(json.format)}). 이 봇이 읽는 형식은 ${FORMAT} 입니다.`);
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

// ── 항목마다의 미리 보기 ──

const absent = (item: ArchiveItem): ArchiveRow => ({ item, inFile: false, same: false, problems: [], warnings: [], count: null });

/** 이 파일로 덮어쓸 운영 조절값. 봇 설정만 내보낸 파일은 PC 에 매인 값이 없으니 지금 것을 지킨다 */
function tunablesFrom(json: Partial<ArchiveJson>): Record<string, unknown> | null {
  if (!isTable(json.tunables)) return null;
  if (json.kind === "full") return json.tunables;
  const current = tunables.view().values;
  return { ...without(json.tunables as Record<string, string>, MACHINE_KEYS), ...Object.fromEntries(MACHINE_KEYS.filter((key) => key in current).map((key) => [key, current[key]])) };
}

function tunablesRow(json: Partial<ArchiveJson>): ArchiveRow {
  const value = tunablesFrom(json);
  if (!value) return absent("tunables");
  const before = tunables.view().values.WEBSITE ?? "";
  const after = typeof value.WEBSITE === "string" ? value.WEBSITE : "";
  const warnings = after !== before ? [after ? `봇이 보이는 링크가 바뀌어요: ${after}` : "봇이 보이던 링크가 없어져요."] : [];
  return { item: "tunables", inFile: true, same: stable(value) === stable(tunables.view().values), problems: tunables.problemsOf(value), warnings, count: null };
}

function guildsRow(json: Partial<ArchiveJson>): ArchiveRow {
  if (!isTable(json.guilds)) return absent("guilds");
  return { item: "guilds", inFile: true, same: stable(json.guilds) === stable(guildSettings.allDocs()), problems: guildSettings.docsProblems(json.guilds), warnings: [], count: Object.keys(json.guilds).length };
}

/** 문서 하나의 검사. 프롬프트는 AI 를 켠 설정과 함께일 때만 {{목록}} 을 따진다 */
function docProblems(item: DocItem, data: unknown, aiDoc: unknown): string[] {
  if (item === "ai-prompt") return Array.isArray(data) ? promptProblems(data, !aiSwitchedOff(aiDoc)) : ["프롬프트가 섹션 목록이 아닙니다."];
  if (!isTable(data)) return ["표 꼴이 아닙니다."];
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

/** 바깥으로 나가는 값이 바뀌는지(남이 준 파일로 모르고 들이지 않게) */
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

/** 키 · 쿠키: 지금 SECRETS_KEY 로 풀리는 것만 쓸 수 있다 */
function secretsOf(json: Partial<ArchiveJson>) {
  const list = Array.isArray(json.secrets) ? json.secrets : [];
  const opened = list.map((one) => secrets.openSealed(one));
  return { usable: opened.flatMap((one) => (one.ok ? [one.row] : [])), refused: opened.filter((one) => !one.ok) };
}

function secretsRow(json: Partial<ArchiveJson>): ArchiveRow {
  if (!Array.isArray(json.secrets)) return absent("secrets");
  // 넣어 둔 키가 하나도 없던 봇의 파일: 가져올 것이 없다
  if (!json.secrets.length) return { item: "secrets", inFile: true, same: true, problems: [], warnings: [], count: 0 };
  const { usable, refused } = secretsOf(json);
  const otherKey = refused.filter((one) => !one.ok && one.why === "other-key").length;
  const problems = usable.length ? [] : [otherKey ? `지금 SECRETS_KEY 로 풀리는 값이 없어요(다른 키로 잠근 값 ${otherKey}개).` : "쓸 수 있는 값이 없어요."];
  const warnings = usable.length && refused.length ? [`풀리지 않는 값 ${refused.length}개는 건너뛰어요(다른 키로 잠갔거나 망가졌어요).`] : [];
  const now = new Map(secrets.sealedAll().map((one) => [one.name, one.ciphertext]));
  const same = usable.length > 0 && usable.every((row) => now.get(row.name) === row.ciphertext.toString("base64"));
  return { item: "secrets", inFile: true, same, problems, warnings, count: usable.length };
}

// 그림 검사에 걸린 까닭(올리기의 거절 코드)을 한 줄로
const FAVICON_WHY: Partial<Record<Code, (params: Record<string, unknown>) => string>> = {
  "bad-image": () => "png · webp · jpg · svg 그림이 아닌 파일이 있습니다.",
  "image-not-square": () => "정사각형이 아닌 그림이 있습니다.",
  "image-too-small": ({ min }) => `한 변이 ${String(min)}px 보다 작은 그림이 있습니다.`,
  "too-many-favicons": ({ max }) => `그림이 ${String(max)}장보다 많습니다.`,
};

async function faviconRow(parsed: Parsed): Promise<ArchiveRow> {
  if (!Array.isArray(parsed.json.favicons)) return absent("favicon");
  const checked = await appearance.checkFavicons(parsed.favicons.map((one) => one.data));
  const problems = checked.ok ? [] : [...new Set(checked.problems.map((one) => FAVICON_WHY[one.code]?.(one.params ?? {}) ?? one.code))];
  const now = (await appearance.faviconFiles()).map((one) => digest(one.data)).sort();
  const theirs = parsed.favicons.map((one) => digest(one.data)).sort();
  return { item: "favicon", inFile: true, same: stable(now) === stable(theirs), problems, warnings: [], count: parsed.favicons.length };
}

// 프롬프트를 따질 때 볼 AI 설정: 파일의 것을 함께 가져오면 그것, 아니면 지금 것
function aiDocFor(json: Partial<ArchiveJson>, takingAi: boolean) {
  const fromFile = isTable(json.documents) ? json.documents.ai : undefined;
  return takingAi && fromFile !== undefined ? fromFile : documents.get("ai");
}

// 항목 하나의 미리 보기
async function rowFor(item: ArchiveItem, parsed: Parsed, aiDoc: unknown): Promise<ArchiveRow> {
  if (item === "tunables") return tunablesRow(parsed.json);
  if (item === "guilds") return guildsRow(parsed.json);
  if (item === "secrets") return secretsRow(parsed.json);
  if (item === "favicon") return faviconRow(parsed);
  return docRow(item, parsed.json, aiDoc);
}

/** 파일을 읽어 항목마다 지금과 같은지 · 검사 문제 · 바깥으로 나가는 값의 변화를 본다. 아무것도 바꾸지 않는다 */
async function preview(buf: Buffer): Promise<ArchivePreview> {
  const parsed = parse(buf);
  const { json } = parsed;
  const aiDoc = aiDocFor(json, true);
  const rows = await Promise.all(ARCHIVE_ITEMS.map((item) => rowFor(item, parsed, aiDoc)));
  return { kind: json.kind === "full" ? "full" : "settings", exportedAt: typeof json.exportedAt === "string" ? json.exportedAt : null, botVersion: typeof json.botVersion === "string" ? json.botVersion : null, rows };
}

const LABEL: Record<ArchiveItem, string> = { tunables: "운영 조절값", genres: "자동재생 장르", status: "활동 문구", ai: "AI 설정", "ai-prompt": "AI 프롬프트", guilds: "서버별 설정", secrets: "키 · 쿠키", favicon: "파비콘" };

// 고른 항목이 모두 파일에 있고 검사를 지나는지. 아니면 CONFIG_INVALID(problems: "항목: 까닭"). 지나면 저장할 그림
async function checkChosen(parsed: Parsed, items: ArchiveItem[]): Promise<appearance.Inspected[]> {
  const aiDoc = aiDocFor(parsed.json, items.includes("ai"));
  const rows = await Promise.all(items.map((item) => rowFor(item, parsed, aiDoc)));
  const problems = rows.flatMap((row) => [...(row.inFile ? [] : ["파일에 없습니다."]), ...row.problems].map((line) => `${LABEL[row.item]}: ${line}`));
  if (problems.length) throw Object.assign(codedError("CONFIG_INVALID", problems.join("\n")), { problems });
  if (!items.includes("favicon")) return [];
  const checked = await appearance.checkFavicons(parsed.favicons.map((one) => one.data));
  return checked.ok ? checked.images : [];
}

// DB 에 쓴다(한 트랜잭션). 키 · 쿠키는 풀리는 것만, 파일에 없는 키는 그대로 둔다
function writeChosen(json: Partial<ArchiveJson>, items: ArchiveItem[]) {
  const docs = isTable(json.documents) ? json.documents : {};
  const docItems = items.filter(isDocItem);
  settingsDb.get().transaction(() => {
    if (docItems.length) settingsDocs.writeAll(docItems.map((name) => ({ name, data: docs[name], revision: settingsDocs.read(name).revision })));
    if (items.includes("tunables")) tunables.writeRaw(tunablesFrom(json) ?? {});
    if (items.includes("guilds")) guildSettings.replaceAll(json.guilds ?? {});
    if (items.includes("secrets")) secrets.adoptOpened(secretsOf(json).usable);
  })();
  return docItems;
}

/**
 * 고른 항목을 덮어쓴다. 파일에 없거나 검사에 걸린 항목이 있으면 CONFIG_INVALID(problems: "항목: 까닭")로 아무것도 바꾸지 않는다.
 * before: DB 를 쓰기 바로 앞에 부른다(스냅샷)
 */
async function apply(buf: Buffer, items: ArchiveItem[], { before }: { before?: () => Promise<unknown> } = {}): Promise<ArchiveItem[]> {
  const parsed = parse(buf);
  const images = await checkChosen(parsed, items);
  await before?.();
  const docItems = writeChosen(parsed.json, items);

  // 메모리를 DB 에 맞춘다(설정 문서 · 운영 조절값 · 서버별 설정 · 바깥 서비스 키의 기억)
  if (docItems.length) documents.reload();
  if (items.includes("tunables")) tunables.reload();
  if (items.includes("guilds")) guildSettings._reset();
  if (items.includes("secrets")) serviceKeys.load();
  if (items.includes("favicon")) await appearance.replaceFavicons(images);
  return items;
}

export { build, parse, preview, apply, fileName, MACHINE_KEYS };
export type { ArchiveJson };
