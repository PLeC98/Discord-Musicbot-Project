"use strict";

// config/*.yaml을 읽는 단일 통로.
//
// 왜 config/에 코드를 두지 않는가: 그 폴더는 운영자가 손으로 고치는 자리다. 편집 대상과 그것을 읽는
// 코드가 섞이면 무엇을 고쳐야 할지 헷갈린다. config/는 데이터만, 읽는 방법은 여기가 갖는다.
//
// 왜 YAML인가: 이 파일들은 주인이 둘이다. 손으로 고치는 운영자와, 대시보드.
// 기계가 통째로 다시 쓰면 사람이 적은 주석이 날아가는데, YAML은 주석·빈 줄을 보존하며 고쳐 쓸 수 있다.
//
// 왜 require 캐시를 건드리지 않는가: 데이터가 JS 모듈이 아니므로 모듈 캐시와 무관하다.
// mtime이 바뀐 것만 다시 읽는다. 봇을 켜 둔 채로 고쳐도 다음 호출부터 반영된다.

const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const log = require("../infra/log/logger").child({ category: "config" });
// 설정 검증과 실제 실행이 같은 표를 봐야 한다. 어긋나면 저장은 되는데 재생이 안 된다
const sources = require("./schema/genreSources");
const { PROVIDERS } = require("./schema/aiProviders");

// 같은 말을 되풀이하지 않는다. genres()는 곡을 고를 때마다 불린다
let warnedKeys = "";

// 설정 파일이 놓이는 곳. 테스트가 여기만 갈아끼우면 실제 설정을 건드리지 않는다
// (audioCache._cacheDir와 같은 방식. 파일을 만지는 코드는 반드시 이 값을 거친다).
let configDir = path.join(__dirname, "..", "..", "config");

// name -> { mtimeMs, value }
const cache = new Map();

// 이모지 한 글자인가. \p{RGI_Emoji}는 국기·키캡처럼 코드포인트가 여럿인 것도 한 덩이로 센다.
// g 플래그가 없어 test()에 상태가 남지 않는다.
const ONE_EMOJI = /^\p{RGI_Emoji}$/v;

// 숫자만으로 된 이름. JavaScript 객체가 정수처럼 생긴 키를 앞으로 당기는 탓에 장르 차례가
// 조용히 어긋난다("재즈 80 팝"이 "80 재즈 팝"이 된다). 차례는 선택 메뉴에 그대로 나오므로 막는다.
const NUMERIC_NAME = /^(0|[1-9][0-9]*)$/;

const fileOf = (name) => path.join(configDir, `${name}.yaml`);
const exampleOf = (name) => path.join(configDir, `${name}.example.yaml`);

/**
 * 설정 파일 하나를 읽는다. 내용이 바뀌지 않았으면 읽은 것을 그대로 돌려준다.
 *
 * 기동 시 파일이 없으면 멈춘다(.env와 같은 취급). 코드에 박힌 기본값으로 조용히 돌면
 * 설치가 어긋나도 아무도 모른 채 엉뚱한 설정으로 운영된다.
 * 반면 돌던 중의 읽기·파싱 실패는 직전 값을 유지한다. 저장하다 만 파일 한 번에 재생이 멈추면 안 된다.
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
      log.warn(`설정 파일을 읽지 못했습니다(직전 값 유지): ${path.basename(file)}, ${detail}`);
      return cached.value;
    }
    throw Object.assign(new Error(`설정 파일을 읽지 못했습니다: ${file}\n   ${detail}\n   들여쓰기에 탭을 쓰지 않았는지 확인하세요(YAML은 공백만 받습니다).`), { code: "CONFIG_INVALID" });
  }

  if (cached) log.info(`설정을 다시 읽었습니다: ${path.basename(file)}`);
  cache.set(name, { mtimeMs: stat.mtimeMs, value });
  return value;
}

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

/** 봇 상태 메시지 설정 */
// StatusManager의 TYPE_MAP과 같아야 한다(거기서 require하면 순환이 된다. 테스트로 어긋남을 막는다)
const ACTIVITY_TYPES = ["Playing", "Listening", "Watching", "Competing", "Custom"];
const MAX_TEXT = 128; // 디스코드 활동 문구 길이 상한

