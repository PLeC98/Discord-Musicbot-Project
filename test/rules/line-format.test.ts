// src/rules/line-format.ts — 후보 줄 형식 · 프롬프트의 자리표시자. 봇과 대시보드가 같은 해석기로 줄을 만든다

import { test } from "node:test";
import assert from "node:assert/strict";
import { LINE_NAMES, PROMPT_NAMES, formatDuration, parseFormat, renderNodes, usesName, type Values } from "../../src/rules/line-format.ts";

const line = (seconds: number | null): Values => ({
  index: () => "3",
  genre: () => "k-pop",
  title: () => "NewJeans - Ditto",
  duration: (arg) => formatDuration(seconds, arg),
});
const render = (format: string, values: Values) => {
  const { nodes, problems } = parseFormat(format, LINE_NAMES);
  assert.deepEqual(problems, [], format);
  return renderNodes(nodes, values);
};

test("계획서의 예: 길이를 알면 길이, 모르면 그 구간째 빠진다", () => {
  const format = "{{index}}. genre={{genre}} {{#if-exist {{duration}}}}length={{duration::m:ss}} {{/}}title={{title}}";
  assert.equal(render(format, line(185)), "3. genre=k-pop length=3:05 title=NewJeans - Ditto");
  assert.equal(render(format, line(null)), "3. genre=k-pop title=NewJeans - Ditto");
});

test("{{:else}}: 모르면 글자 · 0 을 적을 수 있다. 닫기는 {{/if-exist}} 도", () => {
  assert.equal(render("{{#if-exist {{duration}}}}{{duration}}{{:else}}모름{{/if-exist}}", line(null)), "모름");
  assert.equal(render("{{#if-exist {{duration}}}}{{duration::m}}{{:else}}0{{/}}분", line(0)), "0분");
  assert.equal(render("{{#if-exist {{duration}}}}{{duration::m}}{{:else}}0{{/}}분", line(125)), "2분");
});

test("블록 안 공백은 그대로, 겹쳐 쓸 수 있다", () => {
  assert.equal(render("[{{#if-exist {{genre}}}} {{genre}} {{#if-exist {{duration}}}}({{duration}}){{/}}{{/}}]", line(61)), "[ k-pop (1:01)]");
});

test("길이 형식: h 시간 · m 전체 분 · mm 남은 분 · s 전체 초 · ss 남은 초, 없으면 m:ss", () => {
  assert.equal(formatDuration(185, null), "3:05");
  assert.equal(formatDuration(185, "m분 ss초"), "3분 05초");
  assert.equal(formatDuration(185, "s"), "185");
  assert.equal(formatDuration(3725, "h:mm:ss"), "1:02:05");
  assert.equal(formatDuration(3725, "m"), "62");
  assert.equal(formatDuration(184.6, "s"), "185", "반올림한 초");
  assert.equal(formatDuration(0, null), "");
  assert.equal(formatDuration(null, "m"), "");
  assert.equal(formatDuration(Number.NaN, "m"), "");
});

test("옛 한글 이름은 새 이름을 알려 주고, 모르는 이름은 그대로 남긴다", () => {
  const { nodes, problems } = parseFormat("{{번호}}. {{길이분}}분 {{titel}} {{제목}}", LINE_NAMES);
  assert.deepEqual(
    problems.map((one) => one.message),
    ["{{번호}} 은 이제 {{index}} 입니다.", "{{길이분}} 은 이제 {{duration::m}} 입니다.", "모르는 이름 {{titel}}. 쓸 수 있는 것: {{index}} · {{genre}} · {{title}} · {{duration}}", "{{제목}} 은 이제 {{title}} 입니다."],
  );
  assert.equal(problems[0].at, 0);
  assert.equal(problems[1].at, 8);
  assert.equal(renderNodes(nodes, line(60)), "{{번호}}. {{길이분}}분 {{titel}} {{제목}}", "고치기 전까지는 보이게 둔다");
});

test("블록 문제는 자리와 함께: 닫히지 않음 · 짝 없는 닫기 · else 둘 · 모르는 블록 · 볼 값 없음", () => {
  const messages = (format: string) => parseFormat(format, LINE_NAMES).problems.map((one) => [one.at, one.message.split(".")[0]]);
  assert.deepEqual(messages("a {{#if-exist {{duration}}}}b"), [[2, "#if-exist 블록을 닫는 {{/}} 가 없습니다"]]);
  assert.deepEqual(messages("a{{/}}"), [[1, "닫을 블록이 없는데 {{/}} 가 있습니다"]]);
  assert.deepEqual(messages("{{#if-exist {{genre}}}}a{{:else}}b{{:else}}c{{/}}"), [[34, "{{:else}} 가 한 블록에 둘입니다"]]);
  assert.deepEqual(messages("{{#if {{genre}}}}a{{/}}"), [
    [0, "모르는 블록 {{#if {{genre}}}}"],
    [18, "닫을 블록이 없는데 {{/}} 가 있습니다"],
  ]);
  assert.deepEqual(messages("{{#if-exist}}a{{/}}"), [[0, "#if-exist 뒤에 볼 값을 적어야 합니다"]]);
  assert.deepEqual(messages("{{title"), [[0, "{{ 를 닫는 }} 가 없습니다"]]);
  assert.deepEqual(messages("{{title::x}}"), [[0, "{{title}} 은 :: 뒤의 값을 받지 않습니다"]]);
});

test("겹친 값 안의 문제 자리도 원래 글 기준", () => {
  const { problems } = parseFormat("ab {{#if-exist {{길이초}}}}x{{/}}", LINE_NAMES);
  assert.deepEqual(problems, [{ at: 15, end: 22, message: "{{길이초}} 은 이제 {{duration::s}} 입니다." }], "end 는 그 태그 끝");
});

test("이름이 어딘가에 있는가(필수 이름 · 목록 자리 검사)", () => {
  assert.ok(usesName(parseFormat("{{#if-exist {{genre}}}}{{title}}{{/}}", LINE_NAMES).nodes, "title"));
  assert.ok(!usesName(parseFormat("{{index}}", LINE_NAMES).nodes, "title"));
  assert.ok(usesName(parseFormat("후보:\n{{list}}", PROMPT_NAMES).nodes, "list"));
});
