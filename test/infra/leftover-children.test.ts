// src/infra/leftover-children.ts: 이전 실행이 남긴 자식 프로세스를 기동 시 내린다.
// 실행마다 파일 하나. 기록을 남긴 봇이 끝났을 때만, 이름 · 시작 시각이 맞는 자식과 그 손자를 내린다. 목록을 읽지 못하면 아무것도 내리지 않고 기록을 둔다.
// 진짜 프로세스 · 파일은 건드리지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { sweepLeftoverChildren } from "../../src/infra/leftover-children.ts";
import type { ChildRecord } from "../../src/infra/process-registry.ts";
import type { Proc } from "../../src/infra/process-snapshot.ts";

const T = 1_790_000_000_000;
const DAY = 24 * 60 * 60_000;
const SELF = { pid: 500, ppid: 400 };
const DIR = "records";

type Files = Record<string, ChildRecord | string>;

// 기록 파일들과 OS 가 아는 프로세스(null: 읽지 못함). 내린 것 · 지운 파일 · 다시 쓴 파일 · 목록을 읽은 횟수를 적는다
function world(files: Files, running: Proc[] | null, { failKill = [] as number[], now = T + 60_000, isWin = true } = {}) {
  const killed: string[] = [];
  const removed: string[] = [];
  const written: Record<string, ChildRecord> = {};
  let snapshots = 0;
  const boundary = {
    list: () => Object.keys(files),
    read: (file: string) => {
      const one = files[path.basename(file)];
      return one === undefined ? null : typeof one === "string" ? one : JSON.stringify(one);
    },
    write: (file: string, text: string) => void (written[path.basename(file)] = JSON.parse(text) as ChildRecord),
    remove: (file: string) => void removed.push(path.basename(file)),
    snapshot: () => (snapshots++, running),
    killTree: (pid: number, group: boolean) => (killed.push(`${pid}${group ? ":group" : ""}`), !failKill.includes(pid)),
    self: SELF,
    now: () => now,
  };
  return { run: () => sweepLeftoverChildren(DIR, boundary, isWin), killed, removed, written, snapshots: () => snapshots };
}

const owner = { pid: 300, image: "node", startedAt: T, startKey: null };
const child = (pid: number, label: string, image: string | null, { startedAt = T + 5000, group = false, startKey = null as string | null } = {}) => ({ pid, label, image, group, startedAt, startKey });
const proc = (pid: number, image: string, { ppid = 1, pgid = null as number | null, startedAt = T + 5000, startKey = null as string | null } = {}): Proc => ({ pid, ppid, pgid, image, startedAt, startKey });
const record = (children: ChildRecord["children"], who = owner): ChildRecord => ({ owner: who, children });

test("기록이 없으면 아무것도 하지 않는다(OS 에 묻지도 않는다)", () => {
  const w = world({}, []);
  assert.deepEqual(w.run(), []);
  assert.equal(w.snapshots(), 0);
});

test("읽지 못하는 기록은 지우고, 쓰는 중의 임시 파일은 건드리지 않는다", () => {
  const w = world({ "1-2.json": "{깨짐", "3-4.json.9.tmp": "{}" }, []);
  w.run();
  assert.deepEqual(w.removed, ["1-2.json"]);
});

test("살아 있고 이름 · 시작 시각이 기록과 맞는 자식만 트리째 내리고 기록을 지운다", () => {
  const w = world({ "300-1.json": record([child(10, "bgutil", "node"), child(11, "ffmpeg", "ffmpeg", { group: true })]) }, [proc(10, "node"), proc(11, "ffmpeg")]);
  assert.deepEqual(w.run(), ["bgutil#10", "ffmpeg#11"]);
  assert.deepEqual(w.killed, ["10", "11:group"]);
  assert.deepEqual(w.removed, ["300-1.json"]);
});

test("pid 가 다른 프로그램에 다시 쓰였으면(이름이 다르거나 시작 시각이 멀면) 내리지 않는다", () => {
  const w = world({ "300-1.json": record([child(10, "bgutil", "node"), child(11, "ffmpeg", "ffmpeg")]) }, [proc(10, "chrome"), proc(11, "ffmpeg", { startedAt: T + DAY })]);
  assert.deepEqual(w.run(), []);
  assert.deepEqual(w.killed, []);
  assert.deepEqual(w.removed, ["300-1.json"]);
});

