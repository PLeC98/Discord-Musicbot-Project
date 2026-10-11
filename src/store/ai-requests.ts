// AI 리퀘스트 로그 · 사용량 통계 읽기와 쓰기(ai-requests.db, store/ai-log-db).
// 쓰기 하나가 로그(requests)와 통계(usage) 한 줄씩을 함께 쓴다. 칸 하나가 너무 크면 앞뒤를 남기고 자른다(모델 목록 응답은 수백 KB 다).
// 로그는 저장 용량을 넘으면 오래된 것부터 지운다(최근 KEEP_MIN_ROWS 줄은 크기와 무관하게 남긴다). 통계는 지우지 않는다.
// 새 줄은 듣는 쪽(대시보드의 실시간 연결)에 알린다.

import { aiLogDb } from "./ai-log-db.ts";
import { dayKey, type UsageRow } from "../rules/ai-usage.ts";
import type { AiLogDetail, AiLogEntry, AiLogQuery, AiLogSource } from "../dashboard/contract/ai-log.ts";

/** 저장 용량과 무관하게 남기는 최근 줄 수 */
const KEEP_MIN_ROWS = 50;
/** 칸 하나의 상한(바이트). 넘으면 앞뒤를 남기고 가운데를 줄인다 */
const MAX_FIELD_BYTES = 512 * 1024;
/** 이만큼 쓸 때마다 저장 용량을 맞춘다(쓸 때마다 세면 큰 표에서 무겁다) */
const ROTATE_EVERY = 20;

/** 쓸 것. guildName · id · truncated · bytes 는 여기서 정하거나(크기) 읽을 때 붙인다(서버 이름) */
type NewRecord = Omit<AiLogDetail, "id" | "truncated" | "bytes" | "guildName">;

type RequestRow = {
  id: number;
  at: number;
  source: string;
  provider: string;
  model: string;
  name: string;
  url: string;
  method: string;
  status: number | null;
  ok: number;
  aborted: number;
  took_ms: number;
  first_ms: number | null;
  attempt: number;
  guild_id: string | null;
  genre: string | null;
  candidates: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: number | null;
  error: string | null;
  truncated: number;
  size_bytes: number;
  request_headers?: string;
  request_body?: string;
  response?: string;
};

const SUMMARY_COLUMNS = "id, at, source, provider, model, name, url, method, status, ok, aborted, took_ms, first_ms, attempt, guild_id, genre, candidates, input_tokens, output_tokens, cached_tokens, reasoning_tokens, cost_usd, error, truncated, size_bytes";

const listeners = new Set<(entry: AiLogEntry) => void>();
let writtenSinceRotate = 0;

const bytesOf = (text: string) => Buffer.byteLength(text, "utf8");

/** 앞뒤를 남기고 가운데를 줄인다. 잘랐으면 truncated */
function cap(text: string): { text: string; truncated: boolean } {
  const size = bytesOf(text);
  if (size <= MAX_FIELD_BYTES) return { text, truncated: false };
  const half = Math.floor(MAX_FIELD_BYTES / 2);
  const buf = Buffer.from(text, "utf8");
  // 글자 가운데에서 끊기면 깨진 글자 하나가 남을 뿐이다(UTF-8 풀이가 대체 글자로 둔다)
  const head = buf.subarray(0, half).toString("utf8");
  const tail = buf.subarray(size - half).toString("utf8");
  return { text: `${head}\n\n...[${Math.round((size - half * 2) / 1024)} KB 생략]...\n\n${tail}`, truncated: true };
}

function toEntry(row: RequestRow): AiLogEntry {
  const tokens = row.input_tokens === null ? null : { input: row.input_tokens, output: row.output_tokens ?? 0, cached: row.cached_tokens ?? 0, reasoning: row.reasoning_tokens ?? 0 };
  return {
    id: row.id,
    at: row.at,
    source: row.source as AiLogSource,
    provider: row.provider,
    model: row.model,
    name: row.name,
    url: row.url,
    method: row.method,
    status: row.status,
    ok: row.ok === 1,
    aborted: row.aborted === 1,
    tookMs: row.took_ms,
    firstMs: row.first_ms,
    attempt: row.attempt,
    ...(row.guild_id ? { guildId: row.guild_id } : {}),
    ...(row.genre ? { genre: row.genre } : {}),
    ...(row.candidates !== null ? { candidates: row.candidates } : {}),
    tokens,
    costUsd: row.cost_usd,
    ...(row.error ? { error: row.error } : {}),
    truncated: row.truncated === 1,
    bytes: row.size_bytes,
  };
}