// 같은 말을 되풀이하지 않는다. 상태는 회전 주기마다 읽히기 때문이다
let warned = "";

function status() {
  const data = load("status");

  // 장르와 달리 여기서는 던지지 않는다. 이 함수는 setInterval 안에서 주기마다 불리므로,
  // 던지면 타이머에서 잡히지 않는 예외가 되어 상태가 틀린 것보다 나쁜 일이 벌어진다.
  // 대신 무엇이 잘못됐는지 남기고 그대로 돌려준다. 손으로 고친 파일이 조용히 어긋나지 않게.
  const problems = validateStatus(data);
  const key = problems.join("|");
  if (problems.length && key !== warned) log.warn(`status.yaml: ${problems.join(" / ")}`);
  warned = key;

  return data;
}

// "MM-DD ~ MM-DD" / "HH:MM ~ HH:MM". 비교가 문자열 비교라 두 자리로 적지 않으면
// 형식이 틀린 게 아니라 "엉뚱한 날에 걸린다". 그래서 모양까지 본다.
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
    else if (message.text.length > MAX_TEXT) problems.push(`${where}: 문구가 ${MAX_TEXT}자를 넘습니다. "${message.text.slice(0, 20)}…"`);
    // 종류를 잘못 적으면 조용히 "듣는 중"이 된다. 오타가 말을 안 해 주는 종류라 여기서 잡는다
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

    // 조건이 하나도 없으면 항상 맞아서 아래 항목이 전부 죽는다. 손으로 고치다 범위만 지우면 밟는다
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
 * 받은 데이터를 문서에 덮어쓰지 않고 맞춘다. 바뀐 자리만 고친다.
 *
 * 통째로 다시 쓰면 사람이 적은 주석이 전부 날아간다. 손대지 않은 항목은 원문 그대로 두어야
 * 이 파일의 두 주인(운영자·대시보드)이 공존할 수 있다.
 *
 * 배열은 통째로 바꾼다. 항목 사이 주석은 보존되지 않는다(검색어 목록에 주석을 다는 일은 드물다).
 */
// 목록도 자리마다 견줘 고친다. 통째로 갈아끼우면 그 안에 손으로 적어 둔 주석이 전부 날아간다.
// 자리를 기준으로 맞추므로 중간에 하나를 끼워 넣으면 그 아래 주석은 한 칸씩 밀린다.
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

  // 사라진 키 제거. 그 키에 달린 주석도 함께 간다
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

    // 값이 같으면 건드리지 않는다. 손대면 서식만 바뀐다
    if (JSON.stringify(doc.getIn(here)) === JSON.stringify(value)) continue;

    doc.setIn(here, value);

    // 여러 줄 글은 블록 리터럴로 적는다. 큰따옴표로 적으면 줄바꿈 하나가 빈 줄로 나가서
    // (YAML 은 그렇게 접는다) 읽기 나쁘다. 되읽으면 같은 값이지만 손으로 고칠 파일이다.
    if (typeof value === "string" && value.includes("\n")) {
      const node = doc.getIn(here, true);
      if (node) node.type = YAML.Scalar.BLOCK_LITERAL;
    }
  }

  // 차례 맞추기. 키도 값도 그대로인 채 순서만 바뀔 수 있다(대시보드에서 끌어 옮긴다).
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
 * 임시 파일에 쓰고 원자적으로 옮긴다. 반쯤 쓰인 파일을 로더가 읽는 일이 없어야 한다.
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
  // 쓴 것을 도로 읽어 확인한다. 깨진 파일을 남기느니 저장을 거절한다
  const check = YAML.parse(text);
  if (!check || typeof check !== "object") throw Object.assign(new Error("저장 결과가 올바르지 않습니다"), { code: "CONFIG_INVALID" });

  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  cache.delete(name); // 다음 읽기가 새 내용을 가져간다
  log.info(`설정을 저장했습니다: ${path.basename(file)}`);
  return check;
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

