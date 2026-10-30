// src/infra/process-snapshot.ts: OS 의 프로세스 목록. Linux 의 /proc/<pid>/stat 한 줄을 읽는 규칙과 이 OS 의 실제 목록

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStat, snapshotProcesses, sameImage } from "../../src/infra/process-snapshot.ts";

test("stat 한 줄: comm 의 공백 · 괄호를 견디고 부모 · 그룹 · 시작 틱을 읽는다", () => {
  // 필드: pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime cutime cstime priority nice threads itreal starttime …
  const line = "4321 (yt-dlp (x) y) S 4300 4321 4300 0 -1 4194304 10 0 0 0 1 2 0 0 20 0 1 0 987654 1000 200";
  const proc = parseStat(4321, line);
  assert.ok(proc);
  assert.equal(proc.ppid, 4300);
  assert.equal(proc.pgid, 4321);
  assert.equal(proc.image, "yt-dlp (x) y");
  assert.match(proc.startKey ?? "", /:987654$/);
  assert.equal(parseStat(1, "깨진 줄"), null);
});

test("Linux 의 comm 은 15자에서 잘리므로 이름은 그 길이로 견준다(그 밖의 OS 는 그대로)", () => {
  if (process.platform === "linux") assert.equal(sameImage("averyveryverylongname", "averyveryverylo"), true);
  else assert.equal(sameImage("averyveryverylongname", "averyveryverylo"), false);
  assert.equal(sameImage(null, "node"), false);
});

test("이 OS 의 목록에 이 프로세스가 이름 · 시작 시각과 함께 있다", () => {
  const procs = snapshotProcesses();
  assert.ok(procs, "목록을 읽었다");
  const self = procs.find((one) => one.pid === process.pid);
  assert.ok(self, "자기 자신이 있다");
  assert.equal(self.image, "node");
  assert.ok(Math.abs(self.startedAt - (Date.now() - process.uptime() * 1000)) < 10_000, "시작 시각이 맞다");
});