test("시계와 상관없는 시작 표지가 둘 다 있으면 그것으로 맞춘다(Linux)", () => {
  const files = { "300-1.json": record([child(10, "yt-dlp", "yt-dlp", { startKey: "boot:100" })]) };
  assert.deepEqual(world(files, [proc(10, "yt-dlp", { startKey: "boot:100", startedAt: T + DAY })]).run(), ["yt-dlp#10"]);
  assert.deepEqual(world(files, [proc(10, "yt-dlp", { startKey: "boot:999" })]).run(), []);
});

test("Windows: 끝난 yt-dlp 의 남은 손자(안쪽 yt-dlp · conhost)를 부모 pid 로 찾아 내린다. 그보다 먼저 생긴 것 · 다른 프로그램은 둔다", () => {
  const w = world({ "300-1.json": record([child(20, "yt-dlp", "yt-dlp")]) }, [proc(21, "yt-dlp", { ppid: 20, startedAt: T + 5200 }), proc(22, "conhost", { ppid: 20, startedAt: T + 5100 }), proc(23, "notepad", { ppid: 20, startedAt: T + 6000 }), proc(24, "yt-dlp", { ppid: 20, startedAt: T - DAY })]);
  assert.deepEqual(w.run(), ["yt-dlp#20의 yt-dlp#21", "yt-dlp#20의 conhost#22"]);
  assert.deepEqual(w.killed, ["21", "22"]);
});

test("POSIX: 끝난 yt-dlp 의 프로세스 그룹에 남은 것이 있으면 그룹째 내린다. 그룹으로 띄우지 않은 자식은 손자를 찾지 않는다", () => {
  const w = world({ "300-1.json": record([child(30, "yt-dlp", "yt-dlp", { group: true }), child(31, "ffmpeg", "ffmpeg")]) }, [proc(35, "ffmpeg", { pgid: 30, startedAt: T + 6000 }), proc(36, "ffmpeg", { ppid: 31 })], { isWin: false });
  assert.deepEqual(w.run(), ["yt-dlp#30의 그룹"]);
  assert.deepEqual(w.killed, ["30:group"]);
});

test("기록을 남긴 봇이 아직 돌면 그 기록은 건드리지 않는다. 다른 기록은 그대로 정리한다", () => {
  const w = world({ "300-1.json": record([child(10, "bgutil", "node")]), "600-1.json": record([child(40, "ffmpeg", "ffmpeg")], { ...owner, pid: 600 }) }, [proc(300, "node", { startedAt: T }), proc(10, "node"), proc(40, "ffmpeg")]);
  assert.deepEqual(w.run(), ["ffmpeg#40"]);
  assert.deepEqual(w.killed, ["40"]);
  assert.deepEqual(w.removed, ["600-1.json"]);
});

test("기록의 봇 pid 를 다른 프로그램이 쓰고 있으면 그 봇은 끝난 것이다", () => {
  const w = world({ "300-1.json": record([child(10, "bgutil", "node")]) }, [proc(300, "chrome", { startedAt: T + DAY }), proc(10, "node")]);
  assert.deepEqual(w.run(), ["bgutil#10"]);
});

test("내리지 못한 자식은 그것만 남겨 기록을 다시 쓴다", () => {
  const w = world({ "300-1.json": record([child(10, "bgutil", "node"), child(11, "ffmpeg", "ffmpeg")]) }, [proc(10, "node"), proc(11, "ffmpeg")], { failKill: [11] });
  assert.deepEqual(w.run(), ["bgutil#10"]);
  assert.deepEqual(w.removed, []);
  assert.deepEqual(
    w.written["300-1.json"].children.map((c) => c.pid),
    [11],
  );
});

test("목록을 읽지 못하면 아무것도 내리지 않고 기록을 둔다. 7일 넘은 실행의 기록만 지운다", () => {
  const w = world({ "300-1.json": record([child(10, "bgutil", "node")]), "200-1.json": record([child(20, "ffmpeg", "ffmpeg")], { ...owner, pid: 200, startedAt: T - 8 * DAY }) }, null);
  assert.deepEqual(w.run(), []);
  assert.deepEqual(w.killed, []);
  assert.deepEqual(w.removed, ["200-1.json"]);
});

test("자기 자신과 부모 프로세스는 기록에 있어도 건드리지 않는다", () => {
  const w = world({ "300-1.json": record([child(SELF.pid, "봇", "node"), child(SELF.ppid, "실행기", "node")]) }, [proc(SELF.pid, "node"), proc(SELF.ppid, "node")]);
  assert.deepEqual(w.run(), []);
  assert.deepEqual(w.killed, []);
});