// ── ai-keys.yaml ──────────────────────────────────────────────────────────
//
// 프로바이더마다 키가 따로다. 이 값은 대시보드로 내려보내지 않는다.
// 화면에는 있는지 없는지만 간다(dashboard/server/routes/admin.js).
//
// .env 가 아니라 여기 두는 까닭: 프로바이더가 여럿이면 .env 한 칸을 돌려쓸 수 없고,
// 키를 갈아 끼울 때마다 봇을 다시 띄워야 한다. 설정 파일은 mtime 이 바뀌면 다시 읽는다.

function aiKeys() {
  try {
    const data = load("ai-keys");
    return Object.fromEntries(Object.entries(data).map(([name, value]) => [name, String(value ?? "").trim()]));
  } catch {
    return {}; // 파일이 없으면 키가 없는 것이다. 로컬 모델만 쓰면 이게 정상이다.
  }
}

/** 이 프로바이더의 키(없으면 빈 문자열). */
const aiKeyOf = (provider) => aiKeys()[provider] || "";

/**
 * 키를 고쳐 쓴다. 적어 보낸 칸만 바꾸고 나머지는 그대로 둔다.
 * 돌려주는 것은 값이 아니라 있는지 없는지다. 값은 어느 통로로도 돌아나가지 않는다.
 */
function saveAiKeys(changes) {
  if (!changes || typeof changes !== "object") throw Object.assign(new Error("저장할 내용이 없습니다"), { code: "CONFIG_INVALID" });

  const known = new Set(aiProviders());
  const next = { ...aiKeys() };
  for (const [name, value] of Object.entries(changes)) {
    if (!known.has(name)) continue; // 모르는 이름으로 칸을 늘리지 않는다
    if (value != null && typeof value !== "string") throw Object.assign(new Error(`${name}: 키는 글자여야 합니다`), { code: "CONFIG_INVALID" });
    next[name] = value == null ? "" : value.trim();
  }

  // 파일이 없으면 만들어 둔다. 설치 때 복사되지만 지웠을 수도 있다
  if (!fs.existsSync(fileOf("ai-keys"))) fs.writeFileSync(fileOf("ai-keys"), "");
  save("ai-keys", next);
  return Object.fromEntries(Object.entries(next).map(([name, value]) => [name, !!value]));
}

// ── ai-prompt.chatml ──────────────────────────────────────────────────────
//
// 프롬프트는 설정과 딴 파일에 산다. 설정 파일에 긴 글을 섞으면 YAML 들여쓰기에 걸려
// 손으로 고치기 나쁘고, 프롬프트만 주고받기도 어렵다.
//
// 모양은 ChatML 이다. 채팅 프론트엔드들이 쓰는 그 규격이라 옮겨 붙이기 쉽다.
//
//   <|im_start|>system
//   판정 기준…
//   <|im_end|>

const PROMPT_FILE = "ai-prompt.chatml";
const CHATML = /<\|im_start\|>[ \t]*(\w+)[ \t]*\r?\n([\s\S]*?)<\|im_end\|>/g;
const promptPath = () => path.join(configDir, PROMPT_FILE);

/** ChatML 글 → 섹션 목록. 블록 바깥의 글은 버린다(규격에 자리가 없다). */
function parseChatML(text) {
  const out = [];
  for (const [, role, body] of String(text || "").matchAll(CHATML)) {
    out.push({ role: role.toLowerCase(), text: body.replace(/\r?\n$/, "") });
  }
  return out;
}

/** 섹션 목록 → ChatML 글. */
function toChatML(sections) {
  return `${(sections || []).map((one) => `<|im_start|>${one?.role || "system"}\n${String(one?.text ?? "")}\n<|im_end|>`).join("\n\n")}\n`;
}

/** 지금 프롬프트. 파일이 없거나 비면 빈 목록. 부르는 쪽이 기본 구성을 쓴다. */
function aiPrompt() {
  let stat;
  try {
    stat = fs.statSync(promptPath());
  } catch {
    return [];
  }

  const cached = cache.get(PROMPT_FILE);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value;

  const value = parseChatML(fs.readFileSync(promptPath(), "utf8"));
  cache.set(PROMPT_FILE, { mtimeMs: stat.mtimeMs, value });
  return value;
}

