// 장르 설정(genres.yaml)의 스키마. 문구는 무엇을 고쳐야 하는지까지 알려 주므로 그대로 둔다.

import genreSources from "./genreSources.ts";
const { SPEC, TYPES } = genreSources;
import problems from "./problems.ts";
const { z, ALWAYS, present, keyed, plain, problemsOf } = problems;

// 이모지 한 글자인가. \p{RGI_Emoji}는 국기·키캡처럼 코드포인트가 여럿인 것도 한 덩이로 센다.
// g 플래그가 없어 test()에 상태가 남지 않는다.
const ONE_EMOJI = /^\p{RGI_Emoji}$/v;

// 숫자만으로 된 이름. JavaScript 객체가 정수처럼 생긴 키를 앞으로 당기는 탓에 장르 차례가
// 조용히 어긋난다("재즈 80 팝"이 "80 재즈 팝"이 된다). 차례는 선택 메뉴에 그대로 나오므로 막는다.
const NUMERIC_NAME = /^(0|[1-9][0-9]*)$/;

// 키가 곧 이름이다. YAML이 값으로 읽어 버리는 말은 이름으로 쓸 수 없다.
const YAML_WORDS = ["true", "false", "", "null"];

const filled = (v: unknown) => (Array.isArray(v) ? v.some((x) => String(x || "").trim()) : String(v || "").trim());

// 소스 한 줄. 종류마다 SPEC 이 필요한 칸과 쓸 수 있는 값을 정한다
function sourceOf(type: string) {
  const spec = SPEC[type];
  const at = `{where}(${spec.label})`;
  return z
    .looseObject({
      type: z.literal(type),
      weight: present((v) => Number(v) >= 1, "{where}: weight는 1 이상이어야 합니다."),
      minScore: present((v) => Number(v) >= 0, "{where}: minScore는 0 이상이어야 합니다."),
    })
    .superRefine((source, ctx) => {
      // 안쪽 배열은 "이 중 하나는 있어야 한다"
      for (const group of spec.need) {
        if (!group.some((key) => filled(source[key]))) ctx.addIssue({ code: "custom", message: `${at}: ${group.join(" 또는 ")} 를 적어야 합니다.` });
      }
      // 값이 정해져 있는 칸의 오타. 여기서 안 잡으면 저쪽이 422를 주고 그 소스가 조용히 빈손이 된다
      for (const [key, allowed] of Object.entries(spec.enums || {})) {
        if (source[key] == null) continue;
        for (const one of Array.isArray(source[key]) ? source[key] : [source[key]]) {
          if (!allowed.includes(one as string)) ctx.addIssue({ code: "custom", message: `${at}: ${key}에 "${one}"는 쓸 수 없습니다. 쓸 수 있는 것: ${allowed.join(", ")}` });
        }
      }
      if (source.yearFrom != null && source.yearTo != null && Number(source.yearFrom) > Number(source.yearTo)) ctx.addIssue({ code: "custom", message: "{where}: yearFrom이 yearTo보다 큽니다." });
      if (source.minLength != null && source.maxLength != null && Number(source.minLength) > Number(source.maxLength)) ctx.addIssue({ code: "custom", message: "{where}: minLength가 maxLength보다 큽니다." });
    }, ALWAYS);
}

const [firstSource, ...restSources] = TYPES.map((type) => sourceOf(type));
const source = z.discriminatedUnion("type", [firstSource, ...restSources], {
  error: (issue) => (!issue.input || typeof issue.input !== "object" ? "{where}: type과 값을 적어야 합니다." : `{where}: 모르는 종류입니다(${(issue.input as { type?: unknown }).type}). 쓸 수 있는 것: ${TYPES.join(", ")}`),
});

const genre = z.preprocess(
  plain,
  z.object({
    // 이모지는 비워 둘 수 있다. 적었다면 한 글자여야 한다. 파일을 손으로 고칠 수도 있어서 여기서 막는다.
    emoji: present((v) => v === "" || ONE_EMOJI.test(String(v)), "{id}: emoji는 이모지 한 글자여야 합니다."),
    // 맨 위 keywords:는 읽지 않는다. 한때 "sources가 없으면 그걸 keyword 소스로 읽자"고 했는데,
    // 그건 축약이 아니라 영구 호환층이다. 새로 쓰는 사람이 keywords:를 고를 이유가 없다.
    // 한 번 크게 깨지고 끝나는 편이 두 모양을 영원히 들고 가는 것보다 낫다.
    keywords: z
      .unknown()
      .refine((v) => v === undefined, { error: "{id}: 맨 위 keywords: 는 더 이상 쓰지 않습니다. sources: 로 옮겨 주세요. sources: [{ type: keyword, keywords: [...] }]" })
      .optional(),
    sources: z.array(source, { error: "{id}: 소스(sources)가 하나는 있어야 합니다." }).min(1, { error: "{id}: 소스(sources)가 하나는 있어야 합니다." }),
  }),
);

const genres = z.preprocess(
  keyed,
  z.record(z.string(), genre).superRefine((all, ctx) => {
    const ids = Object.keys(all);
    if (ids.length === 0) ctx.addIssue({ code: "custom", message: "장르가 하나도 없습니다." });
    // 디스코드 선택 메뉴는 25개까지만 받는다. 넘기면 메뉴가 거부된다
    if (ids.length > 25) ctx.addIssue({ code: "custom", message: `장르가 ${ids.length}개입니다. 디스코드 선택 메뉴는 25개까지만 보여줍니다.` });
    for (const id of ids) {
      if (YAML_WORDS.includes(id)) ctx.addIssue({ code: "custom", message: `"${id || "null"}"는 장르 이름으로 쓸 수 없습니다(YAML이 값으로 읽습니다).` });
      if (NUMERIC_NAME.test(id)) ctx.addIssue({ code: "custom", message: `"${id}": 숫자만으로 된 이름은 차례가 어긋납니다. "${id}년대"처럼 글자를 붙여 주세요.` });
    }
  }, ALWAYS),
);

const defaults = z.preprocess(
  plain,
  z
    .object({
      prefetchCount: present((v) => Number(v) >= 1, "prefetchCount는 1 이상이어야 합니다."),
      minDurationSec: present((v) => Number(v) >= 0, "minDurationSec은 0 이상이어야 합니다."),
      maxDurationSec: present((v) => Number(v) > 0, "maxDurationSec은 비우거나 0보다 커야 합니다."),
    })
    .superRefine((d, ctx) => {
      if (d.minDurationSec != null && d.maxDurationSec != null && Number(d.minDurationSec) > Number(d.maxDurationSec)) ctx.addIssue({ code: "custom", message: "minDurationSec이 maxDurationSec보다 큽니다." });
    }, ALWAYS),
);

const genresFile = z.preprocess(plain, z.object({ genres, defaults }));

/** 장르 설정의 문제 목록. 없으면 빈 배열 */
function genreProblems(data: unknown): string[] {
  return problemsOf(genresFile, data, ([, id, , index]) => ({ id, where: `${String(id)}의 ${Number(index) + 1}번째 소스` }));
}

const exported = { genreProblems, NUMERIC_NAME, ONE_EMOJI };
export default exported;
export { exported as "module.exports" };
