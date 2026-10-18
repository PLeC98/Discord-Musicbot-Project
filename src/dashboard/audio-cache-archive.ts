// 오디오 캐시 백업(설정 내보내기의 audio-cache 종류). ZIP 의 audio-cache/ 아래에 캐시 파일(files/<캐시 파일 이름>)과 마지막 항목의 행 목록(rows.json).
// 행 목록: 담은 캐시 파일의 행 · 링크 데이터 전부(곡 파일 없이 내보내도 같다) · 직접 지정한 음원 · 연령 제한 · SponsorBlock 구간(불러오기에서 고른다).
// 스포티파이 익명 상태 · 재생 테스트 결과는 담지 않는다. 곡 파일 없이 내보내면(files=0) 캐시 파일 행도 담지 않는다.
// 내보내는 동안 담을 파일을 지킨다(퇴거 · 삭제 · 초기화가 지우지 않게, audioCache.holdForExport). 그래도 사라진 파일은 건너뛰고 행 목록에서 뺀다.
// 불러오기는 합친다(쓰는 봇에 더하는 것이 흔하고, 빈 봇으로 옮길 때도 합치기가 곧 바꾸기다):
//   캐시 파일       없는 것만 가져온다(재생 수 · 마지막 재생은 큰 쪽). 캐시 상한(크기 · 수)과 남은 디스크까지, 퇴거 점수가 낮은 것부터
//   링크 데이터     이 봇의 행을 둔다(더 새 결과). 음원이 같으면 확인된 제목을 앞세운다
//   직접 지정한 음원 파일의 것으로 덮는다(운영자가 정한 것을 가져온다)
//   연령 제한 · SponsorBlock 합친다
// 연령 제한을 먼저 가져온다(퇴거 점수가 읽는다). 파일은 임시 이름으로 받아 옮긴다(받는 동안 정리가 지우지 않게 지킨다). 설정 DB 가 아니라 스냅샷을 뜨지 않는다.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import config from "../config/index.ts";
import { freeBytesOf, KEEP_FREE_BYTES } from "../infra/disk.ts";
import { openZip, type ZipInput, type ZipItem } from "../infra/zip.ts";
import { codedError } from "../rules/error-kind.ts";
import * as audioCache from "../store/audio-cache.ts";
import * as trackLookup from "../store/track-lookup.ts";
import * as pinnedSources from "../store/pinned-sources.ts";
import * as externalCaches from "../store/external-caches.ts";
import type { ArchiveBreakdown, ArchiveItem, ArchiveRow } from "./contract/settings-archive.ts";

const DIR = "audio-cache/";
const ROWS_NAME = `${DIR}rows.json`;
const FILES_DIR = `${DIR}files/`;
/** ZIP 하나에 담는 항목 수 상한(불러오기의 openZip 상한). settings.json · rows.json 두 항목을 뺀 만큼이 캐시 파일 */
const ZIP_MAX_ENTRIES = 100_000;
const FILES_MAX = ZIP_MAX_ENTRIES - 2;

// rows.json 하나의 상한(링크 데이터 · SponsorBlock 구간 수만 줄)
const ROWS_MAX_BYTES = 64 * 1024 * 1024;

/** rows.json 의 모양. 읽을 때 같은 모양으로 검사한다 */
const text = (max: number) => z.string().max(max);
const time = z.number().int().min(0);
const RowsSchema = z.object({
  files: z.array(
    z.object({
      audioKey: z.string().regex(/^(?:yt|sc|dl):.{1,2000}$/),
      title: text(2000).nullable(),
      channel: text(2000).nullable(),
      durationSec: z.number().min(0).nullable(),
      sizeBytes: z.number().int().min(0),
      plays: z.number().int().min(0),
      lastPlayedAt: time.nullable(),
      downloadedAt: time.nullable(),
      audioVersion: text(500).nullable(),
    }),
  ),
  ledger: z.array(z.object({ requestKey: text(4096).min(1), pageUrl: text(4096), audioUrl: text(4096).min(1), platform: text(100), title: text(2000).nullable(), artist: text(2000).nullable(), thumbnail: text(4096).nullable(), titleVerified: z.boolean() })),
  pins: z.array(z.object({ requestKey: text(4096).min(1), audioUrl: text(4096).min(1), pinnedAt: time })),
  age: z.array(z.object({ videoId: text(64).min(1), markedAt: time })),
  sponsorblock: z.array(z.object({ videoId: text(64).min(1), data: text(1024 * 1024), fetchedAt: time })),
});
type Rows = z.infer<typeof RowsSchema>;
type FileRow = audioCache.AdoptRow;

