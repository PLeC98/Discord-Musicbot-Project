// src/dashboard/log-file-reader.ts — 로그 파일 읽기(끝에서부터 쪽 · 뒤로 이어 읽기 · 시각으로 가기 · 거르기 · 떼어진 파일 따라가기 · 덜 된 줄)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { listLogFiles, readLogPage, resolveLogFile, filteredLines, formatLogLine } from "../../src/dashboard/log-file-reader.ts";
import { backupPath } from "../../src/infra/log/file.ts";

const T0 = 1_760_000_000_000;
/** i 번째 줄: 1초 간격, 셋마다 warn, 다섯마다 youtube 카테고리 · retry 태그 */
const record = (i: number) => ({ time: T0 + i * 1000, level: i % 3 === 0 ? 40 : 30, msg: `줄 ${i} 재생 시작`, ...(i % 5 === 0 ? { category: "youtube", sub: "client", tags: ["retry"] } : { category: "player" }) });

function writeLog(n: number, extra = "") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logread-test-"));
  const file = path.join(dir, "bot.log");
  fs.writeFileSync(file, Array.from({ length: n }, (_, i) => JSON.stringify(record(i)) + "\n").join("") + extra);
  return { dir, file };
}
const all = { limit: 300, filter: {} };
const texts = (page: { lines: Array<{ text: string }> } | null) => page?.lines.map((l) => Number(l.text.split(" ")[1])) ?? [];

test("끝에서부터 쪽: 마지막 줄들이 차례대로, 앞에 더 있으면 more", () => {
  const { file } = writeLog(1000);
  const target = resolveLogFile(file, "bot.log");
  assert.ok(target);
  const page = readLogPage(target, { ...all, limit: 10 });
  assert.deepEqual(texts(page), [990, 991, 992, 993, 994, 995, 996, 997, 998, 999]);
  assert.equal(page?.more, true);
  assert.equal(page?.later, false);
  assert.equal(page?.since, T0);
  // 그 앞 쪽: 첫 줄의 위치 앞
  const earlier = readLogPage(target, { ...all, limit: 10, before: page?.lines[0].offset });
  assert.deepEqual(texts(earlier), [980, 981, 982, 983, 984, 985, 986, 987, 988, 989]);
  // 맨 앞까지
  const first = readLogPage(target, { ...all, limit: 10, before: readLogPage(target, { ...all, limit: 995 })?.lines[0].offset });
  assert.equal(first?.more, false);
});

test("뒤로 이어 읽기(after): 그 줄 다음부터, 끝까지 못 읽었으면 later", () => {
  const { file } = writeLog(100);
  const target = resolveLogFile(file, "bot.log")!;
  const head = readLogPage(target, { ...all, limit: 100 })!;
  const page = readLogPage(target, { ...all, limit: 5, after: head.lines[10].offset });
  assert.deepEqual(texts(page), [11, 12, 13, 14, 15]);
  assert.equal(page?.later, true);
  const tail = readLogPage(target, { ...all, limit: 5, after: head.lines[95].offset });
  assert.deepEqual(texts(tail), [96, 97, 98, 99]);
  assert.equal(tail?.later, false);
});

test("시각으로 가기(at): 그 시각 이상인 첫 줄이 들고, 그 뒤 50줄까지 받는다", () => {
  const { file } = writeLog(1000);
  const target = resolveLogFile(file, "bot.log")!;
  const page = readLogPage(target, { ...all, limit: 100, at: T0 + 400_500 })!;
  const nums = texts(page);
  assert.ok(nums.includes(401), "400.5초 뒤의 첫 줄은 401");
  assert.equal(nums.at(-1), 451);
  assert.equal(page.later, true);
  // 파일보다 앞 · 뒤의 시각
  assert.equal(texts(readLogPage(target, { ...all, limit: 100, at: T0 - 5000 }))[0], 0, "파일보다 이르면 첫 줄부터");
  assert.equal(texts(readLogPage(target, { ...all, limit: 10, at: T0 + 10_000_000 })).at(-1), 999);
});

test("거르기: 레벨 · 카테고리 · 태그 · 찾기(실시간 로그와 같은 규칙), 찾기가 있으면 파일 전체의 맞은 줄 수", () => {
  const { file } = writeLog(100);
  const target = resolveLogFile(file, "bot.log")!;
  const warn = readLogPage(target, { limit: 300, filter: { levels: new Set(["warn"] as const) } })!;
  assert.ok(warn.lines.every((l) => l.level === "warn"));
  assert.equal(warn.lines.length, 34);
  assert.equal(warn.matches, undefined);
  const yt = readLogPage(target, { limit: 3, filter: { category: "youtube", tag: "retry" } })!;
  assert.deepEqual(texts(yt), [85, 90, 95]);
  const found = readLogPage(target, { limit: 3, filter: { q: "줄 4" } })!;
  assert.equal(found.matches, 11, "줄 4 · 40 ~ 49");
  const ko = readLogPage(target, { limit: 3, filter: { q: "ㅈㅅ" } })!;
  assert.equal(ko.matches, 100, "초성 ㅈㅅ(재생 시작)");
  assert.equal(readLogPage(target, { limit: 3, filter: { levels: new Set() } })!.lines.length, 0, "레벨을 모두 끄면 없다");
});

