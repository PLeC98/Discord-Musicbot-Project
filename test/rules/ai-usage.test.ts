import test from "node:test";
import assert from "node:assert";
import { addDays, bucketOf, firstDay, usageReport, type UsageRow } from "../../src/rules/ai-usage.ts";

const row = (patch: Partial<UsageRow> = {}): UsageRow => ({ day: "2026-10-10", source: "autoplay", provider: "openai", model: "gpt-x", name: "GPT X", guildId: "900", ok: true, tookMs: 1000, input: 100, output: 10, cached: 0, reasoning: 0, costUsd: 0.001, ...patch });

test("날 더하기는 달 · 해를 넘는다", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(firstDay(7, "2026-10-11", null), "2026-10-05");
  assert.equal(firstDay(0, "2026-10-11", "2026-08-01"), "2026-08-01");
  assert.equal(firstDay(0, "2026-10-11", null), "2026-10-11");
});

test("묶음: 실패 · 가격 모름을 세고, 응답 시간은 성공한 것만(p95 는 올림 자리)", () => {
  // 성공 10건(100 ~ 1000ms): p95 는 ceil(9.5) = 10번째 = 1000, 평균 550. 실패한 99999ms 는 세지 않는다
  const rows = [...Array.from({ length: 9 }, (_, i) => row({ tookMs: (i + 1) * 100 })), row({ tookMs: 1000, costUsd: null }), row({ ok: false, tookMs: 99999 })];
  const got = bucketOf(rows);
  assert.equal(got.requests, 11);
  assert.equal(got.failed, 1);
  assert.equal(got.unpriced, 1);
  assert.equal(got.p95Ms, 1000);
  assert.equal(got.avgMs, 550);
  assert.equal(bucketOf([]).avgMs, null);
});

test("날마다는 빈 날도 0 으로 채우고, 모델별은 모델이 없는 요청을 뺀다", () => {
  const report = usageReport([row({ day: "2026-10-08" }), row({ day: "2026-10-10" }), row({ day: "2026-10-10", source: "models", model: "", name: "", guildId: null })], { period: 7, from: "2026-10-08", today: "2026-10-11", guildName: (id) => `서버 ${id}` });
  assert.deepEqual(
    report.daily.map((one) => [one.day, one.requests]),
    [
      ["2026-10-08", 1],
      ["2026-10-09", 0],
      ["2026-10-10", 2],
      ["2026-10-11", 0],
    ],
  );
  assert.equal(report.byModel.length, 1);
  assert.equal(report.byModel[0].requests, 2);
  assert.deepEqual(
    report.bySource.map((one) => one.source),
    ["autoplay", "models"],
  );
  assert.deepEqual(report.byGuild, [{ guildId: "900", guildName: "서버 900", ...bucketOf([row(), row()]) }]);
});
