// test/tools/log-text-move.ts: 로그 문구를 옮기는 도구. 옮길 꼴과 손으로 볼 꼴을 가르고, 옮긴 뒤 문구표에 값 식을 끼운 글이 원래 글과 같은지 대조한다

import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { applySource, duplicatesOf, entryOf, entryShape, scanSource, verifySource, withEntries, type Site, type TypeOf } from "./log-text-move.ts";

const FILE = "src/player/demo.ts";
const SOURCE = `import logger from "../infra/log/logger.ts";
import { logRuleLine } from "../rules/text/index.ts";
import { repeatingFailure } from "../infra/repeating-failure.ts";

const log = logger.child({ category: "player" });
const failures = repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, "실행 기록 갱신");
const outside = "밖의 글";

function run(track: string, count: number, file: string, title: string, ok: boolean, error: unknown, line: string, problem: never) {
  log.warn(\`정리 실패: \${track} | 곡 \${count}개\`);
  log.info({ tags: ["startup"] }, "기동 시작");
  log.error(error, \`저장 실패(\${file})\`);
  log.warn(\`재생 \${ok ? "됨" : "안 됨"}\`);
  log.error("재생 실패:", error);
  log.info("곡:", title);
  log.warn(logRuleLine(problem));
  log.warn(line);
  log.debug(\`겹침 \${track}\`);
  log.debug(\`겹침 \${track}\`);
}
`;

const TYPES: Record<string, string> = { track: "string", count: "number", file: "string", title: "string", error: "other", ok: "boolean" };
const typeOf: TypeOf = (expr: ts.Expression) => TYPES[expr.getText()] ?? "other";

const KEYS = ["recordLabel", "cleanupFailed", "startupBegan", "saveFailed", "song", "overlap", "overlap"];
function planned() {
  const plan = scanSource(FILE, SOURCE, typeOf);
  let i = 0;
  const sites: Site[] = plan.sites.map((site) => (site.kind === "rule" ? site : { ...site, key: KEYS[i++] || site.key }));
  return { plan, sites };
}

/** 문구표 하나(player) */
const catalogOf = (sites: Site[]) => withEntries("player", null, [...new Map(sites.filter((site) => site.kind !== "rule").map((site) => [site.key, entryOf(site)])).values()]);

test("scan: 옮길 꼴과 손으로 볼 꼴을 가르고, 계획에 없는 한글 자리를 남긴다", () => {
  const { plan } = planned();
  assert.deepEqual(
    plan.sites.map((site) => [site.kind, site.namespace, site.parts, site.slots.map((slot) => `${slot.param}=${slot.expr}:${slot.type}`)]),
    [
      ["label", "player", ["실행 기록 갱신"], []],
      ["log", "player", ["정리 실패: ", " | 곡 ", "개"], ["track=track:string", "count=count:number"]],
      ["log", "player", ["기동 시작"], []],
      ["log", "player", ["저장 실패(", ")"], ["file=file:string"]],
      ["log", "player", ["곡: ", ""], ["title=title:string"]],
      ["rule", "player", [], []],
      ["log", "player", ["겹침 ", ""], ["track=track:string"]],
      ["log", "player", ["겹침 ", ""], ["track=track:string"]],
    ],
  );
  assert.deepEqual(
    plan.manual.map((one) => one.why),
    ["슬롯 안의 한글 조각", "글 뒤의 값(오류, 글 아닌 값, % 가 든 글)"],
  );
  assert.deepEqual(
    plan.unplanned.map((one) => one.text),
    ["밖의 글"],
  );
  assert.equal(duplicatesOf(plan.sites).length, 1, "같은 글은 묶어 알린다");
});

test("scan: 값 식의 타입이 원시값이 아니면 String(식)으로 감싼다", () => {
  const plan = scanSource(FILE, `import logger from "x";\nconst log = logger.child({ category: "core" });\nlog.warn(\`실패: \${error}\`);\n`, () => "other");
  assert.deepEqual(plan.sites[0].slots, [{ expr: "String(error)", param: "error", type: "string" }]);
});

test("apply: 호출부를 L.<네임스페이스>.<키>로, 규칙 문제는 ruleLogText로 바꾸고 import를 맞춘다", () => {
  const { sites } = planned();
  const after = applySource(FILE, SOURCE, sites);
  assert.match(after, /repeatingFailure\(\{ error: \(line\) => log\.warn\(line\), info: \(line\) => log\.info\(line\) \}, L\.player\.recordLabel\(\)\)/);
  assert.match(after, /log\.warn\(L\.player\.cleanupFailed\(\{ track, count \}\)\);/);
  assert.match(after, /log\.info\(\{ tags: \["startup"\] \}, L\.player\.startupBegan\(\)\);/);
  assert.match(after, /log\.error\(error, L\.player\.saveFailed\(\{ file \}\)\);/);
  assert.match(after, /log\.info\(L\.player\.song\(\{ title \}\)\);/);
  assert.match(after, /log\.warn\(ruleLogText\(problem\)\);/);
  assert.match(after, /import \{ L \} from "\.\.\/infra\/log\/text\.ts";/);
  assert.match(after, /import \{ ruleLogText \} from "\.\.\/rules\/text\/index\.ts";/);
  assert.doesNotMatch(after, /logRuleLine/, "쓰지 않게 된 import 는 뺀다");
  assert.match(after, /log\.warn\(`재생 \$\{ok \? "됨" : "안 됨"\}`\);/, "손으로 볼 자리는 그대로");
});