function saveAiPrompt(sections) {
  const problems = promptProblems(sections, true);
  if (problems.length) throw Object.assign(new Error(problems[0]), { code: "CONFIG_INVALID", problems });

  fs.writeFileSync(promptPath(), toChatML(sections));
  cache.delete(PROMPT_FILE);
  log.info(`설정을 저장했습니다: ${PROMPT_FILE}`);
  return aiPrompt();
}

// ── cookies.txt ───────────────────────────────────────────────────────────
//
// 유튜브 쿠키. 다른 설정과 달리 우리가 읽지 않는다. 경로를 yt-dlp 에 넘기면 그쪽이 읽는다.
// 여기 두는 이유는 자리를 한 곳으로 모으기 위해서다(.env 에 경로를 적게 하면 대시보드가
// 어디를 고쳐야 하는지 물어야 한다).
//
// ⚠️ yt-dlp 는 `--cookies FILE` 을 읽기만 하지 않고 끝날 때 쿠키 항아리를 그 파일에 되쓴다.
//    그래서 mtime 은 "올린 시각"이 아니고, 쿠키를 쓰는 yt-dlp 가 도는 중에 덮어쓰면
//    그쪽이 끝나면서 옛 내용으로 되돌린다. 부르는 쪽이 그 상황을 알려 준다.

const COOKIES_FILE = "cookies.txt";
const cookiesPath = () => path.join(configDir, COOKIES_FILE);

/**
 * 쓸 수 있는 쿠키 파일이 있는가. 빈 파일은 없는 것으로 친다.
 *
 * 크기만 보지 않고 읽어서 본다. 공백뿐인 파일을 yt-dlp 에 넘기면 연령 제한 재시도를
 * 한 번 더 헛되이 쓴다. 파일이 몇 킬로바이트고 물어보는 빈도도 낮아 읽는 값이 아깝지 않다.
 */
