/**
 * AI 값표. 모델마다 100만 토큰당 달러(입력 · 출력 · 캐시 읽기). AI 사용량 통계의 비용을 기록할 때 센다.
 *
 * models.dev 의 공개 값표(MIT / https://github.com/sst/models.dev, https://models.dev/api.json)에서 우리 프로바이더 몫(PROVIDER_SPECS 의 prices)의
 * 가격 필드만 추려 둔다. 저장소의 `data/ai-prices.json` 은 함께 싣는 기본 사본이고, 갱신(대시보드의 모델 정보 갱신 · `pnpm run update:models`)이 다운로드한 것은
 * 실행 위치(`database/ai-prices.json`)에 쓴다. 읽을 때는 둘 중 다운로드한 때(`fetchedAt`)가 새것을 쓴다(모델 프로필과 같은 방식, config/ai-models).
 * 구간 가격(긴 문맥 할증) · 할인은 보지 않는다. 판정 요청은 짧아 기본 구간이다.
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { PROJECT } from "../infra/project-paths.ts";
import { httpFor } from "../infra/http.ts";
import logger from "../infra/log/logger.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import { PROVIDER_SPECS } from "./schema/ai-providers.ts";
import type { AiTokens } from "../dashboard/contract/ai-log.ts";
import type { RefreshResult } from "./ai-model-types.ts";
const log = logger.child({ category: "config" });

const SOURCE = "https://models.dev/api.json";
/** 저장소에 함께 싣는 기본 사본. 여기에는 쓰지 않는다 */
const BUNDLED = path.join(PROJECT.data, "ai-prices.json");
/** 다운로드한 사본(실행 위치) */
const FETCHED = path.join(PROJECT.database, "ai-prices.json");

/** 100만 토큰당 [입력, 출력, 캐시 읽기] */
type Price = [number, number, number];
/** 파일에 둔 한 버전. providers: 값표의 프로바이더 이름 → 모델 ID → 값 */
type PriceBook = { fetchedAt?: string; source?: string; hash?: string; providers: Record<string, Record<string, Price>> };
// 값표(api.json)의 모양. 여기서 읽는 필드만
type SourceModel = { cost?: { input?: unknown; output?: unknown; cache_read?: unknown } };
type SourceBook = Record<string, { models?: Record<string, SourceModel> } | undefined>;

let held: PriceBook | null = null;

// 다운로드한 사본은 없을 수 있다
function readBook(file: string): PriceBook | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as PriceBook;
  } catch (error) {
    if (codeOf(error) !== "ENOENT") log.warn(`AI 가격표를 읽지 못했습니다(${path.basename(file)}): ${messageOf(error)}`);
    return null;
  }
}

/** 다운로드한 때가 새것. 다운로드한 때를 모르면 가장 오래된 것으로 본다. 같으면 다운로드한 사본(b) */
function newerOf(a: PriceBook | null, b: PriceBook | null): PriceBook | null {
  const at = (one: PriceBook | null) => (one?.fetchedAt ? Date.parse(one.fetchedAt) || 0 : -1);
  if (!a || !b) return a ?? b;
  return at(a) > at(b) ? a : b;
}

