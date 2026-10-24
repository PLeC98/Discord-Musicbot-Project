// src/sources/bgutil-version.ts — 설치된 bgutil · 설정한 버전 · 최신 릴리스를 견주어 알리기만 한다(설치는 봇을 끄고)

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import sink from "../../src/infra/log/sink.ts";
import { withConfig } from "../helpers/config.ts";
import { BgutilVersion, type BgutilVersionIo } from "../../src/sources/bgutil-version.ts";

const made: BgutilVersion[] = [];
afterEach(() => made.splice(0).forEach((one) => one.stop()));

function make(installed: string | null, latest: string | Error) {
  let asked = 0;
  const io: BgutilVersionIo = {
    installed: () => installed,
    latest: async () => {
      asked += 1;
      if (latest instanceof Error) throw latest;
      return latest;
    },
    now: () => 1_000,
  };
  const one = new BgutilVersion(io);
  made.push(one);
  return { one, asked: () => asked };
}

// 시작한 뒤 남긴 줄(경고 · 정보)
async function started(one: BgutilVersion) {
  const from = sink.buffer.length;
  await one.start();
  return sink.buffer.slice(from).filter((e) => e.level === "warn" || e.level === "info");
}

test("설치 · 설정 · 최신이 같으면 아무것도 남기지 않고 상태만 싣는다", () =>
  withConfig({ bgutil: { version: "2.0.2" } }, async () => {
    const { one } = make("2.0.2", "2.0.2");
    assert.deepEqual(await started(one), []);
    assert.deepEqual(one.state(), { installed: "2.0.2", target: "2.0.2", newer: null, checkedAt: 1_000 });
  }));

test("설치가 설정보다 낡았으면(코드를 받고 다시 설치하지 않음) 무엇을 할지 warn 한 줄", () =>
  withConfig({ bgutil: { version: "2.0.2" } }, async () => {
    const { one } = make("2.0.0", "2.0.2");
    const lines = await started(one);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].level, "warn");
    assert.match(lines[0].text, /설치 2\.0\.0 · 설정 2\.0\.2\. 봇을 끄고 pnpm run update:bgutil/);
    assert.equal(one.state()?.installed, "2.0.0");
  }));

test("설정보다 새 릴리스가 있으면 info 한 줄과 상태의 newer", () =>
  withConfig({ bgutil: { version: "2.0.2" } }, async () => {
    const { one } = make("2.0.2", "2.0.3");
    const lines = await started(one);
    assert.deepEqual(
      lines.map((e) => e.level),
      ["info"],
    );
    assert.match(lines[0].text, /2\.0\.2 → 2\.0\.3/);
    assert.equal(one.state()?.newer, "2.0.3");
  }));

test("운영자가 .env 로 고정한 버전이 목표다(그보다 낡은 기본값과 견주지 않는다)", () =>
  withConfig({ bgutil: { version: "1.3.2" } }, async () => {
    const { one } = make("1.3.2", "2.0.2");
    const lines = await started(one);
    assert.deepEqual(
      lines.map((e) => e.level),
      ["info"],
      "설치는 설정과 같다. 새 버전 소식만",
    );
    assert.deepEqual(one.state(), { installed: "1.3.2", target: "1.3.2", newer: "2.0.2", checkedAt: 1_000 });
  }));

test("설치돼 있지 않으면 묻지 않고 상태도 없다", async () => {
  const { one, asked } = make(null, "2.0.2");
  assert.deepEqual(await started(one), []);
  assert.equal(asked(), 0);
  assert.equal(one.state(), null);
});

test("조회가 실패하면 던지지 않고 warn, 새 버전은 모른다", () =>
  withConfig({ bgutil: { version: "2.0.2" } }, async () => {
    const { one } = make("2.0.2", new Error("GitHub 릴리스 조회 503"));
    const lines = await started(one);
    assert.equal(lines.length, 1);
    assert.match(lines[0].text, /bgutil 새 버전 조회 실패: GitHub 릴리스 조회 503/);
    assert.deepEqual(one.state(), { installed: "2.0.2", target: "2.0.2", newer: null, checkedAt: null });
  }));
