"use strict";

// 자동재생 장르 설정(genres.yaml). 읽을 때 모양과 소스 키를 본다.

const log = require("../infra/log/logger").child({ category: "config" });
// 설정 검증과 실제 실행이 같은 표를 봐야 한다. 어긋나면 저장은 되는데 재생이 안 된다
const sources = require("./schema/genreSources");
const { load } = require("./yamlStore");
const { genreProblems, NUMERIC_NAME, ONE_EMOJI } = require("./schema/genres");

// 저장 전 검사(대시보드)와 읽을 때 검사가 같은 스키마를 본다
const validateGenres = genreProblems;

// 같은 말을 되풀이하지 않는다. genres()는 곡을 고를 때마다 불린다
let warnedKeys = "";

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

module.exports = { genres, validateGenres, NUMERIC_NAME };
