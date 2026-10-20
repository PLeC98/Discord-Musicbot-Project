import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { auditCounts, compareVersions, isMonthEndBuild, newerFfmpegRelease, newerRelease, rewriteConstant } from "../../src/rules/vendor-updates.ts";

test("월말 autobuild 만 고른다: 윤년 2월 · 30일 달 · 형식 밖은 아니다", () => {
  assert.equal(isMonthEndBuild("autobuild-2026-09-30-13-08"), true);
  assert.equal(isMonthEndBuild("autobuild-2028-02-29-12-00"), true);
  assert.equal(isMonthEndBuild("autobuild-2026-02-28-12-00"), true);
  assert.equal(isMonthEndBuild("autobuild-2026-09-29-13-08"), false);
  assert.equal(isMonthEndBuild("autobuild-2026-10-30-13-08"), false);
  assert.equal(isMonthEndBuild("latest"), false);
  assert.equal(isMonthEndBuild("autobuild-2026-09-30"), false);
});

test("ffmpeg: 지금 것보다 새 월말 태그 중 가장 새 것, 없으면 null", () => {
  const tags = ["latest", "autobuild-2026-10-20-13-00", "autobuild-2026-09-30-13-08", "autobuild-2026-08-31-13-27", "autobuild-2026-07-31-12-58"];
  assert.equal(newerFfmpegRelease(tags, "autobuild-2026-08-31-13-27"), "autobuild-2026-09-30-13-08");
  assert.equal(newerFfmpegRelease(tags, "autobuild-2026-09-30-13-08"), null);
  assert.equal(newerFfmpegRelease(["autobuild-2026-07-31-12-58"], "autobuild-2026-08-31-13-27"), null, "더 옛 것으로 내리지 않는다");
  assert.equal(newerFfmpegRelease([], "autobuild-2026-08-31-13-27"), null);
});

test("bgutil: 숫자로 견준다(2.0.10 > 2.0.9), 같거나 모양이 다르면 null", () => {
  assert.equal(compareVersions("2.0.10", "2.0.9")! > 0, true);
  assert.equal(compareVersions("v2.1.0", "2.0.9")! > 0, true);
  assert.equal(compareVersions("2.0.2", "2.0.2"), 0);
  assert.equal(compareVersions("nightly", "2.0.2"), null);
  assert.equal(newerRelease("2.0.3", "2.0.2"), "2.0.3");
  assert.equal(newerRelease("2.0.2", "2.0.2"), null);
  assert.equal(newerRelease("2.0.1", "2.0.2"), null);
  assert.equal(newerRelease("main", "2.0.2"), null);
  assert.equal(newerRelease(null, "2.0.2"), null);
});

test("상수 한 줄만 고친다. 그 줄이 없으면 던진다", () => {
  const text = 'const FFMPEG_RELEASE = "a";\nconst BGUTIL_VERSION = "2.0.2";\n';
  assert.equal(rewriteConstant(text, "BGUTIL_VERSION", "2.0.3"), 'const FFMPEG_RELEASE = "a";\nconst BGUTIL_VERSION = "2.0.3";\n');
  assert.throws(() => rewriteConstant(text, "OTHER", "x"), /OTHER 줄을 찾지 못했습니다/);
});

test("고칠 상수 줄이 실제 파일에 있다(워크플로가 고치는 파일의 모양)", () => {
  const text = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "src", "config", "vendor-versions.ts"), "utf8");
  for (const name of ["FFMPEG_RELEASE", "BGUTIL_VERSION"]) assert.doesNotThrow(() => rewriteConstant(text, name, "x"), name);
});

test("npm audit 결과: 심각도별 수, 모양이 다르면 null(못 읽은 것을 0건으로 치지 않는다)", () => {
  assert.deepEqual(auditCounts({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 2, high: 8, critical: 1, total: 11 } } }), { total: 11, critical: 1, high: 8, moderate: 2, low: 0 });
  assert.deepEqual(auditCounts({ metadata: { vulnerabilities: { total: 0 } } }), { total: 0, critical: 0, high: 0, moderate: 0, low: 0 });
  assert.equal(auditCounts({ error: { code: "ENOLOCK" } }), null);
  assert.equal(auditCounts(null), null);
});
