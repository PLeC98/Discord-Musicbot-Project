"use strict";

// 자동재생 장르 설정(genres.yaml). 읽을 때 모양과 소스 키를 본다.

const log = require("../infra/log/logger").child({ category: "config" });
// 설정 검증과 실제 실행이 같은 표를 봐야 한다. 어긋나면 저장은 되는데 재생이 안 된다
const sources = require("./schema/genreSources");
const { load } = require("./yamlStore");

// 같은 말을 되풀이하지 않는다. genres()는 곡을 고를 때마다 불린다
let warnedKeys = "";

// 이모지 한 글자인가. \p{RGI_Emoji}는 국기·키캡처럼 코드포인트가 여럿인 것도 한 덩이로 센다.
// g 플래그가 없어 test()에 상태가 남지 않는다.
const ONE_EMOJI = /^\p{RGI_Emoji}$/v;

// 숫자만으로 된 이름. JavaScript 객체가 정수처럼 생긴 키를 앞으로 당기는 탓에 장르 차례가
// 조용히 어긋난다("재즈 80 팝"이 "80 재즈 팝"이 된다). 차례는 선택 메뉴에 그대로 나오므로 막는다.
const NUMERIC_NAME = /^(0|[1-9][0-9]*)$/;

/**
 * 자동재생 장르 설정. { defaults, genres }.
 *
 * 장르 키는 곧 이름이며 문자열이어야 한다. 이 라이브러리(YAML 1.2)에서 no·yes·on·off는 그냥 문자열이지만,
 * `true`/`false`/`null`은 값으로 읽혀 id가 조용히 뒤바뀐다(null 키는 빈 문자열이 된다).
 * 흔한 실수는 아니지만, 조용히 틀리는 종류라 거절하고 무엇을 고칠지 알린다.
 */
function genres() {
  const data = load("genres");
  const bad = Object.keys(data.genres || {}).filter((k) => k === "true" || k === "false" || k === "");
  if (bad.length) {
    const shown = bad.map((k) => (k === "" ? "null" : k)).join(", ");
    // 따옴표를 써도 파싱 뒤에는 같은 문자열이라 구분할 수 없다. 아예 못 쓰는 이름으로 못박는다.
    throw Object.assign(new Error(`장르 이름으로 쓸 수 없습니다: ${shown}\n   true·false·null 은 YAML이 값으로 읽습니다. 다른 이름을 쓰세요.`), { code: "CONFIG_INVALID" });
  }
  const numeric = Object.keys(data.genres || {}).filter((k) => NUMERIC_NAME.test(k));
  if (numeric.length) {
    throw Object.assign(new Error(`장르 이름으로 쓸 수 없습니다: ${numeric.join(", ")}\n   숫자만으로 된 이름은 차례가 어긋납니다. "80년대"처럼 글자를 붙여 주세요.`), { code: "CONFIG_INVALID" });
  }

  // 이모지가 아닌 값이 하나라도 있으면 디스코드가 선택 메뉴 전체를 거부한다.
  // 손으로 고친 파일이 /autoplay에서 터지지 않도록 읽는 자리에서 먼저 잡는다.
  const badEmoji = Object.entries(data.genres || {}).filter(([, g]) => g?.emoji != null && g.emoji !== "" && !ONE_EMOJI.test(String(g.emoji)));
  if (badEmoji.length) {
    const shown = badEmoji.map(([k, g]) => `${k}: ${g.emoji}`).join(", ");
    throw Object.assign(new Error(`이모지가 아닌 값이 있습니다: ${shown}\n   emoji는 비우거나 이모지 한 글자만 적을 수 있습니다.`), { code: "CONFIG_INVALID" });
  }

  const shape = validateGenres(data);
  if (shape.length) {
    throw Object.assign(new Error(["config/genres.yaml 을 읽을 수 없습니다:", ...shape.map((p) => `   ${p}`)].join("\n")), { code: "CONFIG_INVALID" });
  }

  checkSourceKeys(data.genres || {});

  return { defaults: data.defaults || {}, genres: data.genres || {} };
}