/** 기본 사본과 다운로드한 사본 중 새것. 둘 다 없으면 빈 값표(비용은 모두 "가격 모름") */
function load({ reload = false } = {}): PriceBook {
  if (held && !reload) return held;
  held = newerOf(readBook(BUNDLED), readBook(FETCHED)) ?? { providers: {} };
  return held;
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

/** 다운로드한 값표에서 우리 프로바이더 몫의 가격 필드만 선택한다. 입력 · 출력 값이 없는 모델은 뺀다(값을 모른다) */
function trim(source: SourceBook, fetchedAt = new Date().toISOString()): PriceBook {
  const names = [...new Set(Object.values(PROVIDER_SPECS).flatMap((one) => (one.prices ? [one.prices] : [])))].sort();
  const providers: PriceBook["providers"] = {};
  for (const name of names) {
    const models: Record<string, Price> = {};
    for (const [id, model] of Object.entries(source[name]?.models ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      const input = num(model.cost?.input);
      const output = num(model.cost?.output);
      if (input === null || output === null) continue;
      models[id] = [input, output, num(model.cost?.cache_read) ?? input];
    }
    if (Object.keys(models).length) providers[name] = models;
  }
  const hash = createHash("sha256").update(JSON.stringify(providers)).digest("hex");
  return { fetchedAt, source: SOURCE, hash, providers };
}

/** 파일에 쓰는 형식: 모델 하나가 한 줄(저장소의 기본 사본이 바뀐 곳을 읽기 쉽게) */
function serialize(book: PriceBook): string {
  const NL = String.fromCharCode(10);
  const head = [`  "fetchedAt": ${JSON.stringify(book.fetchedAt ?? "")}`, `  "source": ${JSON.stringify(book.source ?? SOURCE)}`, `  "hash": ${JSON.stringify(book.hash ?? "")}`];
  const providers = Object.entries(book.providers).map(
    ([name, models]) =>
      `    ${JSON.stringify(name)}: {${NL}${Object.entries(models)
        .map(([id, price]) => `      ${JSON.stringify(id)}: ${JSON.stringify(price)}`)
        .join(`,${NL}`)}${NL}    }`,
  );
  return `{${NL}${head.join(`,${NL}`)},${NL}  "providers": {${NL}${providers.join(`,${NL}`)}${NL}  }${NL}}${NL}`;
}

/**
 * 그 모델의 값. 키가 없는 로컬 프로바이더는 0(값이 들지 않는다), 값표에 있으면 그 값(무료 모델은 0),
 * 값표에 없는 프로바이더(custom) · 모델이면 null(가격 모름)
 */
function priceOf(provider: string, model: string, book: PriceBook = load()): Price | 0 | null {
  const spec = PROVIDER_SPECS[provider];
  if (!spec) return null;
  if (spec.key === false) return 0;
  if (!spec.prices || !model) return null;
  return book.providers[spec.prices]?.[model] ?? null;
}

/** 비용(달러). 캐시에서 읽은 입력은 캐시 값으로, 나머지 입력은 입력 값으로. 값을 모르면 null */
function costOf(price: Price | 0 | null, tokens: AiTokens | null): number | null {
  if (price === null) return null;
  if (price === 0 || !tokens) return 0;
  const [input, output, cacheRead] = price;
  return (Math.max(0, tokens.input - tokens.cached) * input + tokens.cached * cacheRead + tokens.output * output) / 1_000_000;
}

// 값표는 models.dev 에서 다운로드한다(공유 HTTP 클라이언트)
const modelsdev = httpFor("modelsdev");

/** 다운로드해서 사본(`database/ai-prices.json`)에 쓴다. 선택한 값이 같으면 쓰지 않는다. 모델 정보 갱신과 같은 길이다 */
async function refresh({ timeoutMs = 30000, fetchImpl = modelsdev.fetch }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<RefreshResult> {
  const now = load();
  const res = await fetchImpl(SOURCE, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`값표 ${res.status}: ${SOURCE}`);
  const got = trim((await res.json()) as SourceBook);
  const count = (book: PriceBook) => Object.values(book.providers).reduce((n, one) => n + Object.keys(one).length, 0);
  if (got.hash === now.hash) return { changed: false, count: count(now), fetchedAt: now.fetchedAt };
  // 저쪽 모양이 바뀌어 통째로 비었으면 쓰지 않는다(가진 값표로 계속 센다)
  if (!count(got)) throw new Error("값표에서 우리 프로바이더의 가격을 하나도 읽지 못했습니다. 저쪽 모양이 바뀐 것 같아 쓰지 않았습니다.");
  fs.mkdirSync(path.dirname(FETCHED), { recursive: true });
  fs.writeFileSync(FETCHED, serialize(got));
  load({ reload: true });
  return { changed: true, count: count(got), fetchedAt: got.fetchedAt };
}

export { SOURCE, BUNDLED, FETCHED, load, newerOf, trim, serialize, priceOf, costOf, refresh };
export type { Price, PriceBook };
