// 장르 설정("genres" 문서)의 스키마. 문제는 규칙 코드로 내고 문장은 rules/text가 그린다(무엇을 고칠지까지 적는다).

import { SPEC, TYPES } from "./genre-sources.ts";
import { ONE_TOKEN } from "../../rules/app-emoji-token.ts";
import { z, ALWAYS, coded, present, keyed, plain, problemsOf } from "./problems.ts";
import type { RuleProblem } from "../../rules/rule-problem.ts";
import { SELECT_MAX } from "../../rules/limits.ts";
import { sourceUrl } from "../../rules/source-url.ts";

// 이모지 한 글자인가. \p{RGI_Emoji}는 국기, 키캡처럼 코드포인트가 여럿인 것도 하나로 센다.
// g 플래그가 없어 test()에 상태가 남지 않는다.
const ONE_EMOJI = /^\p{RGI_Emoji}$/v;

// 숫자만으로 된 이름. JavaScript 객체가 정수처럼 생긴 키를 앞으로 당기는 탓에 장르 순서가
// 조용히 어긋난다("재즈 80 팝"이 "80 재즈 팝"이 된다). 순서는 선택 메뉴에 그대로 나오므로 막는다.
const NUMERIC_NAME = /^(0|[1-9][0-9]*)$/;

const filled = (v: unknown) => (Array.isArray(v) ? v.some((x) => String(x || "").trim()) : String(v || "").trim());

// 소스 한 줄. 종류마다 SPEC이 필요한 필드와 쓸 수 있는 값을 정한다
function sourceOf(type: string) {
  const spec = SPEC[type];
  return z
    .looseObject({
      type: z.literal(type),
      weight: present((v) => Number(v) >= 1, "genre-source-weight"),
      minScore: present((v) => Number(v) >= 0, "genre-source-min-score"),
    })
    .superRefine((source, ctx) => {
      // 안쪽 배열은 "이 중 하나는 있어야 한다"
      for (const group of spec.need) {
        if (!group.some((key) => filled(source[key]))) ctx.addIssue({ code: "custom", message: coded("genre-source-need", { type, fields: group.join(",") }) });
      }
      // 값이 정해져 있는 필드의 오타. 여기서 안 잡으면 저쪽이 422를 주고 그 소스가 조용히 빈손이 된다
      for (const [key, allowed] of Object.entries(spec.enums || {})) {
        if (source[key] == null) continue;
        for (const one of Array.isArray(source[key]) ? source[key] : [source[key]]) {
          if (!allowed.includes(one as string)) ctx.addIssue({ code: "custom", message: coded("genre-source-enum", { type, key, value: String(one), allowed: allowed.join(", ") }) });
        }
      }
      if (source.yearFrom != null && source.yearTo != null && Number(source.yearFrom) > Number(source.yearTo)) ctx.addIssue({ code: "custom", message: "genre-source-years" });
      if (source.minLength != null && source.maxLength != null && Number(source.minLength) > Number(source.maxLength)) ctx.addIssue({ code: "custom", message: "genre-source-lengths" });
    }, ALWAYS);
}

const [firstSource, ...restSources] = TYPES.map((type) => sourceOf(type));
const source = z.discriminatedUnion("type", [firstSource, ...restSources], {
  error: (issue) => (!issue.input || typeof issue.input !== "object" ? "genre-source-missing" : coded("genre-source-type", { type: String((issue.input as { type?: unknown }).type), types: TYPES.join(", ") })),
});

const genre = z.preprocess(
  plain,
  z.object({
    // 보여 줄 이름(디스코드 메뉴, 화면). 없으면 식별자를 그대로 보인다. 디스코드 선택지 이름은 100자까지
    label: present((v) => typeof v === "string" && v.trim() !== "" && v.length <= 100, "genre-label"),
    emoji: present((v) => v === "" || ONE_EMOJI.test(String(v)) || ONE_TOKEN.test(String(v)), "genre-emoji"),
    // 맨 위 keywords: 는 읽지 않고 sources로 옮기라고 알린다(두 형식을 함께 받지 않는다)
    keywords: z
      .unknown()
      .refine((v) => v === undefined, { error: "genre-old-keywords" })
      .optional(),
    sources: z.array(source, { error: "genre-no-sources" }).min(1, { error: "genre-no-sources" }),
    // 기본값의 길이는 장르마다 덮어쓸 수 있다. 실제 범위는 기본값 위에 얹어 아래 genresFile이 본다(제외 키워드는 키워드 출처 필드가 덮어쓴다)
    minDurationSec: present((v) => Number(v) >= 0, "genre-min-duration"),
    maxDurationSec: present((v) => Number(v) > 0, "genre-max-duration"),
    // 미리 준비해 둘 곡 수는 기본값에만 둔다. 재생도 장르와 상관없이 기본값만 본다
    prefetchCount: z
      .unknown()
      .refine((v) => v === undefined, { error: "genre-prefetch" })
      .optional(),
  }),
);

