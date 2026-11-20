// src/infra/cpu-quota.ts: cgroup v2의 CPU 상한을 이 프로세스의 cgroup에서 루트까지 올라가며 읽고, 가장 작은 값을 고른다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpuQuota } from "../../src/infra/cpu-quota.ts";

// 파일 경로마다 정해 둔 내용을 돌려주는 가짜 읽기 함수. 없는 파일은 ENOENT를 던진다
const reader = (files: Record<string, string>) => (file: string) => {
  const text = files[file];
  if (text === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  return text;
};

test("컨테이너 안에서는 루트로 보이는 이 프로세스의 cgroup에서 상한을 읽는다", () => {
  const read = reader({ "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/cpu.max": "150000 100000\n" });
  assert.equal(cpuQuota("linux", read), 1.5);
});

test("systemd 서비스처럼 경로가 깊은 cgroup에서는 상위 cgroup의 상한까지 보고 가장 작은 값을 고른다", () => {
  const read = reader({
    "/proc/self/cgroup": "0::/system.slice/musicbot.service\n",
    "/sys/fs/cgroup/system.slice/musicbot.service/cpu.max": "400000 100000\n",
    "/sys/fs/cgroup/system.slice/cpu.max": "200000 100000\n",
  });
  assert.equal(cpuQuota("linux", read), 2);
});

test("상한이 없으면 null", () => {
  const read = reader({
    "/proc/self/cgroup": "0::/user.slice/user-1000.slice/session-3.scope\n",
    "/sys/fs/cgroup/user.slice/user-1000.slice/session-3.scope/cpu.max": "max 100000\n",
    "/sys/fs/cgroup/user.slice/user-1000.slice/cpu.max": "max 100000\n",
    "/sys/fs/cgroup/user.slice/cpu.max": "max 100000\n",
  });
  assert.equal(cpuQuota("linux", read), null);
});

test("cgroup을 읽지 못하면 상한이 없는 것으로 본다", () => {
  assert.equal(cpuQuota("linux", reader({})), null);
  assert.equal(cpuQuota("linux", reader({ "/proc/self/cgroup": "0::/a\n", "/sys/fs/cgroup/a/cpu.max": "엉뚱한 값\n" })), null);
});

test("Linux가 아니면 읽지 않는다", () => {
  const read = () => assert.fail("읽으면 안 된다");
  assert.equal(cpuQuota("win32", read), null);
  assert.equal(cpuQuota("darwin", read), null);
});
