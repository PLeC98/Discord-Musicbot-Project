// 자동재생 장르 설정(settings.db 의 "genres" 문서, config/documents). 읽을 때 모양과 소스 키를 본다.

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "config" });
// 설정 검증과 실제 실행이 같은 표를 봐야 한다. 어긋나면 저장은 되는데 재생이 안 된다
import * as sources from "./schema/genre-sources.ts";
import { usable } from "./source-keys.ts";
import * as documents from "./documents.ts";
import { genreProblems } from "./schema/genres.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";

// 저장 전 검사(대시보드)와 읽을 때 검사가 같은 스키마를 본다
const validateGenres = genreProblems;

/**
 * 소스 한 줄. type 말고 어떤 필드가 있는지는 종류마다 다르다(genreSources 의 SPEC).
 * 검사는 필요한 필드와 선택할 값만 본다. 목록 필드는 편집기가 배열로 쓰고, 수 필드는 글자로 적어도 통과해 읽는 쪽이 Number 로 바꾼다
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
// 수 필드는 글자로 적어도 검사를 통과한다. 읽는 쪽이 Number 로 바꾼다
type GenreDefaults = { prefetchCount?: unknown; minDurationSec?: unknown; maxDurationSec?: unknown; blockedKeywords?: unknown[] };
type GenresConfig = { defaults: GenreDefaults; genres: Record<string, Genre> };

// 같은 말을 되풀이하지 않는다. genres()는 곡을 선택할 때마다 불린다
let warnedKeys = "";

/**
 * 자동재생 장르 설정. { defaults, genres }.
 *
 * 장르 키는 식별자(주소 · 버튼 id · AI 의 {{genre}})이고 보여 줄 이름은 label(없으면 키)이다. 키는 문자열이어야 한다. 이 라이브러리(YAML 1.2)에서 no·yes·on·off는 그냥 문자열이지만,
 * `true`/`false`/`null`은 값으로 읽혀 id가 조용히 뒤바뀐다(null 키는 빈 문자열이 된다).
 * 흔한 실수는 아니지만, 조용히 틀리는 종류라 거절하고 무엇을 고칠지 알린다.
 */
// 직전에 검사를 지난 설정. 돌던 중 파일이 틀리면 이것으로 계속 돈다(status 와 같다)
let lastGood: GenresConfig | null = null;
let reported = "";

// 맞는 설정이 한 번도 없었을 때. 장르가 없으니 자동재생을 선택할 수 없다
const EMPTY: GenresConfig = { defaults: {}, genres: {} };

/**
 * 장르 설정. 틀렸으면 알리고 직전에 맞던 설정을, 그것도 없으면(기동 때부터 틀림) 빈 설정을 돌려준다.
 * 기동을 멈추지 않는다. 고칠 대시보드가 실행돼야 한다(DB 를 바깥에서 고쳤을 때 등)
 */
function genres(): GenresConfig {
  try {
    lastGood = checkedGenres();
    reported = "";
    return lastGood;
  } catch (error) {
    if (codeOf(error) !== "CONFIG_INVALID") throw error;
    const message = messageOf(error);
    if (message !== reported) log.error(`${message}\n   ${lastGood ? "고칠 때까지 직전에 맞던 설정으로 돕니다." : "고칠 때까지 자동재생 장르가 없습니다. 운영자 패널의 자동재생 탭에서 고치세요."}`);
    reported = message;
    return lastGood ?? EMPTY;
  }
}

/** 지금 장르 문서가 검사를 못 지나는가(직전 설정 · 빈 설정으로 도는 중). 봇 상태 탭이 까닭으로 보인다 */
function genresBroken() {
  genres();
  return reported !== "";
}

function checkedGenres(): GenresConfig {
  const loaded = documents.get("genres");
  // 이름 · 숫자 이름 · 이모지도 같은 검사가 본다(대시보드 저장 전 검사와 같은 문구). 문제를 한 번에 다 알린다
  const shape = validateGenres(loaded);
  if (shape.length) {
    throw Object.assign(new Error(["자동재생 장르 설정을 읽을 수 없습니다:", ...shape.map((p) => `   ${p}`)].join("\n")), { code: "CONFIG_INVALID" });
  }
  const data = loaded as Partial<GenresConfig>; // 검사를 지났다

  checkSourceKeys(data.genres || {});

  return { defaults: data.defaults || {}, genres: data.genres || {} };
}

