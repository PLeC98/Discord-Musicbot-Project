// src/infra/leftover-children.ts — 직전 실행이 남긴 자식 프로세스를 기동 때 내린다.
// 기록과 이름 · 시작 시각이 맞는 것만 내리고(pid 재사용 보호), 기록을 적은 봇이 아직 돌면 아무것도 하지 않는다. 진짜 프로세스는 건드리지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import { sweepLeftoverChildren, type SeenProcess } from "../../src/infra/leftover-children.ts";
import type { ChildRecord } from "../../src/infra/process-registry.ts";

const T = 1_790_000_000_000;
const SELF = { pid: 500, ppid: 400 };

// 기록 파일 하나와 OS 가 아는 프로세스들. 내린 것 · 삭제한 것 · 물어본 pid 를 적는다
function world(record: ChildRecord | string | null, running: SeenProcess[]) {
  const killed: string[] = [];
  const asked: number[][] = [];
  let removed = false;
  const boundary = {
    read: () => (record === null ? null : typeof record === "string" ? record : JSON.stringify(record)),
    remove: () => void (removed = true),
    processes: (pids: number[]) => (asked.push(pids), running.filter((p) => pids.includes(p.pid))),
    killTree: (pid: number, group: boolean) => void killed.push(`${pid}${group ? ":group" : ""}`),
    self: SELF,
  };
  return { run: () => sweepLeftoverChildren("child-processes.json", boundary), killed, asked, removed: () => removed };
}

const owner = { pid: 300, startedAt: T };
const child = (pid: number, label: string, image: string | null, startedAt = T + 5000, group = false) => ({ pid, label, image, group, startedAt });

test("기록이 없으면 아무것도 하지 않는다(OS 에 묻지도 않는다)", () => {
  const w = world(null, []);
  assert.deepEqual(w.run(), []);
  assert.deepEqual(w.asked, []);
});

test("깨끗이 끝나 남은 자식이 없으면 기록만 삭제한다(OS 에 묻지 않는다)", () => {
  const w = world({ owner, children: [] }, []);
  assert.deepEqual(w.run(), []);
  assert.deepEqual(w.asked, []);
  assert.equal(w.removed(), true);
});

test("기록을 읽지 못하면 삭제하고 넘어간다", () => {
  const w = world("{깨짐", []);
  assert.deepEqual(w.run(), []);
  assert.equal(w.removed(), true);
});

test("살아 있고 이름 · 시작 시각이 기록과 맞는 자식만 트리째 내리고 기록을 삭제한다", () => {
  const w = world({ owner, children: [child(11, "bgutil", "node"), child(12, "ffmpeg:재생", "ffmpeg"), child(13, "yt-dlp", "yt-dlp", T + 9000, true), child(14, "yt-dlp", "yt-dlp")] }, [
    { pid: 11, image: "node", startedAt: T + 5300 },
    { pid: 12, image: "ffmpeg", startedAt: T + 4000 },
    { pid: 13, image: "yt-dlp", startedAt: T + 9100 },
  ]);
  assert.deepEqual(w.run(), ["bgutil#11", "ffmpeg:재생#12", "yt-dlp#13"]);
  assert.deepEqual(w.killed, ["11", "12", "13:group"], "끝난 것(14)은 두고, 그룹으로 실행한 것은 그룹째");
  assert.equal(w.removed(), true);
});

test("pid 가 다른 프로그램에 다시 쓰였으면(이름이 다르거나 시작 시각이 멀면) 내리지 않는다", () => {
  const w = world({ owner, children: [child(21, "bgutil", "node"), child(22, "ffmpeg:재생", "ffmpeg"), child(23, "?", null)] }, [
    { pid: 21, image: "node", startedAt: T + 5000 + 60_000 },
    { pid: 22, image: "chrome", startedAt: T + 5000 },
    { pid: 23, image: "node", startedAt: T + 5000 },
  ]);
  assert.deepEqual(w.run(), []);
  assert.deepEqual(w.killed, []);
  assert.equal(w.removed(), true, "다음 기동이 다시 보지 않게 지운다");
});

test("기록을 적은 봇이 아직 돌면(봇이 둘) 아무것도 내리지 않고 기록도 둔다", () => {
  const w = world({ owner, children: [child(31, "bgutil", "node")] }, [
    { pid: 300, image: "node", startedAt: T + 400 },
    { pid: 31, image: "node", startedAt: T + 5000 },
  ]);
  assert.equal(w.run(), null);
  assert.deepEqual(w.killed, []);
  assert.equal(w.removed(), false);
});

test("기록의 봇 pid 를 다른 프로그램이 쓰고 있으면 그 봇은 끝난 것이다", () => {
  const w = world({ owner, children: [child(41, "bgutil", "node")] }, [
    { pid: 300, image: "node", startedAt: T + 3_600_000 },
    { pid: 41, image: "node", startedAt: T + 5000 },
  ]);
  assert.deepEqual(w.run(), ["bgutil#41"]);
});

test("자기 자신과 부모 프로세스는 기록에 있어도 건드리지 않는다", () => {
  const w = world({ owner, children: [child(SELF.pid, "bgutil", "node"), child(SELF.ppid, "bgutil", "node")] }, [
    { pid: SELF.pid, image: "node", startedAt: T + 5000 },
    { pid: SELF.ppid, image: "node", startedAt: T + 5000 },
  ]);
  assert.deepEqual(w.run(), []);
  assert.deepEqual(w.killed, []);
  assert.deepEqual(w.asked, [], "OS 에 묻지도 않는다");
});