// ZIP 안의 이름은 키에서(이 봇의 캐시 파일 이름). 저장된 경로를 쓰지 않는다
const entryOf = (audioKey: string) => FILES_DIR + path.basename(audioCache.getFilePath(audioKey));

const fileRowOf = (row: audioCache.AudioRow): FileRow => ({
  audioKey: row.audio_key,
  title: row.title,
  channel: row.channel,
  durationSec: row.duration_sec,
  sizeBytes: row.file_size_bytes ?? 0,
  plays: row.play_count,
  lastPlayedAt: row.last_played_at,
  downloadedAt: row.downloaded_at,
  audioVersion: row.audio_version,
});

function rowsOf(files: audioCache.AudioRow[]): Rows {
  return {
    files: files.map(fileRowOf),
    ledger: trackLookup.allRows().map((row) => ({ requestKey: row.request_key, pageUrl: row.page_url, audioUrl: row.audio_url, platform: row.platform, title: row.display_title, artist: row.display_artist, thumbnail: row.display_thumbnail, titleVerified: row.title_verified === 1 })),
    pins: pinnedSources.allPins(),
    age: externalCaches.allAgeRestricted(),
    sponsorblock: externalCaches.allSponsorSegments(),
  };
}

const cachedRows = () => audioCache.allRows().filter((row) => row.status === "cached");

/** 내보낼 수 없는 까닭(캐시 파일이 ZIP 하나의 상한보다 많다). 없으면 null */
function exportProblem(withFiles: boolean): { code: "archive-too-many-files"; max: number } | null {
  return withFiles && cachedRows().length > FILES_MAX ? { code: "archive-too-many-files", max: FILES_MAX } : null;
}

/**
 * 내보낼 항목(settings.json 다음에 붙인다): 캐시 파일(파일째) · 마지막에 실제로 담은 파일만 적은 행 목록.
 * release 는 다 보냈거나 끊겼을 때 지킴을 푼다(여러 번 불러도 된다)
 */
function exportInputs({ withFiles }: { withFiles: boolean }): { inputs: ZipInput[]; release: () => void } {
  const files = withFiles ? cachedRows() : [];
  const release = audioCache.holdForExport(files.map((row) => row.audio_key));
  const inputs: ZipInput[] = [...files.map((row) => ({ name: entryOf(row.audio_key), file: row.file_path || audioCache.getFilePath(row.audio_key), optional: true })), { name: ROWS_NAME, build: (written) => Buffer.from(`${JSON.stringify(rowsOf(files.filter((row) => written.has(entryOf(row.audio_key)))))}\n`) }];
  return { inputs, release };
}

// ── 불러오기 ──

/** 오디오 캐시의 항목 */
const AUDIO_ITEMS = ["audio-files", "audio-ledger", "audio-pins", "audio-age", "audio-sponsorblock"] as const satisfies readonly ArchiveItem[];
type AudioItem = (typeof AUDIO_ITEMS)[number];
const isAudioItem = (item: ArchiveItem): item is AudioItem => (AUDIO_ITEMS as readonly string[]).includes(item);

/** 읽은 번들: 행 목록과 ZIP 의 캐시 파일 항목(이름 → 항목) */
type Bundle = { rows: Rows; entries: Map<string, ZipItem> };

/** 올린 ZIP 의 행 목록을 읽는다. 없거나 모양이 틀리면 BAD_ARCHIVE */
function readBundle(file: string): Bundle {
  const zipped = openZip(file);
  try {
    const entry = zipped.entries.find((one) => one.name === ROWS_NAME);
    if (!entry) throw codedError("BAD_ARCHIVE", `${ROWS_NAME} 이 없습니다. 오디오 캐시 내보내기 파일이 아닙니다.`);
    let raw: unknown;
    try {
      raw = JSON.parse(zipped.read(entry, ROWS_MAX_BYTES).toString("utf8"));
    } catch {
      throw codedError("BAD_ARCHIVE", `${ROWS_NAME} 이 JSON 이 아니거나 너무 큽니다.`);
    }
    const parsed = RowsSchema.safeParse(raw);
    if (!parsed.success) throw codedError("BAD_ARCHIVE", `${ROWS_NAME} 의 모양이 맞지 않습니다: ${parsed.error.issues[0]?.path.join(".")}`);
    return { rows: parsed.data, entries: new Map(zipped.entries.filter((one) => one.name.startsWith(FILES_DIR)).map((one) => [one.name, one])) };
  } finally {
    zipped.close();
  }
}

