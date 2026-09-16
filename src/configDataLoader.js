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

// 이모지 한 글자인가. \p{RGI_Emoji}는 국기·키캡처럼 코드포인트가 여럿인 것도 한 덩이로 센다.
// g 플래그가 없어 test()에 상태가 남지 않는다.
const ONE_EMOJI = /^\p{RGI_Emoji}$/v;

// 숫자만으로 된 이름 — JavaScript 객체가 정수처럼 생긴 키를 앞으로 당기는 탓에 장르 차례가
// 조용히 어긋난다("재즈 80 팝"이 "80 재즈 팝"이 된다). 차례는 선택 메뉴에 그대로 나오므로 막는다.
const NUMERIC_NAME = /^(0|[1-9][0-9]*)$/;

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
 * 장르 키는 곧 이름이며 문자열이어야 한다. 이 라이브러리(YAML 1.2)에서 no·yes·on·off는 그냥 문자열이지만,
 * `true`/`false`/`null`은 값으로 읽혀 id가 조용히 뒤바뀐다(null 키는 빈 문자열이 된다).
 * 흔한 실수는 아니지만, 조용히 틀리는 종류라 거절하고 무엇을 고칠지 알린다.
 */
function genres() {
  const data = load("genres");
  const bad = Object.keys(data.genres || {}).filter((k) => k === "true" || k === "false" || k === "");
  if (bad.length) {
    const shown = bad.map((k) => (k === "" ? "null" : k)).join(", ");
    // 따옴표를 써도 파싱 뒤에는 같은 문자열이라 구분할 수 없다 — 아예 못 쓰는 이름으로 못박는다.
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

  return { defaults: data.defaults || {}, genres: data.genres || {} };
}

/** 봇 상태 메시지 설정 */
// StatusManager의 TYPE_MAP과 같아야 한다(거기서 require하면 순환이 된다 — 테스트로 어긋남을 막는다)
const ACTIVITY_TYPES = ["Playing", "Listening", "Watching", "Competing", "Custom"];
const MAX_TEXT = 128; // 디스코드 활동 문구 길이 상한

// 같은 말을 되풀이하지 않는다 — 상태는 회전 주기마다 읽히기 때문이다
let warned = "";

function status() {
  const data = load("status");

  // 장르와 달리 여기서는 던지지 않는다. 이 함수는 setInterval 안에서 주기마다 불리므로,
  // 던지면 타이머에서 잡히지 않는 예외가 되어 상태가 틀린 것보다 나쁜 일이 벌어진다.
  // 대신 무엇이 잘못됐는지 남기고 그대로 돌려준다 — 손으로 고친 파일이 조용히 어긋나지 않게.
  const problems = validateStatus(data);
  const key = problems.join("|");
  if (problems.length && key !== warned) log.warn(`status.yaml: ${problems.join(" / ")}`);
  warned = key;

  return data;
}

// "MM-DD ~ MM-DD" / "HH:MM ~ HH:MM". 비교가 문자열 비교라 두 자리로 적지 않으면
// 형식이 틀린 게 아니라 "엉뚱한 날에 걸린다" — 그래서 모양까지 본다.
function rangeProblem(value, kind) {
  if (typeof value !== "string") return "글자로 적어야 합니다";
  const parts = value.split("~");
  if (parts.length !== 2) return `"${kind === "time" ? "22:00 ~ 06:00" : "12-24 ~ 12-26"}"처럼 ~ 로 나눠 적어야 합니다`;

  const shape = kind === "time" ? /^([01][0-9]|2[0-3]):[0-5][0-9]$/ : /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
  for (const part of parts.map((p) => p.trim())) {
    if (!shape.test(part)) return `"${part}"는 ${kind === "time" ? "HH:MM" : "MM-DD"} 두 자리로 적어야 합니다`;
  }
  return null;
}

function messageProblems(list, where) {
  const problems = [];
  if (!Array.isArray(list) || list.length === 0) return [`${where}: 문구가 하나는 있어야 합니다.`];

  for (const item of list) {
    const message = typeof item === "string" ? { text: item } : item;
    if (!message || typeof message !== "object") {
      problems.push(`${where}: 문구는 글자로 적거나 text/type으로 풀어 적어야 합니다.`);
      continue;
    }
    if (typeof message.text !== "string" || !message.text.trim()) problems.push(`${where}: 빈 문구가 있습니다.`);
    else if (message.text.length > MAX_TEXT) problems.push(`${where}: 문구가 ${MAX_TEXT}자를 넘습니다 — "${message.text.slice(0, 20)}…"`);
    // 종류를 잘못 적으면 조용히 "듣는 중"이 된다 — 오타가 말을 안 해 주는 종류라 여기서 잡는다
    if (message.type != null && !ACTIVITY_TYPES.includes(message.type)) problems.push(`${where}: "${message.type}"은 쓸 수 없는 활동 종류입니다(${ACTIVITY_TYPES.join(" · ")}).`);
  }
  return problems;
}

function validateStatus(data) {
  const problems = [];

  if (data?.interval != null && !(Number(data.interval) >= 10)) problems.push("interval은 10 이상이어야 합니다(초).");
  problems.push(...messageProblems(data?.messages, "평소 문구"));

  const special = data?.special;
  if (special != null && (typeof special !== "object" || Array.isArray(special))) {
    problems.push("special은 이름을 붙인 목록이어야 합니다.");
    return problems;
  }

  for (const [name, entry] of Object.entries(special || {})) {
    if (name === "true" || name === "false" || name === "" || name === "null") problems.push(`"${name || "null"}"는 이름으로 쓸 수 없습니다(YAML이 값으로 읽습니다).`);
    if (NUMERIC_NAME.test(name)) problems.push(`"${name}": 숫자만으로 된 이름은 차례가 어긋납니다. "${name}년"처럼 글자를 붙여 주세요.`);

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${name}: 내용이 비었습니다.`);
      continue;
    }

    // 조건이 하나도 없으면 항상 맞아서 아래 항목이 전부 죽는다 — 손으로 고치다 범위만 지우면 밟는다
    const kinds = ["date", "lunar", "time"].filter((k) => entry[k] != null);
    if (!kinds.length) problems.push(`${name}: date · lunar · time 중 하나는 있어야 합니다(없으면 항상 이 문구만 나옵니다).`);

    for (const kind of kinds) {
      const problem = rangeProblem(entry[kind], kind);
      if (problem) problems.push(`${name}의 ${kind}: ${problem}`);
    }

    problems.push(...messageProblems(entry.messages, name));
  }

  return problems;
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
// 목록도 자리마다 견줘 고친다. 통째로 갈아끼우면 그 안에 손으로 적어 둔 주석이 전부 날아간다.
// 자리를 기준으로 맞추므로 중간에 하나를 끼워 넣으면 그 아래 주석은 한 칸씩 밀린다 —
// 통째로 날리는 것보다는 낫다는 선택이다.
function syncSeq(doc, node, list, pathArr) {
  // 남는 자리는 뒤에서부터 지운다(앞에서 지우면 뒤 자리가 당겨진다)
  for (let i = node.items.length - 1; i >= list.length; i--) doc.deleteIn([...pathArr, i]);

  for (let i = 0; i < list.length; i++) {
    const value = list[i];
    const here = [...pathArr, i];

    if (i >= node.items.length) {
      doc.addIn(pathArr, value); // 새로 늘어난 자리
      continue;
    }

    const current = doc.getIn(here, true);
    if (value && typeof value === "object" && !Array.isArray(value) && YAML.isMap(current)) {
      syncMap(doc, current, value, here);
      continue;
    }
    if (Array.isArray(value) && YAML.isSeq(current)) {
      syncSeq(doc, current, value, here);
      continue;
    }
    if (JSON.stringify(doc.getIn(here)) === JSON.stringify(value)) continue;
    doc.setIn(here, value);
  }
}

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
    if (Array.isArray(value) && YAML.isSeq(current)) {
      syncSeq(doc, current, value, here);
      continue;
    }

    // 값이 같으면 건드리지 않는다 — 손대면 서식만 바뀐다
    if (JSON.stringify(doc.getIn(here)) === JSON.stringify(value)) continue;

    doc.setIn(here, value);
  }

  // 차례 맞추기 — 키도 값도 그대로인 채 순서만 바뀔 수 있다(대시보드에서 끌어 옮긴다).
  // 장르 차례는 선택 메뉴에 그대로 나오므로 저장되어야 한다.
  // 쌍을 통째로 옮기는 것이라 거기 달린 주석도 함께 간다.
  // 고치는 동안 갈아끼워졌을 수 있어 다시 집는다
  const target = pathArr.length ? doc.getIn(pathArr, true) : doc.contents;
  if (!YAML.isMap(target)) return;

  const order = [...keys];
  const keyOf = (item) => String(item.key?.value ?? item.key);
  const sorted = [...target.items].sort((a, b) => order.indexOf(keyOf(a)) - order.indexOf(keyOf(b)));
  if (sorted.some((item, i) => item !== target.items[i])) target.items = sorted;
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
    // 키가 곧 이름이다. YAML이 값으로 읽어 버리는 말은 이름으로 쓸 수 없다.
    if (id === "true" || id === "false" || id === "" || id === "null") problems.push(`"${id || "null"}"는 장르 이름으로 쓸 수 없습니다(YAML이 값으로 읽습니다).`);
    if (NUMERIC_NAME.test(id)) problems.push(`"${id}": 숫자만으로 된 이름은 차례가 어긋납니다. "${id}년대"처럼 글자를 붙여 주세요.`);
    // 이모지는 비워 둘 수 있다. 적었다면 한 글자여야 한다 — 파일을 손으로 고칠 수도 있어서 여기서 막는다.
    const emoji = (data.genres[id] || {}).emoji;
    if (emoji != null && emoji !== "" && !ONE_EMOJI.test(String(emoji))) problems.push(`${id}: emoji는 이모지 한 글자여야 합니다.`);
    const keywords = (data.genres[id] || {}).keywords;
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

module.exports = { load, genres, status, save, validateGenres, validateStatus, ACTIVITY_TYPES, fileOf, exampleOf, _setConfigDir, _cache: cache };
