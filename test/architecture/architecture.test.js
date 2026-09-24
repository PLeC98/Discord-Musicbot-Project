// 구조 게이트. 부르는 방향 · 순환 · 지연 부름 · config 꺼내 두기 · 모듈과 메서드 바꿔 끼우기를 기준선과 맞춘다.
//
// 기준선(baseline.json)은 1단계에서 한 번 만들고 줄이기만 한다. 새 위반은 실패한다. 위반을 없앴으면 기준선에서도 지운다.
// 안 지우면 실패한다. 남은 자리만큼 새 위반이 숨기 때문이다(eslint 억제 파일과 같은 규칙). 끝 단계에서 전부 빈다.

import { test } from "node:test";
import assert from "node:assert/strict";
import scanModule from "./scan.js";
const { scan, LAYERS } = scanModule;
import baseline from "./baseline.json" with { type: "json" };

const now = scan();

// 목록: 새로 생긴 것과 없어진 것을 따로 알린다
function sameList(name, current, base) {
  const cur = new Set(current);
  const old = new Set(base);
  const added = [...cur].filter((x) => !old.has(x));
  const gone = [...old].filter((x) => !cur.has(x));
  const lines = [...added.map((x) => `  새로 생김: ${x}`), ...gone.map((x) => `  없어졌으니 기준선에서 지운다: ${x}`)];
  assert.equal(lines.length, 0, `${name}\n${lines.join("\n")}`);
}

// 파일별 수: 늘면 실패, 줄면 기준선을 줄이라고 실패
function sameCounts(name, current, base) {
  const lines = [];
  for (const file of new Set([...Object.keys(current), ...Object.keys(base)])) {
    const c = current[file] ?? 0;
    const b = base[file] ?? 0;
    if (c > b) lines.push(`  늘었다: ${file} ${b} → ${c}`);
    if (c < b) lines.push(`  줄었으니 기준선도 줄인다: ${file} ${b} → ${c}`);
  }
  assert.equal(lines.length, 0, `${name}\n${lines.join("\n")}`);
}

test("봇 코드 파일을 전부 읽었고, 모든 파일이 층에 속한다", () => {
  assert.ok(now.files > 100, `읽은 파일이 너무 적다(${now.files}개)`);
  assert.deepEqual(now.unknownLayer, [], `층 차례(${LAYERS.join(" → ")})에 없는 폴더. scan.js 의 LAYERS 에 자리를 정한다`);
});

test("층 차례를 거슬러 부르지 않는다", () => {
  sameList("부르는 방향", now.direction, baseline.direction);
});

test("순환이 없다(폴더 안에서도, 지연 부름까지)", () => {
  sameList("순환에 든 선", now.cycles, baseline.cycles);
});

test("경로가 글자가 아닌 부름은 정해진 파일에만 있다", () => {
  sameList("글자가 아닌 부름", [...new Set(now.unseen.map((u) => u.split(":")[0]))], baseline.unseen);
});

test("함수 안에서 부르지 않는다(지연 require)", () => {
  sameCounts("지연 부름", now.lazyRequire, baseline.lazyRequire);
});

test("모듈 맨 위에서 config 값을 꺼내 두지 않는다", () => {
  sameCounts("config 꺼내 두기", now.configCapture, baseline.configCapture);
});

test("테스트가 require.cache 로 모듈을 바꿔 끼우지 않는다", () => {
  sameCounts("require.cache", now.requireCache, baseline.requireCache);
});

test("테스트가 프로젝트 모듈의 메서드를 덮어쓰지 않는다", () => {
  sameList("메서드 바꿔 끼우기", now.methodSwap, baseline.methodSwap);
});