/** 캐시 파일을 둘 드라이브에 쓸 수 있는 크기: 남은 크기에서 최소 여유 공간(적어도 남겨 둘 몫) */
const roomForCache = () => Math.max(0, (freeBytesOf(audioCache.cacheDir()) ?? 0) - Math.max(KEEP_FREE_BYTES, config.cache.minFreeDiskBytes));

/**
 * 가져올 캐시 파일: 이 봇에 없고 ZIP 에 파일이 있는 것을 퇴거 점수가 낮은 것부터, 캐시 상한(크기 · 수)과 남은 디스크까지.
 * existing: 이 봇에 이미 있다(받는 중 포함) · over: 상한 밖
 */
function planFiles(bundle: Bundle, moreAge: Iterable<string>) {
  const existing: FileRow[] = [];
  const fresh: FileRow[] = [];
  for (const row of bundle.rows.files) {
    if (!bundle.entries.has(entryOf(row.audioKey))) continue;
    const local = audioCache.lookupByAudioKey(row.audioKey);
    (local && local.status !== "error" ? existing : fresh).push(row);
  }
  const ranked = audioCache.rankForEviction(
    fresh.map((row) => ({ row, audio_key: row.audioKey, play_count: row.plays, last_played_at: row.lastPlayedAt, downloaded_at: row.downloadedAt, created_at: row.downloadedAt ?? 0, file_size_bytes: bundle.entries.get(entryOf(row.audioKey))!.size })),
    moreAge,
  );
  const usage = audioCache.cacheUsage();
  let [bytes, files, room] = [usage.bytes, usage.files, roomForCache()];
  const take: FileRow[] = [];
  const over: FileRow[] = [];
  // 점수가 높은 것(먼저 지울 것)이 앞이라 뒤에서부터
  for (const one of ranked.reverse()) {
    const size = one.file_size_bytes;
    if (bytes + size <= config.cache.maxSizeBytes && files + 1 <= config.cache.maxFiles && size <= room) {
      take.push(one.row);
      [bytes, files, room] = [bytes + size, files + 1, room - size];
    } else over.push(one.row);
  }
  return { take, existing, over };
}

const breakdown = (added: number, existing: number, changed = 0, overLimit = 0, bytes: number | null = null): ArchiveBreakdown => ({ added, existing, changed, overLimit, bytes });
const merged = (item: AudioItem, part: ArchiveBreakdown, inFile: boolean): ArchiveRow => ({ item, inFile, same: inFile && part.added === 0 && part.changed === 0 && part.overLimit === 0, problems: [], warnings: [], count: null, breakdown: part });
const videoIdsOf = (rows: Rows) => rows.age.map((one) => one.videoId);

/** 항목마다 몇 개를 새로 · 이미 있음 · 다른 값 · 상한 밖으로 가져오는지. 상한은 파일의 연령 제한도 함께 가져온다고 보고 센다(처음 선택) */
function previewRows(bundle: Bundle): ArchiveRow[] {
  const { rows } = bundle;
  const plan = planFiles(bundle, videoIdsOf(rows));
  const ledgerNew = rows.ledger.filter((one) => trackLookup.getAudioUrl(one.requestKey) === null).length;
  const pins = rows.pins.map((one) => pinnedSources.getPin(one.requestKey)?.audioUrl ?? null);
  const pinsChanged = rows.pins.filter((one, i) => pins[i] !== null && pins[i] !== one.audioUrl).length;
  const pinsNew = pins.filter((one) => one === null).length;
  const ageNew = rows.age.filter((one) => !externalCaches.isAgeRestricted(one.videoId)).length;
  const sponsorNew = rows.sponsorblock.filter((one) => externalCaches.getSponsorSegments(one.videoId) === null).length;
  const sizeOf = (row: FileRow) => bundle.entries.get(entryOf(row.audioKey))!.size;
  return [
    merged(
      "audio-files",
      breakdown(
        plan.take.length,
        plan.existing.length,
        0,
        plan.over.length,
        plan.take.reduce((sum, row) => sum + sizeOf(row), 0),
      ),
      plan.take.length + plan.existing.length + plan.over.length > 0,
    ),
    merged("audio-ledger", breakdown(ledgerNew, rows.ledger.length - ledgerNew), rows.ledger.length > 0),
    merged("audio-pins", breakdown(pinsNew, rows.pins.length - pinsNew - pinsChanged, pinsChanged), rows.pins.length > 0),
    merged("audio-age", breakdown(ageNew, rows.age.length - ageNew), rows.age.length > 0),
    merged("audio-sponsorblock", breakdown(sponsorNew, rows.sponsorblock.length - sponsorNew), rows.sponsorblock.length > 0),
  ];
}

