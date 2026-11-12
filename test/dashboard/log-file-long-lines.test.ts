// src/dashboard/log-file-reader.ts: 기록기의 상한(LINE_MAX) 이상인 줄은 모으지 않고 건너뛴다. 앞으로 읽기, 뒤로 읽기, 시각으로 가기, 검색, 다운로드, 목록이
// 같은 줄을 건너뛰고 앞뒤 줄은 위치까지 그대로이며, 건너뛰는 동안 이벤트 루프를 양보한다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { listLogFiles, readLogPage, readNamedLogPage, filteredLines, resolveLogFile } from "../../src/dashboard/log-file-reader.ts";
import { backupPath, LINE_MAX } from "../../src/infra/log/file.ts";
import { AT_AFTER_LINES, type FileLine } from "../../src/dashboard/contract/log-files.ts";

const T0 = 1_760_000_000_000;
const dirs: string[] = [];
after(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});
function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loglong-test-"));
  dirs.push(dir);
  return path.join(dir, "bot.log");
}

/** i 번째 줄(줄바꿈 뺀 길이 bytes, 글은 ASCII). bytes 를 주지 않으면 짧은 줄 */
function line(i: number, text: string, bytes?: number) {
  const base = JSON.stringify({ time: T0 + i * 1000, level: 30, msg: text });
  return bytes === undefined ? base : JSON.stringify({ time: T0 + i * 1000, level: 30, msg: text + "x".repeat(bytes - base.length) });
}

type Built = { file: string; visible: Array<{ offset: number; text: string; ts: number }>; times: number[] };

/** 짧은 줄 사이에 긴 줄(가운데, 이어서, 경계 양쪽, 파일 끝의 덜 된 줄)을 둔 파일. shift 는 첫 줄의 길이를 늘려 청크 경계에 걸치는 자리를 바꾼다 */
function build(shift: number): Built {
  const parts: Array<{ long: boolean }> = [];
  const lines: string[] = [];
  const add = (i: number, text: string, bytes?: number, nl = true) => {
    const one = line(i, text, bytes);
    assert.equal(Buffer.byteLength(one), bytes ?? Buffer.byteLength(one));
    lines.push(one + (nl ? "\n" : ""));
    parts.push({ long: Buffer.byteLength(one) >= LINE_MAX });
  };
  let i = 0;
  add(i++, `line 0 ${"y".repeat(shift)}`);
  for (; i < 5; i++) add(i, `line ${i}`);
  add(i++, "huge A", LINE_MAX + 7_000);
  add(i++, `line ${i - 1} after-big`);
  for (; i < 71; i++) add(i, `line ${i}`);
  add(i++, "edge-in", LINE_MAX - 1);
  add(i++, "edge-out", LINE_MAX);
  add(i++, `line ${i - 1} after-big`);
  add(i++, "huge B", 2 * LINE_MAX + 3);
  add(i++, "huge C", LINE_MAX + 1);
  add(i++, `line ${i - 1} after-big`);
  for (; i < 141; i++) add(i, `line ${i}`);
  add(i, "huge D", LINE_MAX + 100, false);
  const file = tmpFile();
  fs.writeFileSync(file, lines.join(""));
  const visible: Built["visible"] = [];
  let offset = 0;
  lines.forEach((one, k) => {
    if (!parts[k]!.long) visible.push({ offset, text: brief((JSON.parse(one) as { msg: string }).msg), ts: T0 + k * 1000 });
    offset += Buffer.byteLength(one);
  });
  return { file, visible, times: lines.map((_, k) => T0 + k * 1000) };
}

const target = (file: string) => ({ name: "bot.log", path: file });
// 긴 글은 앞부분과 길이로 비교한다(실패 출력이 MB 가 되지 않게)
const brief = (text: string) => `${text.slice(0, 20)}#${text.length}`;
const shape = (lines: FileLine[]) => lines.map((one) => ({ offset: one.offset, text: brief(one.text), ts: one.ts }));

