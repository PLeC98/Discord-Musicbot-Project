// 자동재생 장르 설정(settings.db의 "genres" 문서, config/documents). 읽을 때 모양과 소스 키를 본다.

import { logRuleLine, logSourceLabel } from "../rules/text/index.ts";
import logger from "../infra/log/logger.ts";
import { L } from "../infra/log/text.ts";
import type { LogText } from "../infra/log/log-text.ts";
const log = logger.child({ category: "config" });
// 설정 검증과 실제 실행이 같은 표를 봐야 한다. 어긋나면 저장은 되는데 재생이 안 된다
import * as sources from "./schema/genre-sources.ts";
import { usable } from "./source-keys.ts";
import * as documents from "./documents.ts";
import { genreProblems, tidyGenres } from "./schema/genres.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import { logTextError } from "../infra/log/log-text.ts";

// 저장 전 검사(대시보드)와 읽을 때 검사가 같은 스키마를 본다
const validateGenres = genreProblems;

/**
 * 소스 한 줄. type 말고 어떤 필드가 있는지는 종류마다 다르다(genreSources의 SPEC).
 * 검사는 필요한 필드와 선택할 값만 본다. 목록 필드는 편집기가 배열로 쓰고, 수 필드는 글자로 적어도 통과해 읽는 쪽이 Number로 바꾼다
 */
type GenreSource = {
  type: string;
  weight?: number | string;
  minScore?: number | string;
  // 목록
  keywords?: string[];
  tags?: string[];
  artists?: string[];
  artistTypes?: string[];
  excludeTags?: string[];
  season?: string[];
  mediaFormat?: string[];
  songTypes?: string[];
  songCategories?: string[];
  animeTypes?: string[];
  broadcasts?: string[];
  genres?: string[];
  languages?: string[];
  /** 하나만 적어도 된다 */
  mode?: string | string[];
  // 글자
  url?: string;
  prompt?: string;
  sort?: string;
  themeType?: string;
  seasonFrom?: string;
  seasonTo?: string;
  // 수
  pages?: number | string;
  n?: number | string;
  sequence?: number | string;
  yearFrom?: number | string;
  yearTo?: number | string;
  difficultyFrom?: number | string;
  difficultyTo?: number | string;
  minLength?: number | string;
  maxLength?: number | string;
  minBpm?: number | string;
  maxBpm?: number | string;
  [field: string]: unknown;
};
/** label: 보여 줄 이름(없으면 식별자 = 키) */
type Genre = { label?: string; emoji?: string; sources: GenreSource[] };
// 수 필드는 글자로 적어도 검사를 통과한다. 읽는 쪽이 Number로 바꾼다
type GenreDefaults = { prefetchCount?: unknown; minDurationSec?: unknown; maxDurationSec?: unknown; blockedKeywords?: unknown[] };
type GenresConfig = { defaults: GenreDefaults; genres: Record<string, Genre> };

// 같은 말을 되풀이하지 않는다. genres()는 곡을 선택할 때마다 불린다
let warnedKeys = "";

// 직전에 검사를 지난 설정. 돌던 중 문서가 틀리면 이것으로 계속 돈다(status와 같다)
let lastGood: GenresConfig | null = null;
let reported = "";

// 맞는 설정이 한 번도 없었을 때. 장르가 없으니 자동재생을 선택할 수 없다
const EMPTY: GenresConfig = { defaults: {}, genres: {} };

/**
 * 장르 설정. 틀렸으면 알리고 직전에 맞던 설정을, 그것도 없으면(기동 시점부터 틀림) 빈 설정을 돌려준다.
 * 기동을 멈추지 않는다. 고칠 대시보드가 실행돼야 한다(DB를 바깥에서 고쳤을 때 등)
 */
function genres(): GenresConfig {
  try {
    lastGood = checkedGenres();
    reported = "";
    return lastGood;
  } catch (error) {
    if (codeOf(error) !== "CONFIG_INVALID") throw error;
    const message = messageOf(error);
    if (message !== reported) log.error(L.config.genresInvalid({ error: message, kept: Boolean(lastGood) }));
    reported = message;
    return lastGood ?? EMPTY;
  }
}

