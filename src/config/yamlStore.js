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

// 설정 파일이 놓이는 곳. 테스트가 여기만 갈아끼우면 실제 설정을 건드리지 않는다
// (audioCache._cacheDir와 같은 방식. 파일을 만지는 코드는 반드시 이 값을 거친다).
let configDir = path.join(__dirname, "..", "..", "config");

// name -> { mtimeMs, value }
const cache = new Map();

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

// 테스트 시임. 폴더를 바꾸면 읽어 둔 것도 버린다(다른 파일을 같은 이름으로 읽게 되므로).
function _setConfigDir(dir) {
  configDir = dir;
  cache.clear();
}

module.exports = { load, save, fileOf, exampleOf, _setConfigDir, cache, configDir: () => configDir, _cache: cache };