for (const shift of [0, 1_000, 100_003]) {
  test(`긴 줄(첫 줄 +${shift}바이트): 목록 줄 수, 끝에서부터 페이지, 뒤로 이어 읽기, 다운로드가 긴 줄만 빼고 같다`, async () => {
    const { file, visible } = build(shift);
    const [listed] = await listLogFiles(file);
    assert.equal(listed!.lines, visible.length);

    const backward: FileLine[] = [];
    let page = await readLogPage(target(file), { limit: 7, filter: {} });
    backward.unshift(...page!.lines);
    while (page!.more) {
      page = await readLogPage(target(file), { before: page!.lines[0]!.offset, limit: 7, filter: {} });
      backward.unshift(...page!.lines);
    }
    assert.deepEqual(shape(backward), visible);

    const forward: FileLine[] = [];
    let next = await readLogPage(target(file), { after: -1, limit: 7, filter: {} });
    forward.push(...next!.lines);
    while (next!.lines.length) {
      next = await readLogPage(target(file), { after: next!.lines.at(-1)!.offset, limit: 7, filter: {} });
      forward.push(...next!.lines);
    }
    assert.deepEqual(shape(forward), visible);

    const downloaded: FileLine[] = [];
    for await (const batch of filteredLines(target(file), {})) downloaded.push(...batch);
    assert.deepEqual(shape(downloaded), visible);
  });

  test(`긴 줄(첫 줄 +${shift}바이트): 검색은 긴 줄 바로 뒤의 줄을 정확히 돌려주고, 긴 줄 안의 글에는 걸리지 않는다`, async () => {
    const { file, visible } = build(shift);
    const afterBig = visible.filter((one) => one.text.includes("after-big"));
    const found = await readLogPage(target(file), { limit: 2, filter: { q: "after-big" } });
    assert.equal(found!.matches, 3);
    const older = await readLogPage(target(file), { before: found!.lines[0]!.offset, limit: 2, filter: { q: "after-big" } });
    assert.deepEqual(shape([...older!.lines, ...found!.lines]), afterBig);
    const ahead = await readLogPage(target(file), { after: -1, limit: 5, filter: { q: "after-big" } });
    assert.deepEqual(shape(ahead!.lines), afterBig);

    for (const q of ["huge", "edge-out"]) assert.equal((await readLogPage(target(file), { limit: 5, filter: { q } }))!.matches, 0, q);
    assert.deepEqual(
      shape((await readLogPage(target(file), { limit: 5, filter: { q: "edge" } }))!.lines),
      visible.filter((one) => one.text.startsWith("edge-in")),
    );
  });

  test(`긴 줄(첫 줄 +${shift}바이트): 시각으로 가기는 긴 줄의 시각이어도 그 뒤의 첫 줄부터 ${AT_AFTER_LINES}줄 뒤까지 받는다`, async () => {
    const { file, visible, times } = build(shift);
    for (const at of [...times.slice(0, 8), ...times.slice(68, 79)]) {
      const first = visible.findIndex((one) => one.ts >= at);
      const page = await readLogPage(target(file), { at, limit: 300, filter: {} });
      assert.deepEqual(shape(page!.lines), visible.slice(0, first + AT_AFTER_LINES + 1), `at ${(at - T0) / 1000}`);
    }
  });
}

test("긴 줄을 건너뛰는 동안 이벤트 루프를 양보한다(줄을 다 모은 뒤 버리지 않는다)", async () => {
  const file = tmpFile();
  const big = 40 * 1024 * 1024;
  fs.writeFileSync(file, `${line(0, "first")}\n${line(1, "huge", big)}\n${line(2, "last")}\n`);
  let turns = 0;
  let ticking = true;
  const tick = () => {
    turns++;
    if (ticking) setImmediate(tick);
  };
  setImmediate(tick);
  const [listed] = await listLogFiles(file);
  const scanned = turns;
  const found = await readLogPage(target(file), { limit: 5, filter: { q: "last" } });
  const searched = turns;
  const tail = await readLogPage(target(file), { limit: 5, filter: {} });
  ticking = false;
  assert.equal(listed!.lines, 2);
  assert.deepEqual(
    found!.lines.map((one) => one.text),
    ["last"],
  );
  assert.deepEqual(
    tail!.lines.map((one) => one.text),
    ["first", "last"],
  );
  // 청크(256KB)마다 한 번: 40MB 면 160번 남짓. 목록과 검색은 앞에서부터, 끝에서부터 페이지는 뒤에서부터 읽는다
  assert.ok(scanned >= 100, `목록을 훑는 동안 돈 턴 수 ${scanned}`);
  assert.ok(searched - scanned >= 100, `검색하는 동안 돈 턴 수 ${searched - scanned}`);
  assert.ok(turns - searched >= 100, `끝에서부터 읽는 동안 돈 턴 수 ${turns - searched}`);
});

/** run 이 끝날 때까지 이벤트 루프가 돈 턴 수 */
async function turnsDuring<T>(run: () => Promise<T>): Promise<{ value: T; turns: number }> {
  let turns = 0;
  let ticking = true;
  const tick = () => {
    turns++;
    if (ticking) setImmediate(tick);
  };
  setImmediate(tick);
  const value = await run();
  ticking = false;
  return { value, turns };
}

