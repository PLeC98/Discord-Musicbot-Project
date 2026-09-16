"use strict";

// config/*.yaml을 읽는 단일 통로.
//
// 왜 config/에 코드를 두지 않는가: 그 폴더는 운영자가 손으로 고치는 자리다. 편집 대상과 그것을 읽는
// 코드가 섞이면 무엇을 고쳐야 할지 헷갈린다. config/는 데이터만, 읽는 방법은 여기가 갖는다.
//
// 왜 YAML인가: 이 파일들은 주인이 둘이다 — 손으로 고치는 운영자와, 대시보드(계획 5단계).
// 기계가 통째로 다시 쓰면 사람이 적은 주석이 날아가는데, YAML은 주석·빈 줄을 보존하며 고쳐 쓸 수 있다.
//
// 왜 require 캐시를 건드리지 않는가: 데이터가 JS 모듈이 아니므로 모듈 캐시와 무관하다.
// mtime이 바뀐 것만 다시 읽는다 — 봇을 켜 둔 채로 고쳐도 다음 호출부터 반영된다.

const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const log = require("./logger").child({ category: "config" });

// 설정 파일이 놓이는 곳. 테스트가 여기만 갈아끼우면 실제 설정을 건드리지 않는다
// (CacheManager._cacheDir와 같은 방식 — 파일을 만지는 코드는 반드시 이 값을 거친다).
let configDir = path.join(__dirname, "..", "config");

// name -> { mtimeMs, value }
const cache = new Map();

const fileOf = (name) => path.join(configDir, `${name}.yaml`);
const exampleOf = (name) => path.join(configDir, `${name}.example.yaml`);

/**
 * 설정 파일 하나를 읽는다. 내용이 바뀌지 않았으면 읽은 것을 그대로 돌려준다.
 *
 * 기동 시 파일이 없으면 멈춘다(.env와 같은 취급) — 코드에 박힌 기본값으로 조용히 돌면
 * 설치가 어긋나도 아무도 모른 채 엉뚱한 설정으로 운영된다.
 * 반면 **돌던 중의 읽기·파싱 실패는 직전 값을 유지**한다. 저장하다 만 파일 한 번에 재생이 멈추면 안 된다.
 */
function load(name) {
  const file = fileOf(name);

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    const cached = cache.get(name);
    if (cached) {
      log.warn(`설정 파일을 찾지 못했습니다(직전 값 유지): ${file}`);
      return cached.value;
    }
    throw Object.assign(new Error(`설정 파일이 없습니다: ${file}\n   ${exampleOf(name)} 를 복사해 만드세요 (pnpm install이 자동으로 만듭니다).`), { code: "CONFIG_MISSING" });
  }

  const cached = cache.get(name);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value;

  let value;
  try {
    value = YAML.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object") throw new Error("내용이 비었습니다");
  } catch (error) {
    // 사람이 고치는 파일이라 문법 오류가 날 수 있다. 어디가 잘못됐는지 알려 주는 것이 중요하다.
    const detail = error?.message || error;
    if (cached) {
      log.warn(`설정 파일을 읽지 못했습니다(직전 값 유지): ${path.basename(file)} — ${detail}`);
      return cached.value;
    }
    throw Object.assign(new Error(`설정 파일을 읽지 못했습니다: ${file}\n   ${detail}\n   들여쓰기에 탭을 쓰지 않았는지 확인하세요(YAML은 공백만 받습니다).`), { code: "CONFIG_INVALID" });
  }

  if (cached) log.info(`설정을 다시 읽었습니다: ${path.basename(file)}`);
  cache.set(name, { mtimeMs: stat.mtimeMs, value });
  return value;
}

/**
 * 자동재생 장르 설정 — { defaults, genres }.
 *
 * 장르 키는 문자열이어야 한다. 이 라이브러리(YAML 1.2)에서 no·yes·on·off는 그냥 문자열이지만,
 * `true`/`false`/`null`은 값으로 읽혀 id가 조용히 뒤바뀐다(null 키는 빈 문자열이 된다).
 * 흔한 실수는 아니지만, 조용히 틀리는 종류라 거절하고 무엇을 고칠지 알린다.
 */
function genres() {
  const data = load("genres");
  const bad = Object.keys(data.genres || {}).filter((k) => k === "true" || k === "false" || k === "");
  if (bad.length) {
    const shown = bad.map((k) => (k === "" ? "null" : k)).join(", ");
    // 따옴표를 써도 파싱 뒤에는 같은 문자열이라 구분할 수 없다 — 아예 못 쓰는 이름으로 못박는다.
    throw Object.assign(new Error(`장르 id로 쓸 수 없는 이름입니다: ${shown}\n   true·false·null 은 YAML이 값으로 읽습니다. 다른 이름을 쓰세요.`), { code: "CONFIG_INVALID" });
  }
  return { defaults: data.defaults || {}, genres: data.genres || {} };
}

/** 봇 상태 메시지 설정 */
function status() {
  return load("status");
}

// ── 쓰기 (대시보드) ───────────────────────────────────────────────────────

