// 구조 게이트. 부르는 방향 · 순환 · 지연 부름 · config 꺼내 두기 · 모듈과 메서드 교체 · 첫 테스트 뒤 기다리기를 기준선과 맞춘다.
//
// 기준선(baseline.json)은 1단계에서 한 번 만들고 줄이기만 한다. 새 위반은 실패한다. 위반을 없앴으면 기준선에서도 지운다.
// 안 지우면 실패한다. 남은 슬롯만큼 새 위반이 숨기 때문이다(eslint 억제 파일과 같은 규칙). 끝 단계에서 전부 빈다.

import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROJECT } from "../../src/infra/project-paths.ts";
import { scan, LAYERS } from "./scan.ts";
import baseline from "./baseline.json" with { type: "json" };

const now = scan();

// 목록: 새로 생긴 것과 없어진 것을 따로 알린다
function sameList(name: string, current: string[], base: string[]) {
  const cur = new Set(current);
  const old = new Set(base);
  const added = [...cur].filter((x) => !old.has(x));
  const gone = [...old].filter((x) => !cur.has(x));
  const lines = [...added.map((x) => `  새로 생김: ${x}`), ...gone.map((x) => `  없어졌으니 기준선에서 지운다: ${x}`)];
  assert.equal(lines.length, 0, `${name}\n${lines.join("\n")}`);
}

// 파일별 수: 늘면 실패, 줄면 기준선을 줄이라고 실패
function sameCounts(name: string, current: Record<string, number>, base: Record<string, number>) {
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
  assert.deepEqual(now.unknownLayer, [], `층 차례(${LAYERS.join(" → ")})에 없는 폴더. scan.ts 의 LAYERS 에 자리를 정한다`);
});

test("층 순서를 거슬러 부르지 않는다", () => {
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

test("테스트가 require.cache 로 모듈을 교체하지 않는다", () => {
  sameCounts("require.cache", now.requireCache, baseline.requireCache);
});

test("테스트 파일이 첫 테스트 뒤 맨 위에서 기다리지 않는다", () => {
  sameList("첫 테스트 뒤 맨 위 await", now.lateAwait, baseline.lateAwait);
});

test("테스트가 프로젝트 모듈의 메서드를 덮어쓰지 않는다", () => {
  sameList("메서드 교체", now.methodSwap, baseline.methodSwap);
});

// 실행 중 경로는 PROJECT 하나에서 나온다(src/infra/project-paths). 루트를 잘못 세면 DB · 캐시가 엉뚱한 빈 경로에 새로 생긴다
test("저장소 루트를 맞게 가리킨다", () => {
  assert.ok(fs.existsSync(path.join(PROJECT.root, "package.json")), PROJECT.root);
  assert.ok(fs.existsSync(path.join(PROJECT.root, "pnpm-workspace.yaml")), "다른 package.json 이 아니라 이 저장소의 루트");
});

test("실행 중 경로를 파일 위치에서 세지 않는다(import.meta.dirname 은 경로 모듈에만)", () => {
  assert.deepEqual(now.dirnameUse, ["src/infra/project-paths.ts"]);
});

// 조립이 만든 것(플레이어 레지스트리 · 패널 · 명령 목록)은 봇 문맥(src/app/bot-context)으로 넘긴다. 클라이언트에 매달면 어디서든 꺼내 쓰는 길이 다시 열린다
test("디스코드 클라이언트 타입을 늘려 필드를 매달지 않는다", () => {
  const src = path.join(PROJECT.root, "src");
  const augmenting = fs
    .readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.ts$/.test(f) && /declare\s+module\s+["']discord\.js["']/.test(fs.readFileSync(path.join(src, f), "utf8")))
    .map((f) => `src/${f.split(path.sep).join("/")}`);
  assert.deepEqual(augmenting, []);
});

// 파일 이름은 kebab-case(점 뒤는 .test · .d · .browser 같은 접미사). 대시보드 화면(Vue 컴포넌트는 PascalCase)은 따로 본다
test("봇 · 테스트 · 스크립트의 파일 이름은 kebab-case", () => {
  const files = (dir: string): string[] => fs.readdirSync(path.join(PROJECT.root, dir), { recursive: true, encoding: "utf8" }).filter((f) => /\.(ts|js|mjs)$/.test(f));
  const bad = ["src", "test", "scripts"].flatMap((dir) => files(dir).map((f) => `${dir}/${f.split(path.sep).join("/")}`)).filter((f) => !/^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)*\.(ts|js|mjs)$/.test(path.posix.basename(f)));
  assert.deepEqual(bad, []);
});