test("줄바꿈 없는 큰 구간을 지나는 첫 줄 찾기, 줄 시작 찾기, 시각 찾기도 이벤트 루프를 양보한다", async () => {
  const region = "x".repeat(16 * 1024 * 1024);
  const rest = `${Array.from({ length: 100 }, (_, k) => line(k + 1, `line ${k + 1}`)).join("\n")}\n`;
  const front = tmpFile();
  fs.writeFileSync(front, `${region}\n${rest}`);
  const middle = tmpFile();
  const head = `${line(0, "line 0")}\n`;
  fs.writeFileSync(middle, `${head}${region}\n${rest}`);

  // 64KB 조각마다 한 번: 16MB 면 256번 남짓. 아래 셋은 뒤따르는 읽기가 짧아 그 턴이 거의 다 구간을 지나는 동안이다
  const resolved = await turnsDuring(() => resolveLogFile(front, "bot.log", T0 + 1000));
  assert.equal(resolved.value?.path, front);
  assert.ok(resolved.turns >= 100, `첫 줄을 찾는 동안 돈 턴 수 ${resolved.turns}`);

  const next = await turnsDuring(() => readLogPage(target(middle), { after: head.length + 10, limit: 3, filter: {} }));
  assert.deepEqual(
    next.value!.lines.map((one) => one.text),
    ["line 1", "line 2", "line 3"],
  );
  assert.ok(next.turns >= 100, `다음 줄을 찾는 동안 돈 턴 수 ${next.turns}`);

  const at = await turnsDuring(() => readLogPage(target(middle), { at: T0 + 20_000, limit: 5, filter: {} }));
  assert.deepEqual(
    at.value!.lines.map((one) => one.text),
    [66, 67, 68, 69, 70].map((k) => `line ${k}`),
  );
  assert.ok(at.turns >= 100, `시각을 찾는 동안 돈 턴 수 ${at.turns}`);
});

test("첫 줄을 찾는 사이 지금 파일이 떼어지면 다시 찾아 보던 파일(첫 줄 시각이 같은 파일)을 읽는다", async () => {
  const file = tmpFile();
  const rest = `${Array.from({ length: 10 }, (_, k) => line(k + 1, `line ${k + 1}`)).join("\n")}\n`;
  fs.writeFileSync(file, `${"x".repeat(4 * 1024 * 1024)}\n${rest}`);
  const reading = readNamedLogPage(file, "bot.log", T0 + 1000, { limit: 3, filter: {} });
  // 첫 줄을 찾느라 이벤트 루프를 놓은 사이에 기록기처럼 이름을 바꾸고 새 파일을 시작한다
  const moved = backupPath(file, new Date(2026, 5, 1));
  setImmediate(() => {
    fs.renameSync(file, moved);
    fs.writeFileSync(file, `${line(100, "line 100")}\n`);
  });
  const page = await reading;
  assert.deepEqual([page?.name, page?.since, page?.lines.map((one) => one.text)], [path.basename(moved), T0 + 1000, ["line 8", "line 9", "line 10"]]);
});

test("목록 훑기 캐시: 긴 줄이 가운데, 끝에 있어도 다시 훑을 때 두 번 세지 않고, 끝의 덜 된 긴 줄은 마저 써도 세지 않는다", async () => {
  const file = tmpFile();
  const head = [line(0, "a"), line(1, "huge", LINE_MAX + 10), line(2, "b"), line(3, "c")].join("\n") + "\n";
  fs.writeFileSync(file, `${head}${line(4, "huge tail", LINE_MAX + 10).slice(0, -50)}`);
  const count = async () => (await listLogFiles(file))[0]!.lines;
  assert.equal(await count(), 3);
  assert.equal(await count(), 3);
  // 덜 된 긴 줄을 마저 쓰고, 그 뒤에 줄을 더한다
  fs.appendFileSync(file, `${line(4, "huge tail", LINE_MAX + 10).slice(-50)}\n${line(5, "d")}\n`);
  assert.equal(await count(), 4);
  // 끝에 줄바꿈으로 끝난 긴 줄이 있어도 다시 훑을 때 그대로
  fs.appendFileSync(file, `${line(6, "huge end", LINE_MAX + 10)}\n`);
  assert.equal(await count(), 4);
  assert.equal(await count(), 4);
  fs.appendFileSync(file, `${line(7, "e")}\n`);
  assert.equal(await count(), 5);
});

test("첫 줄이 긴 줄이면 파일은 그 뒤 첫 줄의 시각으로 알아보고, 읽을 줄이 하나도 없는 파일도 앞뒤 어느 쪽으로든 끝난다", async () => {
  const first = tmpFile();
  fs.writeFileSync(first, `${line(0, "huge", LINE_MAX + 3)}\n${line(1, "a")}\n${line(2, "b")}\n`);
  const [listed] = await listLogFiles(first);
  assert.deepEqual([listed!.lines, listed!.firstAt], [2, T0 + 1000]);
  const page = await readLogPage(target(first), { limit: 5, filter: {} });
  assert.deepEqual([page!.since, page!.lines.map((one) => one.text)], [T0 + 1000, ["a", "b"]]);

  const none = tmpFile();
  fs.writeFileSync(none, `${line(0, "huge", LINE_MAX + 3)}\n${line(1, "huge", 2 * LINE_MAX)}\n${line(2, "huge", LINE_MAX)}`);
  const [empty] = await listLogFiles(none);
  assert.deepEqual([empty!.lines, empty!.firstAt], [0, 0]);
  for (const query of [{}, { after: -1 }, { at: T0 + 1000 }, { filter: { q: "huge" } }]) {
    const got = await readLogPage(target(none), { limit: 5, filter: {}, ...query });
    assert.deepEqual([got!.lines.length, got!.more], [0, false], JSON.stringify(query));
  }
  const downloaded: FileLine[] = [];
  for await (const batch of filteredLines(target(none), {})) downloaded.push(...batch);
  assert.equal(downloaded.length, 0);
});