/**
 * 받은 데이터를 문서에 **덮어쓰지 않고 맞춘다** — 바뀐 자리만 고친다.
 *
 * 통째로 다시 쓰면 사람이 적은 주석이 전부 날아간다. 손대지 않은 항목은 원문 그대로 두어야
 * 이 파일의 두 주인(운영자·대시보드)이 공존할 수 있다.
 *
 * 배열은 통째로 바꾼다 — 항목 사이 주석은 보존되지 않는다(검색어 목록에 주석을 다는 일은 드물다).
 */
function syncMap(doc, node, data, pathArr) {
  const keys = new Set(Object.keys(data));

  // 사라진 키 제거 — 그 키에 달린 주석도 함께 간다
  for (const item of [...(node?.items || [])]) {
    const key = String(item.key?.value ?? item.key);
    if (!keys.has(key)) doc.deleteIn([...pathArr, key]);
  }

  for (const [key, value] of Object.entries(data)) {
    const here = [...pathArr, key];
    const current = doc.getIn(here, true);
    const isPlainObject = value && typeof value === "object" && !Array.isArray(value);

    // 양쪽 다 맵이면 한 단계 더 들어가 바뀐 것만 고친다(안쪽 주석 보존)
    if (isPlainObject && YAML.isMap(current)) {
      syncMap(doc, current, value, here);
      continue;
    }

    // 값이 같으면 건드리지 않는다 — 손대면 서식만 바뀐다
    if (JSON.stringify(doc.getIn(here)) === JSON.stringify(value)) continue;

    doc.setIn(here, value);
  }
}

/**
 * 설정 파일을 고쳐 쓴다. 주석·빈 줄은 그대로 남는다.
 *
 * 임시 파일에 쓰고 원자적으로 옮긴다 — 반쯤 쓰인 파일을 로더가 읽는 일이 없어야 한다.
 */
function save(name, data) {
  if (!data || typeof data !== "object") throw Object.assign(new Error("저장할 내용이 없습니다"), { code: "CONFIG_INVALID" });

  const file = fileOf(name);
  const doc = YAML.parseDocument(fs.readFileSync(file, "utf8"));
  if (doc.errors?.length) {
    throw Object.assign(new Error(`설정 파일을 읽지 못해 저장할 수 없습니다: ${doc.errors[0].message}`), { code: "CONFIG_INVALID" });
  }

  syncMap(doc, doc.contents, data, []);

  const text = doc.toString({ lineWidth: 0 });
  // 쓴 것을 도로 읽어 확인한다 — 깨진 파일을 남기느니 저장을 거절한다
  const check = YAML.parse(text);
  if (!check || typeof check !== "object") throw Object.assign(new Error("저장 결과가 올바르지 않습니다"), { code: "CONFIG_INVALID" });

  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  cache.delete(name); // 다음 읽기가 새 내용을 가져간다
  log.info(`설정을 저장했습니다: ${path.basename(file)}`);
  return check;
}

/**
 * 장르 설정이 쓸 만한 모양인지 본다. 저장 전에 부른다 — 깨진 값을 파일에 남기지 않는다.
 * 반환: 문제 문구 배열(비어 있으면 통과).
 */
function validateGenres(data) {
  const problems = [];
  const ids = Object.keys(data?.genres || {});

  if (ids.length === 0) problems.push("장르가 하나도 없습니다.");
  // 디스코드 선택 메뉴는 25개까지만 받는다 — 넘기면 메뉴가 거부된다
  if (ids.length > 25) problems.push(`장르가 ${ids.length}개입니다. 디스코드 선택 메뉴는 25개까지만 보여줍니다.`);

  for (const id of ids) {
    if (id === "true" || id === "false" || id === "" || id === "null") problems.push(`"${id || "null"}"는 장르 id로 쓸 수 없습니다(YAML이 값으로 읽습니다).`);
    const genre = data.genres[id] || {};
    if (!genre.label) problems.push(`${id}: 표시 이름(label)이 비었습니다.`);
    const keywords = genre.keywords;
    if (!Array.isArray(keywords) || keywords.length === 0) problems.push(`${id}: 검색어(keywords)가 하나는 있어야 합니다.`);
    else if (keywords.some((k) => typeof k !== "string" || !k.trim())) problems.push(`${id}: 빈 검색어가 있습니다.`);
  }

  const d = data?.defaults || {};
  if (d.prefetchCount != null && !(Number(d.prefetchCount) >= 1)) problems.push("prefetchCount는 1 이상이어야 합니다.");
  if (d.minDurationSec != null && !(Number(d.minDurationSec) >= 0)) problems.push("minDurationSec은 0 이상이어야 합니다.");
  if (d.maxDurationSec != null && !(Number(d.maxDurationSec) > 0)) problems.push("maxDurationSec은 비우거나 0보다 커야 합니다.");
  if (d.minDurationSec != null && d.maxDurationSec != null && Number(d.minDurationSec) > Number(d.maxDurationSec)) problems.push("minDurationSec이 maxDurationSec보다 큽니다.");

  return problems;
}

// 테스트 시임 — 폴더를 바꾸면 읽어 둔 것도 버린다(다른 파일을 같은 이름으로 읽게 되므로).
function _setConfigDir(dir) {
  configDir = dir;
  cache.clear();
}

module.exports = { load, genres, status, save, validateGenres, fileOf, exampleOf, _setConfigDir, _cache: cache };
