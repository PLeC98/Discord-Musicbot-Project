// src/dashboard/track-cache-probe.ts — 재생 테스트 줄. 세우고 곧바로 돌아오며 하나씩 차례로 열고, 결과를 음원 키로 남긴다.
// 결과는 확인 번호만 올린다(운영자가 누른 재생 테스트가 "새 변경 사항이 있어요" 알약을 표시하지 않게).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { openTempStore } from "../helpers/temp-store.ts";
import type { Probed } from "../../src/sources/source-probe.ts";

const store = openTempStore("track-cache-probe-");
const probes = await import("../../src/dashboard/track-cache-probe.ts");
const sourceChecks = await import("../../src/store/source-checks.ts");
const { cacheRevision } = await import("../../src/store/cache-db.ts");
after(() => {
  probes._setProbe();
  store.close();
});

const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;

test("세우고 곧바로 돌아온다: 새로 · 이미 있음 · 주소마다의 음원 키, 하나씩 차례로 열어 결과를 남긴다", async () => {
  const opened: string[] = [];
  const waiting: Array<(result: Probed) => void> = [];
  probes._setProbe(
    (url) =>
      new Promise<Probed>((resolve) => {
        opened.push(url);
        waiting.push(resolve);
      }),
  );
  const before = cacheRevision();

  const first = probes.enqueue([yt("aaaaaaaaaa1") + "&list=PL1", "https://soundcloud.com/a/b", "검색어"], "tester");
  assert.ok(first.ok);
  assert.deepEqual(first.queued, { queued: 2, already: 0, keys: ["yt:aaaaaaaaaa1", "sc:a/b", ""] });
  assert.deepEqual(opened, [yt("aaaaaaaaaa1")], "하나씩. 지정할 수 있는 주소는 다듬어 연다");
  assert.deepEqual(probes.revision().checking, ["yt:aaaaaaaaaa1", "sc:a/b"]);

  const again = probes.enqueue([yt("aaaaaaaaaa1"), "https://soundcloud.com/a/b"], "tester");
  assert.ok(again.ok);
  assert.deepEqual([again.queued.queued, again.queued.already], [0, 2], "하는 중 · 기다리는 것은 다시 세우지 않는다");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(opened, [yt("aaaaaaaaaa1")], "다시 눌러도 앞의 것이 끝나야 다음을 연다");

  waiting.shift()!({ ok: false, code: "live" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(opened, [yt("aaaaaaaaaa1"), "https://soundcloud.com/a/b"]);
  waiting.shift()!({ ok: true });
  await probes._idle();

  assert.equal(sourceChecks.getCheck("yt:aaaaaaaaaa1")?.ok, false);
  assert.equal(sourceChecks.getCheck("sc:a/b")?.ok, true);
  assert.deepEqual(probes.revision().checking, []);
  const after = cacheRevision();
  assert.deepEqual([after.revision, after.checkRevision], [before.revision, before.checkRevision + 2], "확인 번호만 오른다");

  const read = probes.checks(["yt:aaaaaaaaaa1", "sc:a/b", "yt:none"]);
  assert.ok(read.ok);
  assert.deepEqual(Object.keys(read.checks.checks).sort(), ["sc:a/b", "yt:aaaaaaaaaa1"]);
  assert.deepEqual(read.checks.checks["yt:aaaaaaaaaa1"], { ok: false, code: "live", at: sourceChecks.getCheck("yt:aaaaaaaaaa1")!.at });
  assert.equal(read.checks.checkRevision, after.checkRevision);
});

test("상한: 빈 목록 · 한 번에 세우는 수 · 한 번에 묻는 결과 수", () => {
  assert.deepEqual(probes.enqueue([], "tester"), { ok: false, code: "nothing-to-save" });
  assert.deepEqual(
    probes.enqueue(
      Array.from({ length: 21 }, (_, i) => yt(`aaaaaaaa${String(i).padStart(3, "0")}`)),
      "tester",
    ),
    { ok: false, code: "too-many-items", params: { max: 20 } },
  );
  assert.deepEqual(probes.checks(Array.from({ length: 201 }, (_, i) => `yt:${i}`)), { ok: false, code: "too-many-items", params: { max: 200 } });
});