/**
 * .env에 키가 없는 소스를 어떻게 다룰까. 부분만 없으면 알리고 남은 것으로 돌고,
 * 쓸 수 있는 게 하나도 안 남으면 기동을 거부한다.
 *
 * 장르 하나가 삐끗했다고 봇 전체를 못 띄우는 것은 과하지만, 그 장르를 고르면 아무 일도 일어나지
 * 않는 채로 두는 것은 더 나쁘다. 무엇이 잘못됐는지 알 길이 없기 때문이다.
 */
function checkSourceKeys(genres) {
  // 같은 키가 빠진 장르를 묶어 한 줄로 알린다. 장르마다 한 줄이면 기동 로그가 경고로 덮인다
  const grouped = new Map();
  const lines = [];

  for (const [name, genre] of Object.entries(genres)) {
    const list = Array.isArray(genre?.sources) ? genre.sources : [];
    const missing = [];
    let alive = 0;

    for (const source of list) {
      if (sources.usable(source?.type)) alive++;
      else {
        const need = sources.needsOf(source?.type);
        if (need && !missing.includes(need.label)) missing.push(need.label);
      }
    }

    if (!list.length) {
      throw Object.assign(new Error(`자동재생 장르 ${name}에 소스와 키워드가 하나도 없습니다. config/genres.yaml을 확인하세요.`), { code: "CONFIG_INVALID" });
    }
    if (!alive) {
      throw Object.assign(new Error(`자동재생 장르 ${name}에 사용되는 소스인 ${missing.join(", ")}의 키가 .env에 없어 재생이 불가능합니다. 설정을 확인하세요.`), { code: "CONFIG_INVALID" });
    }
    if (missing.length) {
      const key = missing.join(", ");
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(name);
    }
  }

  for (const [missing, names] of grouped) {
    lines.push(`자동재생 장르 ${names.join(", ")}에 사용되는 소스 중 ${missing}의 키가 .env에 존재하지 않습니다. 지정된 다른 소스만을 이용합니다.`);
  }

  // 이 함수는 곡을 고를 때마다 불린다(MusicPlayer._autoplayConfig). 그대로 남기면 같은 경고가
  // 몇 분마다 되풀이되므로, 내용이 달라졌을 때만 남긴다. status()가 쓰는 것과 같은 손이다.
  const key = lines.join("|");
  if (lines.length && key !== warnedKeys) for (const line of lines) log.warn(line);
  warnedKeys = key;
}

// 장르 하나의 sources를 본다. 반환: 문제 문구 배열.
//
// 맨 위 keywords:는 읽지 않는다. 한때 "sources가 없으면 그걸 keyword 소스로 읽자"고 했는데,
// 그건 축약이 아니라 영구 호환층이다. 새로 쓰는 사람이 keywords:를 고를 이유가 없다.
// 한 번 크게 깨지고 끝나는 편이 두 모양을 영원히 들고 가는 것보다 낫다.
function sourceProblems(id, genre) {
  const problems = [];

  if (genre.keywords !== undefined) {
    problems.push(`${id}: 맨 위 keywords: 는 더 이상 쓰지 않습니다. sources: 로 옮겨 주세요. sources: [{ type: keyword, keywords: [...] }]`);
  }

  const list = genre.sources;
  if (!Array.isArray(list) || list.length === 0) {
    problems.push(`${id}: 소스(sources)가 하나는 있어야 합니다.`);
    return problems;
  }

  list.forEach((source, i) => {
    const where = `${id}의 ${i + 1}번째 소스`;
    if (!source || typeof source !== "object") return problems.push(`${where}: type과 값을 적어야 합니다.`);

    const spec = sources.SPEC[source.type];
    if (!spec) return problems.push(`${where}: 모르는 종류입니다(${source.type}). 쓸 수 있는 것: ${sources.TYPES.join(", ")}`);

    // 안쪽 배열은 "이 중 하나는 있어야 한다"
    for (const group of spec.need) {
      const filled = group.some((key) => {
        const v = source[key];
        return Array.isArray(v) ? v.some((x) => String(x || "").trim()) : String(v || "").trim();
      });
      if (!filled) problems.push(`${where}(${spec.label}): ${group.join(" 또는 ")} 를 적어야 합니다.`);
    }

    // 값이 정해져 있는 칸의 오타. 여기서 안 잡으면 저쪽이 422를 주고 그 소스가 조용히 빈손이 된다
    for (const [key, allowed] of Object.entries(spec.enums || {})) {
      if (source[key] == null) continue;
      for (const one of Array.isArray(source[key]) ? source[key] : [source[key]]) {
        if (!allowed.includes(one)) problems.push(`${where}(${spec.label}): ${key}에 "${one}"는 쓸 수 없습니다. 쓸 수 있는 것: ${allowed.join(", ")}`);
      }
    }

    if (source.weight != null && !(Number(source.weight) >= 1)) problems.push(`${where}: weight는 1 이상이어야 합니다.`);
    if (source.yearFrom != null && source.yearTo != null && Number(source.yearFrom) > Number(source.yearTo)) problems.push(`${where}: yearFrom이 yearTo보다 큽니다.`);
    if (source.minScore != null && !(Number(source.minScore) >= 0)) problems.push(`${where}: minScore는 0 이상이어야 합니다.`);
    if (source.minLength != null && source.maxLength != null && Number(source.minLength) > Number(source.maxLength)) problems.push(`${where}: minLength가 maxLength보다 큽니다.`);
  });

  return problems;
}

