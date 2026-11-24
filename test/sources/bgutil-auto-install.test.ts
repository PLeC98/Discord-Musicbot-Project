// src/sources/bgutil/auto-install.ts: POToken 서버 사용을 켰는데 bgutil이 없으면 알아서 설치한다. 저장된 켜기, 설치 여부, 작업 실행기, 필요한 도구는 가짜다

import { rule } from "../../src/rules/rule-problem.ts";
import { logRuleLine } from "../../src/rules/text/index.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { BgutilAutoInstall, type BgutilAutoDeps, type BgutilBuildRef } from "../../src/sources/bgutil/auto-install.ts";
import type { ScriptJobInfo, ScriptJobSpec } from "../../src/infra/script-job.ts";
import type { BgutilNeed } from "../../src/sources/bgutil/status-types.ts";

const TARGET = { tag: "2.0.2", commit: "a".repeat(40) };

/** 가짜 세상. enabled: 저장된 켜기, installed: 설치 여부(build: 설치된 빌드, 없으면 목표), needs: 없는 것, busy: 작업 자리가 찼다. starts, cancels: 부른 기록. end(state): 도는 작업을 끝낸다 */
function world() {
  const w = {
    enabled: true,
    installed: false,
    build: null as BgutilBuildRef | null,
    needs: [] as BgutilNeed[],
    busy: false,
    target: TARGET as BgutilBuildRef,
    spec: null as Omit<ScriptJobSpec, "onEnd"> | null,
    starts: 0,
    cancels: [] as number[],
    onEnd: null as ((info: ScriptJobInfo) => void) | null,
  };
  const deps: BgutilAutoDeps = {
    savedEnabled: () => w.enabled,
    active: () => (w.installed ? (w.build ?? w.target) : null),
    target: () => w.target,
    needs: async () => w.needs,
    start: (spec, onEnd) => {
      if (w.busy) return { ok: false, reason: "busy", running: null };
      w.starts++;
      w.spec = spec;
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
  assert.match(auto.failure ? logRuleLine(auto.failure.reason) : "", /exit, 종료 코드 1: 의존성 설치\(npm ci --ignore-scripts\) \| 2\.0\.2 설치 실패/, "스크립트 출력의 앞부분(수준, 분류)을 뗀다");
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
  assert.deepEqual(auto.failure?.reason, rule("bgutil-install-cancelled"));
  w.enabled = true;
  await auto.ensure("settings");
  assert.equal(w.starts, 2);
});

test("설치 작업에 목표의 태그와 커밋을 넘기고, 기록의 지금 빌드가 그 목표일 때만 성공으로 본다", async () => {
  const { w, auto } = world();
  await auto.ensure("startup");
  assert.deepEqual(w.spec?.args, ["--tag", TARGET.tag, "--commit", TARGET.commit]);
  assert.equal(w.spec?.succeeded?.(), false, "아직 설치되지 않았다");
  w.installed = true;
  w.build = { tag: "2.0.1", commit: "b".repeat(40) };
  assert.equal(w.spec?.succeeded?.(), false, "다시 설치가 실패해 옛 빌드가 남았다");
  w.build = null;
  assert.equal(w.spec?.succeeded?.(), true);
});

test("설치된 것이 목표와 다르면 혼자서는 받지 않고 운영자의 받기로만 받는다", async () => {
  const { w, auto } = world();
  w.installed = true;
  w.build = { tag: "2.0.1", commit: "b".repeat(40) };
  await auto.ensure("startup");
  await auto.ensure("settings");
  assert.equal(w.starts, 0);
  await auto.ensure("manual");
  assert.equal(w.starts, 1);
});

test("꺼져 있어도 운영자의 받기는 목표와 다른 설치를 바꾸고, 끄는 판정이 그것을 중단하지 않는다. 설치된 것이 없으면 켤 때 받는다", async () => {
  const has = world();
  has.w.enabled = false;
  has.w.installed = true;
  has.w.build = { tag: "2.0.1", commit: "b".repeat(40) };
  await has.auto.ensure("manual");
  assert.equal(has.w.starts, 1);
  await has.auto.ensure("settings");
  assert.deepEqual(has.w.cancels, [], "운영자가 시작한 것은 그대로");

  const none = world();
  none.w.enabled = false;
  await none.auto.ensure("manual");
  assert.equal(none.w.starts, 0);
  none.w.enabled = true;
  await none.auto.ensure("settings");
  assert.equal(none.w.starts, 1);
});

test("판정이 도는 중에 운영자의 받기가 오면 그 뒤에 받기로 한 번 더 판정하고, 기다린 쪽은 그것까지 끝난 뒤 풀린다", async () => {
  const { w, auto } = world();
  w.installed = true;
  w.build = { tag: "2.0.1", commit: "b".repeat(40) };
  const first = auto.ensure("settings");
  const second = auto.ensure("manual");
  await second;
  assert.equal(w.starts, 1);
  await first;
});

test("설치가 도는 동안 들어온 운영자의 받기는 그 설치가 맡는다. 실패한 뒤 상관없는 판정이 다시 설치하지 않는다", async () => {
  const { w, auto, end } = world();
  await auto.ensure("settings");
  await auto.ensure("manual");
  assert.equal(w.starts, 1);
  end("failed");
  await auto.ensure("settings");
  assert.equal(w.starts, 1);
});

test("성공하면 실패를 지운다", async () => {
  const { auto, end } = world();
  await auto.ensure("startup");
  end("succeeded");
  assert.equal(auto.job(), null);
  assert.equal(auto.failure, null);
});

test("설치 후 다시 시작 예약: 설치가 끝나면 다시 시작하고, 실패하거나 중단하면 풀린다. 설치가 없으면 예약하지 않는다", async () => {
  const idle = world();
  assert.equal(
    idle.auto.reserve(() => undefined),
    false,
    "돌거나 미룬 설치가 없다",
  );

  const ok = world();
  let restarted = 0;
  await ok.auto.ensure("startup");
  assert.equal(
    ok.auto.reserve(() => restarted++),
    true,
  );
  ok.end("succeeded");
  assert.equal(restarted, 1);
  assert.equal(ok.auto.reserved, null);

  const bad = world();
  await bad.auto.ensure("startup");
  bad.auto.reserve(() => restarted++);
  bad.end("failed");
  assert.equal(restarted, 1, "실패하면 다시 시작하지 않는다");
  assert.equal(bad.auto.reserved, null);
});

test("설치 후 다시 시작 예약: 미뤄 둔 설치일 때 끄면 예약이 풀린다(작업이 끝나는 일이 없다)", async () => {
  const { w, auto } = world();
  w.busy = true;
  await auto.ensure("startup");
  assert.equal(
    auto.reserve(() => assert.fail("다시 시작하면 안 된다")),
    true,
  );
  w.enabled = false;
  await auto.ensure("settings");
  assert.equal(auto.reserved, null);
  assert.equal(auto.job(), null);
});
