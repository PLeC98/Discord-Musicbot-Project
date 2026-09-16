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

// 테스트 시임 — 폴더를 바꾸면 읽어 둔 것도 버린다(다른 파일을 같은 이름으로 읽게 되므로).
function _setConfigDir(dir) {
  configDir = dir;
  cache.clear();
}

module.exports = { load, genres, status, fileOf, exampleOf, _setConfigDir, _cache: cache };
