// src/sources/bgutil/auto-install.ts: POToken 서버 사용을 켰는데 bgutil이 없으면 알아서 설치한다. 저장된 켜기, 설치 여부, 작업 실행기, 필요한 도구는 가짜다

import { test } from "node:test";
import assert from "node:assert/strict";
import { BgutilAutoInstall, type BgutilAutoDeps } from "../../src/sources/bgutil/auto-install.ts";
import type { ScriptJobInfo } from "../../src/infra/script-job.ts";
import type { BgutilNeed } from "../../src/sources/bgutil/status-types.ts";

const TARGET = { tag: "2.0.2", commit: "a".repeat(40) };

/** 가짜 세상. enabled: 저장된 켜기, installed: 설치 여부, needs: 없는 것, busy: 작업 자리가 찼다. starts, cancels: 부른 기록. end(state): 도는 작업을 끝낸다 */
function world() {
  const w = {
    enabled: true,
    installed: false,
    needs: [] as BgutilNeed[],
    busy: false,
    target: TARGET as BgutilAutoDeps extends { target(): infer T } ? T : never,
    starts: 0,
    cancels: [] as number[],
    onEnd: null as ((info: ScriptJobInfo) => void) | null,
  };
  const deps: BgutilAutoDeps = {
    savedEnabled: () => w.enabled,
    installed: () => w.installed,
    target: () => w.target,
    needs: async () => w.needs,
    start: (_spec, onEnd) => {
      if (w.busy) return { ok: false, reason: "busy", running: null };
      w.starts++;
      w.onEnd = onEnd;
      return { ok: true, id: w.starts };
    },
    cancel: async (id) => {
      w.cancels.push(id);
      w.onEnd?.(info("failed", "cancelled"));
    },
    now: () => 1000,
  };
  const end = (state: "succeeded" | "failed") => w.onEnd?.(info(state, state === "failed" ? "exit" : null));
  return { w, auto: new BgutilAutoInstall(deps), end };
}

function info(state: "succeeded" | "failed", reason: ScriptJobInfo["reason"]): ScriptJobInfo {
  return { id: 1, name: "bgutil-install", state, reason, exitCode: state === "failed" ? 1 : 0, startedAt: 0, endedAt: 1, output: ["INFO  [bgutil] 의존성 설치(npm ci --ignore-scripts)", "ERROR [bgutil] 2.0.2 설치 실패(지금 쓰는 bgutil 그대로): canvas 빌드 실패"] };
}

test("꺼져 있거나 이미 설치돼 있으면 설치하지 않는다", async () => {
  const off = world();
  off.w.enabled = false;
  await off.auto.ensure("startup");
  const has = world();
  has.w.installed = true;
  await has.auto.ensure("startup");
  assert.deepEqual([off.w.starts, has.w.starts], [0, 0]);
});

test("켜져 있고 없으면 설치를 시작한다. 도는 동안 다시 불려도 하나만", async () => {
  const { w, auto } = world();
  await auto.ensure("startup");
  await auto.ensure("settings");
  assert.equal(w.starts, 1);
  assert.equal(auto.job(), "running");
});

test("실패하면 사유를 남기고 혼자서는 다시 하지 않는다. 운영자의 다시 시도는 한다", async () => {
  const { w, auto, end } = world();
  await auto.ensure("startup");
  end("failed");
  assert.match(auto.failure?.reason ?? "", /exit, 종료 코드 1: 의존성 설치\(npm ci --ignore-scripts\) \| 2\.0\.2 설치 실패/, "스크립트 출력의 앞부분(수준, 분류)을 뗀다");
  await auto.ensure("settings");
  await auto.ensure("startup");
  assert.equal(w.starts, 1);
  await auto.ensure("manual");
  assert.equal(w.starts, 2);
  assert.equal(auto.failure, null, "다시 시작하면 지난 실패를 지운다");
});

test("필요한 도구가 없으면 시작하지 않고 없는 것을 남긴다. 도구를 설치한 뒤 다시 시도하면 시작한다", async () => {
  const { w, auto } = world();
  w.needs = ["git", "npm"];
  await auto.ensure("startup");
  assert.equal(w.starts, 0);
  assert.deepEqual(auto.missing, ["git", "npm"]);
  await auto.ensure("settings");
  assert.equal(w.starts, 0, "혼자서 다시 보지 않는다");
  w.needs = [];
  await auto.ensure("manual");
  assert.equal(w.starts, 1);
  assert.deepEqual(auto.missing, []);
});

test("다른 작업이 돌고 있으면 뒤로 미루고, 자리가 비면 시작한다", async () => {
  const { w, auto } = world();
  w.busy = true;
  await auto.ensure("startup");
  assert.equal(auto.job(), "queued");
  w.busy = false;
  await auto.ensure("idle");
  assert.equal(w.starts, 1);
  assert.equal(auto.job(), "running");
});

test("미룬 것이 없으면 자리가 비어도 하지 않는다(자기 설치가 끝난 뒤 등)", async () => {
  const { w, auto, end } = world();
  await auto.ensure("startup");
  end("failed");
  await auto.ensure("idle");
  assert.equal(w.starts, 1);
});

test("끄면 도는 설치를 중단하고, 다시 켜면 시도 기록을 지우고 다시 설치한다", async () => {
  const { w, auto } = world();
  await auto.ensure("startup");
  w.enabled = false;
  await auto.ensure("settings");
  assert.deepEqual(w.cancels, [1]);
  assert.equal(auto.failure?.reason, "중단");
  w.enabled = true;
  await auto.ensure("settings");
  assert.equal(w.starts, 2);
});

test("받을 태그, 커밋 설정이 틀렸으면 시작하지 않고 그 사유를 남긴다", async () => {
  const { w, auto } = world();
  w.target = { error: "BGUTIL_COMMIT은 커밋 해시 40자여야 합니다" };
  await auto.ensure("startup");
  assert.equal(w.starts, 0);
  assert.match(auto.failure?.reason ?? "", /BGUTIL_COMMIT/);
});

test("성공하면 실패를 지운다", async () => {
  const { auto, end } = world();
  await auto.ensure("startup");
  end("succeeded");
  assert.equal(auto.job(), null);
  assert.equal(auto.failure, null);
});