const orNull = <T>(value: T | undefined): T | null => value ?? null;

/** 원문 칸: 큰 칸은 자르고 크기를 센다 */
function textColumns(one: NewRecord) {
  const headers = cap(one.requestHeaders);
  const body = cap(one.requestBody);
  const response = cap(one.response);
  const truncated = headers.truncated || body.truncated || response.truncated;
  const size = [one.url, headers.text, body.text, response.text, one.error ?? ""].reduce((n, text) => n + bytesOf(text), 0);
  return { truncated: truncated ? 1 : 0, size_bytes: size, request_headers: headers.text, request_body: body.text, response: response.text };
}

/** 토큰 칸. 못 읽었으면 모두 NULL */
function tokenColumns(t: NewRecord["tokens"]) {
  return { input_tokens: orNull(t?.input), output_tokens: orNull(t?.output), cached_tokens: orNull(t?.cached), reasoning_tokens: orNull(t?.reasoning) };
}

/** 쓸 줄(표의 칸 이름) */
function rowOf(one: NewRecord) {
  return {
    at: one.at,
    source: one.source,
    provider: one.provider,
    model: one.model,
    name: one.name,
    url: one.url,
    method: one.method,
    status: one.status,
    ok: Number(one.ok),
    aborted: Number(one.aborted),
    took_ms: Math.round(one.tookMs),
    first_ms: one.firstMs === null ? null : Math.round(one.firstMs),
    attempt: one.attempt,
    guild_id: orNull(one.guildId),
    genre: orNull(one.genre),
    candidates: orNull(one.candidates),
    ...tokenColumns(one.tokens),
    cost_usd: one.costUsd,
    error: orNull(one.error),
    ...textColumns(one),
  };
}

/** 한 줄을 쓰고(로그 · 통계) 듣는 쪽에 알린다. 쓴 줄을 돌려준다 */
function record(one: NewRecord, { maxBytes }: { maxBytes: number }): AiLogEntry {
  const row = rowOf(one);
  const t = one.tokens;
  const db = aiLogDb.get();
  const id = db.transaction(() => {
    const got = db
      .prepare(
        `INSERT INTO requests (at, source, provider, model, name, url, method, status, ok, aborted, took_ms, first_ms, attempt, guild_id, genre, candidates, input_tokens, output_tokens, cached_tokens, reasoning_tokens, cost_usd, error, truncated, size_bytes, request_headers, request_body, response)
         VALUES (@at, @source, @provider, @model, @name, @url, @method, @status, @ok, @aborted, @took_ms, @first_ms, @attempt, @guild_id, @genre, @candidates, @input_tokens, @output_tokens, @cached_tokens, @reasoning_tokens, @cost_usd, @error, @truncated, @size_bytes, @request_headers, @request_body, @response)`,
      )
      .run(row);
    db.prepare(
      `INSERT INTO usage (at, day, source, provider, model, name, guild_id, ok, took_ms, input_tokens, output_tokens, cached_tokens, reasoning_tokens, cost_usd)
       VALUES (@at, @day, @source, @provider, @model, @name, @guild_id, @ok, @took_ms, @input, @output, @cached, @reasoning, @cost_usd)`,
    ).run({ ...row, day: dayKey(one.at), input: t?.input ?? 0, output: t?.output ?? 0, cached: t?.cached ?? 0, reasoning: t?.reasoning ?? 0 });
    return Number(got.lastInsertRowid);
  })();
  if (++writtenSinceRotate >= ROTATE_EVERY) rotate(maxBytes);
  const entry = toEntry({ ...row, id });
  for (const listener of listeners) listener(entry);
  return entry;
}

/** 저장 용량에 맞춘다: 최근 것부터 크기를 더해 넘는 줄을 지운다(최근 KEEP_MIN_ROWS 줄은 남긴다) */
function rotate(maxBytes: number) {
  writtenSinceRotate = 0;
  const db = aiLogDb.get();
  const gone = db
    .prepare(
      `DELETE FROM requests WHERE id IN (
         SELECT id FROM (SELECT id, SUM(size_bytes) OVER (ORDER BY id DESC) AS running, ROW_NUMBER() OVER (ORDER BY id DESC) AS rn FROM requests)
         WHERE running > ? AND rn > ?)`,
    )
    .run(maxBytes, KEEP_MIN_ROWS).changes;
  if (gone) db.pragma("incremental_vacuum");
  return gone;
}