/**
 * 키가 없는 소스를 어떻게 다룰까. 부분만 없으면 알리고 남은 것으로 돈다.
 * 쓸 수 있는 소스가 하나도 없으면 그 장르만 못 쓴다: 선택하면 키가 없다고 거절한다(unusableGenre).
 *
 * 기동은 멈추지 않는다. 키를 입력할 대시보드도 봇과 함께 실행되기 때문이다.
 * 그렇다고 그 장르를 선택하면 아무 일도 일어나지 않는 채로 두지 않는다. 무엇이 잘못됐는지 알 길이 없기 때문이다.
 */
// 그 장르의 소스 중 키가 없어 못 쓰는 것의 키 이름과 쓸 수 있는 소스 수
function keyCheck(name: string, genre: Genre) {
  const list = Array.isArray(genre?.sources) ? genre.sources : [];
  if (!list.length) {
    throw Object.assign(new Error(`자동재생 장르 ${name}에 소스와 키워드가 하나도 없습니다. 운영자 패널의 자동재생 탭에서 확인하세요.`), { code: "CONFIG_INVALID" });
  }
  const missing: string[] = [];
  let alive = 0;
  for (const source of list) {
    if (usable(source?.type)) {
      alive++;
      continue;
    }
    const need = sources.needsOf(source?.type);
    if (need && !missing.includes(need.label)) missing.push(need.label);
  }
  return { missing, alive };
}

/** 이 장르를 지금 못 쓰면 빠진 키 이름들, 쓸 수 있으면 null(모르는 장르도 null. 그쪽은 unknown-genre) */
function unusableGenre(name: string): string[] | null {
  const genre = genres().genres[name];
  if (!genre) return null;
  const { missing, alive } = keyCheck(name, genre);
  return alive ? null : missing;
}

function checkSourceKeys(genres: Record<string, Genre>) {
  // 같은 키가 빠진 장르를 묶어 한 줄로 알린다. 장르마다 한 줄이면 기동 로그가 경고로 덮인다
  const grouped = new Map<string, string[]>();
  const lines: string[] = [];

  const dead = new Map<string, string[]>();

  for (const [name, genre] of Object.entries(genres)) {
    const { missing, alive } = keyCheck(name, genre);
    if (!missing.length) continue;
    const key = missing.join(", ");
    const into = alive ? grouped : dead;
    into.set(key, [...(into.get(key) ?? []), name]);
  }

  for (const [missing, names] of grouped) {
    lines.push(`자동재생 장르 ${names.join(", ")}: ${missing} 키가 없어 그 소스를 빼고 나머지 소스만 씁니다.`);
  }
  for (const [missing, names] of dead) {
    lines.push(`자동재생 장르 ${names.join(", ")}: ${missing} 키가 없어 쓸 소스가 없습니다. 키를 입력하기 전까지 이 장르는 선택할 수 없습니다.`);
  }

  // 이 함수는 곡을 선택할 때마다 불린다(Player._autoplayConfig). 그대로 남기면 같은 경고가
  // 몇 분마다 되풀이되므로, 내용이 달라졌을 때만 남긴다. status()가 쓰는 것과 같은 방식이다.
  const key = lines.join("|");
  if (lines.length && key !== warnedKeys) for (const line of lines) log.warn(line);
  warnedKeys = key;
}

/** 보여 줄 이름(디스코드 메뉴 · 알림 · 화면). 없거나 모르는 장르면 식별자 그대로 */
function labelOf(id: string): string {
  return genres().genres[id]?.label?.trim() || id;
}

export { genres, genresBroken, validateGenres, unusableGenre, labelOf };
export const _reset = () => ((lastGood = null), (reported = ""));
export type { GenreSource, Genre, GenreDefaults, GenresConfig };