/**
 * 장르 설정이 쓸 만한 모양인지 본다. 저장 전에 부른다. 깨진 값을 파일에 남기지 않는다.
 * 반환: 문제 문구 배열(비어 있으면 통과).
 */
function validateGenres(data) {
  const problems = [];
  const ids = Object.keys(data?.genres || {});

  if (ids.length === 0) problems.push("장르가 하나도 없습니다.");
  // 디스코드 선택 메뉴는 25개까지만 받는다. 넘기면 메뉴가 거부된다
  if (ids.length > 25) problems.push(`장르가 ${ids.length}개입니다. 디스코드 선택 메뉴는 25개까지만 보여줍니다.`);

  for (const id of ids) {
    // 키가 곧 이름이다. YAML이 값으로 읽어 버리는 말은 이름으로 쓸 수 없다.
    if (id === "true" || id === "false" || id === "" || id === "null") problems.push(`"${id || "null"}"는 장르 이름으로 쓸 수 없습니다(YAML이 값으로 읽습니다).`);
    if (NUMERIC_NAME.test(id)) problems.push(`"${id}": 숫자만으로 된 이름은 차례가 어긋납니다. "${id}년대"처럼 글자를 붙여 주세요.`);
    // 이모지는 비워 둘 수 있다. 적었다면 한 글자여야 한다. 파일을 손으로 고칠 수도 있어서 여기서 막는다.
    const emoji = (data.genres[id] || {}).emoji;
    if (emoji != null && emoji !== "" && !ONE_EMOJI.test(String(emoji))) problems.push(`${id}: emoji는 이모지 한 글자여야 합니다.`);
    problems.push(...sourceProblems(id, data.genres[id] || {}));
  }

  const d = data?.defaults || {};
  if (d.prefetchCount != null && !(Number(d.prefetchCount) >= 1)) problems.push("prefetchCount는 1 이상이어야 합니다.");
  if (d.minDurationSec != null && !(Number(d.minDurationSec) >= 0)) problems.push("minDurationSec은 0 이상이어야 합니다.");
  if (d.maxDurationSec != null && !(Number(d.maxDurationSec) > 0)) problems.push("maxDurationSec은 비우거나 0보다 커야 합니다.");
  if (d.minDurationSec != null && d.maxDurationSec != null && Number(d.minDurationSec) > Number(d.maxDurationSec)) problems.push("minDurationSec이 maxDurationSec보다 큽니다.");

  return problems;
}

module.exports = { genres, validateGenres, NUMERIC_NAME };