/** 지금 장르 문서가 검사를 못 지나는가(직전 설정, 빈 설정으로 도는 중). 봇 상태 탭이 이유로 보인다 */
function genresBroken() {
  genres();
  return reported !== "";
}

function checkedGenres(): GenresConfig {
  const loaded = documents.get("genres");
  // 이름, 숫자 이름, 이모지도 같은 검사가 본다(대시보드 저장 전 검사와 같은 문구). 문제를 한 번에 다 알린다
  const shape = validateGenres(loaded);
  if (shape.length) {
    throw Object.assign(new Error(["자동재생 장르 설정 읽기 실패:", ...shape.map((p) => `   ${logRuleLine(p)}`)].join("\n")), { code: "CONFIG_INVALID" });
  }
  const data = loaded as Partial<GenresConfig>; // 검사를 지났다

  checkSourceKeys(data.genres || {});

  return { defaults: data.defaults || {}, genres: data.genres || {} };
}

/**
 * 그 장르의 소스 중 키가 없어 못 쓰는 것의 키 이름과 쓸 수 있는 소스 수. 소스가 하나도 없으면 CONFIG_INVALID 예외를 던진다.
 * 키가 없는 소스는 빼고 남은 것으로 돌고, 하나도 안 남으면 그 장르만 못 쓴다(선택하면 unusableGenre로 거절해 원인을 알린다).
 * 키를 입력할 대시보드가 봇과 함께 돌므로 기동은 멈추지 않는다
 */
function keyCheck(name: string, genre: Genre) {
  const list = Array.isArray(genre?.sources) ? genre.sources : [];
  if (!list.length) {
    throw Object.assign(logTextError(L.config.genreEmpty({ name })), { code: "CONFIG_INVALID" });
  }
  const missing: string[] = [];
  let alive = 0;
  for (const source of list) {
    if (usable(source?.type)) {
      alive++;
      continue;
    }
    if (sources.needsOf(source?.type) && !missing.includes(source.type)) missing.push(source.type);
  }
  return { missing, alive };
}

/** 이 장르를 지금 못 쓰면 키가 없는 소스 종류들, 쓸 수 있으면 null(모르는 장르도 null. 그쪽은 unknown-genre) */
function unusableGenre(name: string): string[] | null {
  const genre = genres().genres[name];
  if (!genre) return null;
  const { missing, alive } = keyCheck(name, genre);
  return alive ? null : missing;
}

function checkSourceKeys(genres: Record<string, Genre>) {
  // 같은 키가 빠진 장르를 묶어 한 줄로 알린다. 장르마다 한 줄이면 기동 로그가 경고로 덮인다
  const grouped = new Map<string, string[]>();
  const lines: LogText[] = [];

  const dead = new Map<string, string[]>();

  for (const [name, genre] of Object.entries(genres)) {
    const { missing, alive } = keyCheck(name, genre);
    if (!missing.length) continue;
    const key = missing.map(logSourceLabel).join(", ");
    const into = alive ? grouped : dead;
    into.set(key, [...(into.get(key) ?? []), name]);
  }

  for (const [missing, names] of grouped) {
    lines.push(L.config.genreSourcesDropped({ genres: names.join(", "), missing }));
  }
  for (const [missing, names] of dead) {
    lines.push(L.config.genreSourcesNone({ genres: names.join(", "), missing }));
  }

  // 곡을 선택할 때마다 불리므로 내용이 달라졌을 때만 남긴다
  const key = lines.join("|");
  if (lines.length && key !== warnedKeys) for (const line of lines) log.warn(line);
  warnedKeys = key;
}

/** 보여 줄 이름(디스코드 메뉴, 알림, 화면). 없거나 모르는 장르면 식별자 그대로 */
function labelOf(id: string): string {
  return genres().genres[id]?.label?.trim() || id;
}

export { genres, genresBroken, validateGenres, tidyGenres, unusableGenre, labelOf };
export const _reset = () => ((lastGood = null), (reported = ""));
export type { GenreSource, Genre, GenreDefaults, GenresConfig };