// 캐시 폴더 안의 임시 이름(정리가 다운로드 중인 파일로 보고 건너뛴다)
const tempFor = (audioKey: string) => path.join(audioCache.cacheDir(), `${path.basename(audioCache.getFilePath(audioKey), ".opus")}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}.opus`);

// 캐시 파일 하나를 ZIP 에서 임시 이름으로 받아 이 봇의 자리로 옮긴다. 옮겼으면 true
async function importFile(zipped: ReturnType<typeof openZip>, entry: ZipItem, row: FileRow) {
  const temp = tempFor(row.audioKey);
  audioCache.protectFile(temp);
  try {
    await pipeline(zipped.stream(entry), fs.createWriteStream(temp));
    return await audioCache.adoptFile(row, temp);
  } finally {
    audioCache.unprotectFile(temp);
    fs.rmSync(temp, { force: true });
  }
}

// 캐시 파일: 상한 안의 것은 옮기고, 이미 있는 것은 재생 수 · 마지막 재생을 큰 쪽으로. 옮긴 수
async function importFiles(file: string, bundle: Bundle) {
  const plan = planFiles(bundle, []);
  for (const row of plan.existing) audioCache.mergePlays(row.audioKey, row.plays, row.lastPlayedAt);
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
  const zipped = openZip(file);
  let moved = 0;
  try {
    for (const row of plan.take) if (await importFile(zipped, bundle.entries.get(entryOf(row.audioKey))!, row)) moved++;
  } finally {
    zipped.close();
  }
  return moved;
}

/**
 * 고른 항목을 합친다. 항목마다 새로 가져온 수(캐시 파일은 옮긴 수). 연령 제한 → 캐시 파일(하나씩) → 링크 데이터 · 직접 지정한 음원 · SponsorBlock 순서.
 * 캐시 파일은 지금 상태로 다시 센다(미리 본 뒤 바뀌었을 수 있다). 연령 제한을 먼저 가져왔으면 퇴거 점수가 그것을 읽는다
 */
async function applyBundle(file: string, items: readonly ArchiveItem[]): Promise<Partial<Record<AudioItem, number>>> {
  const bundle = readBundle(file);
  const { rows } = bundle;
  const added: Partial<Record<AudioItem, number>> = {};
  if (items.includes("audio-age")) added["audio-age"] = externalCaches.mergeAgeRestricted(rows.age);
  if (items.includes("audio-files")) added["audio-files"] = await importFiles(file, bundle);
  if (items.includes("audio-ledger")) added["audio-ledger"] = trackLookup.mergeRows(rows.ledger);
  if (items.includes("audio-pins")) {
    added["audio-pins"] = rows.pins.filter((one) => pinnedSources.getPin(one.requestKey) === null).length;
    for (const one of rows.pins) pinnedSources.setPin(one.requestKey, one.audioUrl, one.pinnedAt);
  }
  if (items.includes("audio-sponsorblock")) added["audio-sponsorblock"] = externalCaches.mergeSponsorSegments(rows.sponsorblock);
  return added;
}

export { exportInputs, exportProblem, readBundle, previewRows, applyBundle, roomForCache, isAudioItem, entryOf, AUDIO_ITEMS, ROWS_NAME, FILES_DIR, FILES_MAX };
export type { Rows, FileRow, AudioItem, Bundle };
