"use strict";

// src/ChildProcessRegistry.js — 외부 프로세스 트리 종료
//
// 회귀 대상: 라이브 방송이 잘못 매칭돼 캐시 다운로드가 시작되면 yt-dlp가 ffmpeg를 외부 다운로더로
// 띄우는데(손자 프로세스), 봇을 종료해도 ffmpeg가 살아남아 끝나지 않는 방송을 계속 받아쓰던 문제.
//
// 이 테스트는 실제로 손자 프로세스를 만들어 killAll이 "트리 전체"를 죽이는지 확인한다.
// Windows(taskkill /T)와 POSIX(detached + 프로세스 그룹 시그널)는 구현이 완전히 다르므로,
// CI가 ubuntu·windows 양쪽에서 이 파일을 돌려 두 경로를 모두 증명한다.

const { spawn } = require("node:child_process");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const IS_WIN = process.platform === "win32";
const registry = require("../src/ChildProcessRegistry");

/** pid가 아직 살아있는가 — 시그널 0은 존재 확인만 한다(Windows에서도 동작). */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** cond()가 true가 될 때까지(또는 timeout까지) 대기 */
async function waitFor(cond, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return cond();
}

/**
 * 자식(node) 하나를 띄우고, 그 자식이 손자(node) 하나를 띄우게 한다.
 * 손자 pid를 stdout으로 받아 두 세대가 모두 정리되는지 확인할 수 있게 한다.
 */
function spawnChildWithGrandchild() {
  // 손자는 아무 일도 안 하고 그냥 오래 살아있는다 — 무한 다운로드 중인 ffmpeg의 대역.
  const script = `
    const { spawn } = require("node:child_process");
    const g = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1e9)"], { stdio: "ignore" });
    process.stdout.write(String(g.pid) + "\\n");
    setInterval(() => {}, 1e9);
  `;
  const child = spawn(process.execPath, ["-e", script], {
    stdio: ["ignore", "pipe", "ignore"],
    // POSIX는 자체 프로세스 그룹이 있어야 그룹킬로 손자까지 잡을 수 있다(운영 코드 ytdlp.js와 동일 조건).
    detached: !IS_WIN,
  });

  const grandchildPid = new Promise((resolve, reject) => {
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const nl = buf.indexOf("\n");
      if (nl >= 0) resolve(Number(buf.slice(0, nl).trim()));
    });
    child.once("error", reject);
    setTimeout(() => reject(new Error("손자 pid를 받지 못함")), 5000);
  });

  return { child, grandchildPid };
}

test("killAll: 자식과 손자 프로세스를 모두 종료한다 (좀비 ffmpeg 회귀)", async () => {
  const { child, grandchildPid } = spawnChildWithGrandchild();
  const gpid = await grandchildPid;

  assert.ok(alive(child.pid), "자식이 살아있어야 함");
  assert.ok(alive(gpid), "손자가 살아있어야 함");

  const release = registry.register(child, "test:child", { group: !IS_WIN });
  assert.equal(registry.size(), 1);

  const killed = registry.killAll("test");
  assert.equal(killed, 1, "1개 프로세스에 대해 kill을 시도해야 함");
  assert.equal(registry.size(), 0, "killAll 후 레지스트리는 비어야 함");

  assert.ok(await waitFor(() => !alive(child.pid)), "자식이 종료되어야 함");
  assert.ok(await waitFor(() => !alive(gpid)), "손자(ffmpeg 대역)도 함께 종료되어야 함 — 이게 핵심");

  release();
});

test("register: 유효하지 않은 pid는 추적하지 않는다 (pid 0 → -0 = 자기 그룹 자살 방지)", () => {
  assert.equal(registry.size(), 0);
  for (const pid of [undefined, null, 0, 1, -5, 1.5, "123", NaN]) {
    const release = registry.register({ pid }, "bogus");
    assert.equal(typeof release, "function");
    assert.equal(registry.size(), 0, `pid=${String(pid)}는 등록되면 안 됨`);
  }
});

test("killTree: 이미 종료한 프로세스에는 시그널을 보내지 않는다 (PID 재사용 보호)", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const release = registry.register(child, "test:short");
  await new Promise((resolve) => child.once("exit", resolve));

  // exit 후에는 exitCode/signalCode가 채워지므로 kill 대상에서 빠져야 한다.
  // (안 그러면 OS가 그 번호를 재발급한 남의 프로세스를 죽이게 된다.)
  assert.equal(registry._internals._isAlive(child), false);
  assert.equal(registry.killAll("test"), 0, "종료된 프로세스는 kill을 시도하지 않아야 함");

  release();
});

test("killAll: 멱등 — 비어 있으면 0을 반환하고 아무것도 하지 않는다", () => {
  assert.equal(registry.size(), 0);
  assert.equal(registry.killAll("test"), 0);
  assert.equal(registry.killAll("test"), 0);
});