function cookiesReady() {
  try {
    return fs.readFileSync(cookiesPath(), "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * 쿠키를 갈아 끼운다. 빈 글이면 지운다.
 *
 * 줄바꿈만 맞추고 내용은 손대지 않는다. Netscape 형식은 탭으로 칸을 나누는데, 브라우저
 * 확장에서 복사해 붙여넣어도 탭은 그대로 온다(실측). 그래서 검사할 것이 없다.
 * 들어 있는 쿠키가 아직 살아 있는지는 우리가 알 수 없다. 유튜브가 브라우저 쪽에서
 * 세션을 돌리면 만료 시각과 무관하게 무효가 되므로, 써 보기 전에는 판정이 불가능하다.
 */
function saveCookies(text) {
  const body = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!body) return clearCookies();

  // 같은 폴더에 쓰고 옮긴다. 쓰는 도중의 반쪽짜리 파일을 yt-dlp 가 읽으면 안 된다
  const temp = `${cookiesPath()}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${body}\n`);
  fs.renameSync(temp, cookiesPath());
  log.info(`설정을 저장했습니다: ${COOKIES_FILE}`);
  return true;
}

/** 쿠키를 치운다. 빈 파일을 남기지 않는다. 있음과 비어 있음을 구별할 일이 없게. */
function clearCookies() {
  try {
    fs.unlinkSync(cookiesPath());
    log.info(`설정을 지웠습니다: ${COOKIES_FILE}`);
  } catch {
    /* 원래 없었다 */
  }
  return false;
}

// ── ai.yaml ───────────────────────────────────────────────────────────────

// 상태와 같은 처지다. 곡을 고를 때마다 읽히므로 던지지 않는다.
// 던지면 자동재생이 통째로 멈춘다. AI는 없어도 되는 기능이라 그건 과하다.
let aiWarned = "";

function ai() {
  let data;
  try {
    data = load("ai");
  } catch {
    return { enabled: false }; // 파일이 없어도 봇은 돈다. 이 기능만 꺼진다.
  }

  const problems = validateAi(data);
  const key = problems.join("|");
  if (problems.length && key !== aiWarned) log.warn(`ai.yaml: ${problems.join(" / ")}`);
  aiWarned = key;

  // 하나라도 어긋나면 켜지 않는다. 반만 맞는 설정으로 부르면 매번 실패하고 로그만 쌓인다
  return problems.length ? { ...data, enabled: false } : data;
}

// 목록은 autoplayAssist 가 갖는다(주소·키 필요 여부까지 거기 있다).
// 여기서 위로 require 하면 순환이다. 그쪽이 이 파일을 먼저 부른다. 쓸 때 부른다.
const aiProviders = () => PROVIDERS;

function validateAi(data) {
  const problems = [];
  if (data?.provider != null && !aiProviders().includes(data.provider)) problems.push(`provider는 ${aiProviders().join(" · ")} 중 하나여야 합니다.`);
  if (data?.enabled != null) problems.push("enabled 는 provider 로 바뀌었습니다. off 또는 openai 를 적으세요.");

  // 켤 때만 나머지를 따진다. 꺼 둔 설정이 반쯤 비어 있다고 나무랄 이유가 없다.
  if (data?.provider && data.provider !== "off") {
    // baseUrl 은 custom 일 때만 쓴다. 나머지는 프로바이더에 박힌 주소로 간다(autoplayAssist)
    if (data.provider === "custom") {
      if (!String(data.baseUrl || "").trim()) problems.push("provider가 custom이면 baseUrl을 적어야 합니다.");
      else if (!/^https?:\/\//.test(String(data.baseUrl).trim())) problems.push("baseUrl은 http:// 또는 https:// 로 시작해야 합니다.");
    }
    if (!String(data.model || "").trim()) problems.push("model을 적어야 합니다.");
  }

  const num = (key, min, max) => {
    if (data?.[key] == null) return;
    const value = Number(data[key]);
    if (!Number.isFinite(value) || value < min || value > max) problems.push(`${key}는 ${min}~${max} 사이여야 합니다.`);
  };
  // 온도도 모델이 받는 칸 하나다. params 아래로 옮겼다. 남아 있으면 조용히 무시되므로 알린다.
  if (data?.temperature != null) problems.push("temperature는 params 아래에 모델별로 적습니다.");
  num("timeoutMs", 1000, 600000);
  num("batchSize", 1, 50);

  // 추가 파라미터는 한 줄에 하나씩 적는 글이다(autoplayAssist.parseExtra)
  if (data?.extra != null && typeof data.extra !== "string") problems.push("extra는 한 줄에 하나씩 적는 글이어야 합니다.");
  if (data?.prompt != null) problems.push(`프롬프트는 ${PROMPT_FILE} 에 적습니다. ai.yaml 의 prompt 는 쓰이지 않습니다.`);

  for (const key of ["project", "location"]) {
    if (data?.[key] != null && typeof data[key] !== "string") problems.push(`${key}는 글자로 적어야 합니다.`);
  }

  // 모델이 받는 칸의 값. 모델 이름으로 한 겹 나뉜다. 안 그러면 모델을 바꿨을 때
  // 앞 모델 값이 따라온다. 칸 이름이 맞는지는 모델 프로필이 판단한다(autoplayAssist.withParams).
  if (data?.params != null) {
    if (typeof data.params !== "object" || Array.isArray(data.params)) {
      problems.push("params는 모델 이름 아래에 칸을 적는 표여야 합니다.");
    } else {
      for (const [model, values] of Object.entries(data.params)) {
        if (values != null && (typeof values !== "object" || Array.isArray(values))) {
          problems.push(`params.${model} 은 칸 이름과 값을 적는 표여야 합니다(모델 이름으로 한 겹 나눕니다).`);
        }
      }
    }
  }

  // 모델 목록에서 가릴 이름(글롭). 저쪽 목록에는 영상·이미지 모델도 섞여 나온다.
  if (data?.hideModels != null && !(Array.isArray(data.hideModels) && data.hideModels.every((one) => typeof one === "string"))) {
    problems.push('hideModels는 글자 목록이어야 합니다(예: ["*sora*", "gpt-3.5*"]).');
  }

  // 섹션 이름은 대시보드에서 어느 섹션인지 알아보려고 붙이는 것이다.
  // ChatML 에는 이름을 적을 자리가 없어서 여기 둔다. 차례가 프롬프트 섹션과 같아야 한다.
  if (data?.promptNames != null && !(Array.isArray(data.promptNames) && data.promptNames.every((one) => one == null || typeof one === "string"))) {
    problems.push("promptNames는 글자 목록이어야 합니다.");
  }

  problems.push(...listProblems(data?.list));
  return problems;
}

// 프롬프트는 섹션 목록이다. 섹션마다 역할(system·user·assistant)과 내용을 갖는다.
// 비우면 기본 구성을 쓰므로, 적었을 때만 따진다.
const AI_ROLES = ["system", "user", "assistant"];

function promptProblems(prompt, on) {
  if (prompt == null) return [];
  if (!Array.isArray(prompt)) return ["프롬프트는 섹션 목록이어야 합니다(역할과 내용을 가진 항목들)."];
  if (!prompt.length) return [];

  const problems = [];
  prompt.forEach((section, i) => {
    const where = `${i + 1}번째 섹션`;
    if (!section || typeof section !== "object") return problems.push(`${where}: 역할과 내용을 적어야 합니다.`);
    if (!AI_ROLES.includes(section.role)) problems.push(`${where}: 역할은 ${AI_ROLES.join(" · ")} 중 하나여야 합니다.`);
    if (section.text != null && typeof section.text !== "string") problems.push(`${where}: 내용은 글로 적어야 합니다.`);
    // ChatML 은 블록 안에 끝 표시가 또 나오면 파일이 깨진다
    if (/<\|im_(start|end)\|>/.test(String(section?.text ?? ""))) problems.push(`${where}: 내용에 <|im_start|>·<|im_end|> 를 적을 수 없습니다.`);
  });

  // 후보를 어디에도 안 넣으면 모델은 무엇을 판정할지 모른다. 켜 두고 이러면 매번 헛돈다.
  const hasList = prompt.some((section) => /\{\{\s*목록\s*\}\}/.test(String(section?.text ?? "")));
  if (on && !hasList) problems.push("어딘가에 {{목록}} 이 있어야 합니다. 그 자리에 판정할 후보가 들어갑니다.");
  return problems;
}

const AI_UNKNOWN = ["hide", "text", "zero"];

function listProblems(list) {
  if (list == null) return [];
  if (typeof list !== "object" || Array.isArray(list)) return ["list는 이름:값 꼴이어야 합니다."];

  const problems = [];
  if (list.lineFormat != null) {
    if (typeof list.lineFormat !== "string") problems.push("list.lineFormat은 글로 적어야 합니다.");
    // 제목이 없으면 판정할 거리가 없다
    else if (list.lineFormat.trim() && !/\{\{\s*제목\s*\}\}/.test(list.lineFormat)) problems.push("list.lineFormat에 {{제목}} 이 있어야 합니다.");
  }
  if (list.unknownDuration != null && !AI_UNKNOWN.includes(list.unknownDuration)) problems.push(`list.unknownDuration은 ${AI_UNKNOWN.join(" · ")} 중 하나여야 합니다.`);
  if (list.unknownText != null && typeof list.unknownText !== "string") problems.push("list.unknownText는 글로 적어야 합니다.");
  return problems;
}

// 테스트 시임. 폴더를 바꾸면 읽어 둔 것도 버린다(다른 파일을 같은 이름으로 읽게 되므로).
function _setConfigDir(dir) {
  configDir = dir;
  cache.clear();
}

module.exports = {
  load,
  genres,
  status,
  ai,
  aiKeys,
  aiKeyOf,
  saveAiKeys,
  aiPrompt,
  save,
  saveAiPrompt,
  validateGenres,
  validateStatus,
  validateAi,
  promptProblems,
  parseChatML,
  toChatML,
  ACTIVITY_TYPES,
  fileOf,
  exampleOf,
  cookiesPath,
  cookiesReady,
  saveCookies,
  clearCookies,
  configDir: () => configDir,
  promptPath,
  _setConfigDir,
  _cache: cache,
};