test("문구표 항목: 값 이름과 타입, 템플릿 이스케이프", () => {
  const site: Site = { file: FILE, line: 1, start: 0, end: 0, kind: "log", namespace: "player", key: "odd", parts: ["백틱 ` 와 ${ 와 \\ 와 줄\n바꿈 ", ""], slots: [{ expr: "n", param: "n", type: "number|string" }] };
  assert.equal(entryOf(site), "  odd: ({ n }: { n: number | string }) => `백틱 \\` 와 \\${ 와 \\\\ 와 줄\\n바꿈 ${n}`,");
  const catalog = withEntries("player", null, [entryOf(site)]);
  assert.deepEqual(entryShape(catalog, "odd"), { params: ["n"], parts: ["백틱 ` 와 ${ 와 \\ 와 줄\n바꿈 ", ""] }, "다시 읽으면 같은 글");
  assert.match(withEntries("player", catalog, ["  more: () => `더`,"]), /odd: [\s\S]*more: \(\) => `더`,\n\};/);
});

test("verify: 옮긴 판은 원래 판과 같다고 보고, 고정 글이나 값 식이 바뀌면 알린다", () => {
  const { sites } = planned();
  const after = applySource(FILE, SOURCE, sites);
  const catalog = catalogOf(sites);
  assert.deepEqual(
    verifySource(FILE, SOURCE, after, (space) => (space === "player" ? catalog : null)),
    [],
  );

  const typo = catalog.replace("정리 실패: ", "정리 실패 ");
  assert.match(verifySource(FILE, SOURCE, after, () => typo).join("\n"), /고정 글이 다름/);
  const swapped = after.replace("L.player.saveFailed({ file })", "L.player.saveFailed({ file: track })");
  assert.match(verifySource(FILE, SOURCE, swapped, () => catalog).join("\n"), /값 식이 다름/);
  const level = after.replace("log.error(error, L.player.saveFailed", "log.warn(error, L.player.saveFailed");
  assert.match(verifySource(FILE, SOURCE, level, () => catalog).join("\n"), /부르는 것이 다름/);
  const dropped = after.replace("log.info(L.player.song({ title }));", "");
  assert.match(verifySource(FILE, SOURCE, dropped, () => catalog).join("\n"), /로그 호출 수가 다름/);
});

test("규칙 문제의 글 슬롯은 ruleLogText 값으로 옮기고, logRuleLine 과 같은 글로 대조한다", () => {
  const before = `import { logRuleLine } from "../rules/text/index.ts";\nconst log = logger.child({ category: "config" });\nlog.warn(\`운영 설정값 \${logRuleLine(problem)}. 기본값으로\`);\n`;
  const plan = scanSource("src/store/x.ts", before, () => "string");
  assert.deepEqual(plan.sites[0].slots, [{ expr: "ruleLogText(problem)", param: "problem", type: "string" }]);
  const after = applySource("src/store/x.ts", before, [{ ...plan.sites[0], key: "invalid" }]);
  assert.match(after, /log\.warn\(L\.config\.invalid\(\{ problem: ruleLogText\(problem\) \}\)\);/);
  assert.match(after, /import \{ ruleLogText \} from "\.\.\/rules\/text\/index\.ts";/);
  assert.doesNotMatch(after, /logRuleLine/);
  const catalog = withEntries("config", null, [entryOf({ ...plan.sites[0], key: "invalid" })]);
  assert.deepEqual(
    verifySource("src/store/x.ts", before, after, () => catalog),
    [],
  );
});

test("apply: logRuleLine 을 부르지 않고 값으로 넘기는 곳이 남으면 import 를 지우지 않는다", () => {
  const before = `import { logRuleLine } from "../rules/text/index.ts";\nconst log = logger.child({ category: "config" });\nlog.warn(\`값 \${logRuleLine(problem)}\`);\nconst lines = problems.map(logRuleLine);\n`;
  const plan = scanSource("src/store/x.ts", before, () => "string");
  const after = applySource("src/store/x.ts", before, [{ ...plan.sites[0], key: "invalid" }]);
  assert.match(after, /import \{ logRuleLine \} from "\.\.\/rules\/text\/index\.ts";/);
  assert.match(after, /import \{ ruleLogText \} from/);
});

test("verify: String(식)으로 감싼 값은 원래 식으로 본다", () => {
  const before = `const log = logger.child({ category: "core" });\nlog.warn(\`실패: \${error}\`);\n`;
  const after = `const log = logger.child({ category: "core" });\nlog.warn(L.core.failed({ error: String(error) }));\n`;
  const catalog = withEntries("core", null, ["  failed: ({ error }: { error: string }) => `실패: ${error}`,"]);
  assert.deepEqual(
    verifySource("src/x.ts", before, after, () => catalog),
    [],
  );
});