const genres = z.preprocess(
  keyed,
  z.record(z.string(), genre).superRefine((all, ctx) => {
    const ids = Object.keys(all);
    if (ids.length === 0) ctx.addIssue({ code: "custom", message: "genres-empty" });
    // 장르 선택은 디스코드 선택 메뉴 하나다
    if (ids.length > SELECT_MAX) ctx.addIssue({ code: "custom", message: coded("genres-too-many", { count: ids.length, max: SELECT_MAX }) });
    for (const id of ids) {
      // 키가 식별자다(주소, 버튼 id, AI의 {{genre}}). 화면처럼 앞뒤 공백을 뺀 이름으로 본다
      if (!id.trim()) ctx.addIssue({ code: "custom", message: "genre-id-empty" });
      if (NUMERIC_NAME.test(id)) ctx.addIssue({ code: "custom", message: coded("genre-id-numeric", { id }) });
      // 디스코드 선택지 값(식별자)은 100자까지
      if (id.length > 100) ctx.addIssue({ code: "custom", message: coded("genre-id-long", { head: id.slice(0, 20) }) });
    }
  }, ALWAYS),
);

/** 문서의 defaults에 필드가 없을 때 봇이 쓰는 값. 길이 상한(maxDurationSec)은 비우면 없다. 대시보드도 비운 입력란에 이 값을 보인다 */
const GENRE_DEFAULTS = { prefetchCount: 1, minDurationSec: 60, maxDurationSec: null } as const;

const defaults = z.preprocess(
  plain,
  z
    .object({
      prefetchCount: present((v) => Number(v) >= 1, "defaults-prefetch"),
      minDurationSec: present((v) => Number(v) >= 0, "defaults-min-duration"),
      maxDurationSec: present((v) => Number(v) > 0, "defaults-max-duration"),
      // 제외 키워드. 키워드 출처의 후보(유튜브 검색 결과)에만 건다. 다른 출처는 곡 이름이 확실해 오탐만 낸다
      blockedKeywords: present(Array.isArray, "defaults-blocked"),
    })
    .superRefine((d, ctx) => {
      if (d.maxDurationSec == null) return;
      const min = d.minDurationSec ?? GENRE_DEFAULTS.minDurationSec;
      if (Number(min) <= Number(d.maxDurationSec)) return;
      const message = d.minDurationSec == null ? coded("defaults-max-below-default", { max: String(d.maxDurationSec), min: String(min) }) : "defaults-durations";
      ctx.addIssue({ code: "custom", message });
    }, ALWAYS),
);

// 장르가 길이를 덮어쓰면 그 장르의 실제 범위는 기본값 위에 얹은 것이다. 덮어쓰지 않은 장르는 기본값의 검사가 본다
const genresFile = z.preprocess(
  plain,
  z.object({ genres, defaults }).superRefine((file, ctx) => {
    const base = plain(file.defaults);
    for (const [id, genre] of Object.entries(plain(file.genres))) {
      const own = plain(genre);
      if (own.minDurationSec == null && own.maxDurationSec == null) continue;
      const min = own.minDurationSec ?? base.minDurationSec ?? GENRE_DEFAULTS.minDurationSec;
      const max = own.maxDurationSec ?? base.maxDurationSec;
      if (min != null && max != null && Number(min) > Number(max)) ctx.addIssue({ code: "custom", message: coded("genre-durations", { id, min: String(min), max: String(max) }) });
    }
  }, ALWAYS),
);

/** 장르 설정의 문제 목록. 없으면 빈 배열. 위치 값은 장르 식별자(id)와 몇 번째 소스(source) */
function genreProblems(data: unknown): RuleProblem[] {
  return problemsOf(genresFile, data, ([, id, , index]) => ({ id: id === undefined ? undefined : String(id), source: index === undefined ? undefined : Number(index) + 1 }));
}

/** 저장할 모양으로 다듬은 사본. 출처 주소에서 목록을 가리키지 않는 쿼리를 버린다(rules/source-url). 모양이 다른 곳은 손대지 않는다 */
function tidyGenres(data: unknown): unknown {
  const genres = (data as { genres?: unknown } | null)?.genres;
  if (!genres || typeof genres !== "object") return data;
  const copy = structuredClone(data) as { genres: Record<string, { sources?: unknown }> };
  for (const genre of Object.values(copy.genres)) {
    if (!Array.isArray(genre?.sources)) continue;
    for (const source of genre.sources as Array<{ type?: unknown; url?: unknown } | null>) {
      if (typeof source?.type === "string" && typeof source.url === "string") source.url = sourceUrl(source.type, source.url);
    }
  }
  return copy;
}

export { genreProblems, tidyGenres, GENRE_DEFAULTS, NUMERIC_NAME, ONE_EMOJI };