/** 거르기에 맞는 줄을 최근 것부터(before 보다 작은 id). total: 남은 전부, matched: 맞는 것 */
function list(query: AiLogQuery, { before, limit }: { before?: number; limit: number }): { entries: AiLogEntry[]; total: number; matched: number } {
  const where: string[] = [];
  const args: Record<string, unknown> = {};
  if (query.sources.length) {
    where.push(`source IN (${query.sources.map((_, i) => `@s${i}`).join(", ")})`);
    query.sources.forEach((one, i) => (args[`s${i}`] = one));
  }
  if (query.result) where.push(query.result === "ok" ? "ok = 1" : "ok = 0");
  const q = query.q.trim();
  if (q) {
    // 대소문자를 가리지 않는다(화면의 실시간 거르기 aiLogMatches 와 같다). % · _ 는 글자 그대로
    where.push("(instr(lower(url), @q) > 0 OR instr(lower(model), @q) > 0 OR instr(lower(name), @q) > 0 OR instr(lower(coalesce(error, '')), @q) > 0)");
    args.q = q.toLowerCase();
  }
  const db = aiLogDb.get();
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const page = [filter || "WHERE 1", ...(before !== undefined ? ["AND id < @before"] : [])].join(" ");
  const rows = db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM requests ${page} ORDER BY id DESC LIMIT @limit`).all({ ...args, ...(before !== undefined ? { before } : {}), limit }) as RequestRow[];
  const count = (sql: string, params: Record<string, unknown> = {}) => (db.prepare(sql).get(params) as { n: number }).n;
  return { entries: rows.map(toEntry), total: count("SELECT COUNT(*) AS n FROM requests"), matched: count(`SELECT COUNT(*) AS n FROM requests ${filter}`, args) };
}

/** 한 줄의 원문까지. 없으면 null */
function one(id: number): AiLogDetail | null {
  const row = aiLogDb.get().prepare("SELECT * FROM requests WHERE id = ?").get(id) as Required<RequestRow> | undefined;
  if (!row) return null;
  return { ...toEntry(row), requestHeaders: row.request_headers, requestBody: row.request_body, response: row.response };
}

/** 남은 줄 수 · 크기 */
function size(): { count: number; bytes: number } {
  const row = aiLogDb.get().prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM requests").get() as { count: number; bytes: number };
  return row;
}

/** 로그를 모두 지운다(통계는 남는다) */
function clearRequests() {
  const db = aiLogDb.get();
  db.prepare("DELETE FROM requests").run();
  db.pragma("incremental_vacuum");
}

/** 통계를 모두 지운다(로그는 남는다) */
function clearUsage() {
  const db = aiLogDb.get();
  db.prepare("DELETE FROM usage").run();
  db.pragma("incremental_vacuum");
}

/** from 날부터의 통계 줄(출처가 있으면 그것만) */
function usageSince(from: string, sources: readonly AiLogSource[]): UsageRow[] {
  const where = ["day >= @from", ...(sources.length ? [`source IN (${sources.map((_, i) => `@s${i}`).join(", ")})`] : [])].join(" AND ");
  const args: Record<string, unknown> = { from };
  sources.forEach((one, i) => (args[`s${i}`] = one));
  const rows = aiLogDb.get().prepare(`SELECT day, source, provider, model, name, guild_id, ok, took_ms, input_tokens, output_tokens, cached_tokens, reasoning_tokens, cost_usd FROM usage WHERE ${where}`).all(args) as Array<{ day: string; source: AiLogSource; provider: string; model: string; name: string; guild_id: string | null; ok: number; took_ms: number; input_tokens: number; output_tokens: number; cached_tokens: number; reasoning_tokens: number; cost_usd: number | null }>;
  return rows.map((row) => ({ day: row.day, source: row.source, provider: row.provider, model: row.model, name: row.name, guildId: row.guild_id, ok: row.ok === 1, tookMs: row.took_ms, input: row.input_tokens, output: row.output_tokens, cached: row.cached_tokens, reasoning: row.reasoning_tokens, costUsd: row.cost_usd }));
}

/** 가장 이른 통계의 날. 없으면 null */
function earliestDay(): string | null {
  return (aiLogDb.get().prepare("SELECT MIN(day) AS day FROM usage").get() as { day: string | null }).day;
}

/** DB 가 열려 있는가(스크립트 · 시험은 열지 않을 수 있다. 그때는 남기지 않는다) */
const isOpen = () => aiLogDb.conn !== null;

/** 새 줄을 듣는다. 떼는 함수를 돌려준다 */
function onRecorded(listener: (entry: AiLogEntry) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export { KEEP_MIN_ROWS, MAX_FIELD_BYTES, isOpen, record, rotate, list, one, size, clearRequests, clearUsage, usageSince, earliestDay, onRecorded };
export type { NewRecord };