test("덜 된 마지막 줄 · 읽을 수 없는 줄은 건너뛴다", () => {
  const { file } = writeLog(5, 'not json\n{"time":1,"lev');
  const target = resolveLogFile(file, "bot.log")!;
  assert.deepEqual(texts(readLogPage(target, all)), [0, 1, 2, 3, 4]);
  const [info] = listLogFiles(file);
  assert.equal(info.lines, 5);
});

test("목록: 지금 파일이 먼저, 떼어 낸 파일은 최근 것부터. 줄 수 · 카테고리 · 태그 · 처음과 끝 시각", () => {
  const { dir, file } = writeLog(10);
  fs.renameSync(file, backupPath(file, new Date(2026, 0, 1)));
  fs.writeFileSync(file, JSON.stringify(record(20)) + "\n");
  fs.writeFileSync(backupPath(file, new Date(2025, 0, 1)), JSON.stringify(record(-10)) + "\n");
  const files = listLogFiles(file);
  assert.deepEqual(
    files.map((f) => [f.name, f.current, f.lines]),
    [
      ["bot.log", true, 1],
      [path.basename(backupPath(file, new Date(2026, 0, 1))), false, 10],
      [path.basename(backupPath(file, new Date(2025, 0, 1))), false, 1],
    ],
  );
  assert.deepEqual([files[1].firstAt, files[1].lastAt], [T0, T0 + 9000]);
  assert.deepEqual([files[1].categories, files[1].tags], [["player", "youtube"], ["retry"]]);
  // 지금 파일이 늘면 늘어난 부분까지
  fs.appendFileSync(file, JSON.stringify(record(21)) + "\n");
  assert.equal(listLogFiles(file)[0].lines, 2);
  assert.ok(fs.existsSync(dir));
});

test("이름: 목록의 이름만 받는다(경로 · 다른 파일은 없음)", () => {
  const { dir, file } = writeLog(3);
  fs.writeFileSync(path.join(dir, "secret.txt"), "x");
  assert.equal(resolveLogFile(file, "../secret.txt"), null);
  assert.equal(resolveLogFile(file, "secret.txt"), null);
  assert.equal(resolveLogFile(file, path.join(dir, "bot.log")), null);
  assert.equal(resolveLogFile(file, ""), null);
  assert.ok(resolveLogFile(file, "bot.log"));
});

test("보던 지금 파일이 떼어졌으면 첫 줄의 시각(since)으로 떼어 낸 파일을 찾아 이어 읽는다", () => {
  const { file } = writeLog(50);
  const target = resolveLogFile(file, "bot.log")!;
  const page = readLogPage(target, { ...all, limit: 10 })!;
  const moved = backupPath(file, new Date(2026, 5, 1));
  fs.renameSync(file, moved);
  fs.writeFileSync(file, JSON.stringify(record(100)) + "\n");
  const again = resolveLogFile(file, "bot.log", page.since);
  assert.equal(again?.name, path.basename(moved));
  assert.deepEqual(texts(readLogPage(again!, { ...all, limit: 5, before: page.lines[0].offset })), [35, 36, 37, 38, 39]);
  // since 없이 부르면 지금 파일
  assert.equal(resolveLogFile(file, "bot.log")?.name, "bot.log");
  // 떼어 낸 파일도 삭제됐으면 없음
  fs.unlinkSync(moved);
  assert.equal(resolveLogFile(file, "bot.log", page.since), null);
});

test("내려받기: 거른 줄을 화면과 같은 칸으로, 시각은 보는 사람의 시간대", () => {
  const { file } = writeLog(10);
  const target = resolveLogFile(file, "bot.log")!;
  const lines = [...filteredLines(target, { category: "youtube" })];
  assert.equal(lines.length, 2);
  const kst = formatLogLine(lines[1], -540);
  assert.match(kst, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} INFO {2}youtube\/client #retry 줄 5 재생 시작$/);
  const utc = new Date(T0 + 5000).toISOString().replace("T", " ").replace("Z", "");
  assert.equal(formatLogLine(lines[1], 0).slice(0, 23), utc);
});
