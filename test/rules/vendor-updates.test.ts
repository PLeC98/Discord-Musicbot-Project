// src/rules/vendor-updates.ts: 따로 받는 도구(ffmpeg, bgutil)의 새 버전 판정과 기본값 고치기(scripts/check-vendor-updates.ts 가 쓴다)

import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { auditCounts, compareVersions, isMonthEndBuild, newerFfmpegRelease, newerRelease, rewriteConstant, trackedIssue } from "../../src/rules/vendor-updates.ts";

test("월말 autobuild 만 고른다: 윤년 2월, 30일 달, 형식 밖은 아니다", () => {
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
  assert.throws(() => rewriteConstant(text, "OTHER", "x"), /OTHER 줄을 찾지 못함/);
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

test("갱신할 이슈: 라벨이 붙은 것을 먼저 선택하고, 없으면 이 워크플로의 계정(설정한 App, github-actions)이 연 bgutil 제목 이슈만 선택하며 사람이 같은 제목으로 연 이슈는 선택하지 않는다", () => {
  const human = { number: 3, title: "bgutil 2.0.2 lockfile에서 알려진 취약점 발견", author: { login: "someone" }, labels: [] };
  const app = { number: 7, title: "bgutil 2.0.2 lockfile에서 알려진 취약점 발견", author: { login: "app/musicbot-vendor" }, labels: [] };
  const actions = { number: 9, title: "bgutil 취약점", author: { login: "app/github-actions" }, labels: [] };
  const labeled = { number: 11, title: "아무 제목", author: { login: "someone" }, labels: [{ name: "bgutil-audit" }] };
  assert.equal(trackedIssue([human, app], "bgutil-audit", "musicbot-vendor"), 7);
  assert.equal(trackedIssue([human, actions], "bgutil-audit", "musicbot-vendor"), 9);
  assert.equal(trackedIssue([human], "bgutil-audit", "musicbot-vendor"), null, "사람이 연 같은 제목 이슈");
  assert.equal(trackedIssue([human, app, labeled], "bgutil-audit", "musicbot-vendor"), 11, "라벨은 triage 이상 권한이 있는 사람만 붙인다");
  assert.equal(trackedIssue([{ ...app, title: "취약점 bgutil" }], "bgutil-audit", "musicbot-vendor"), null, "제목이 bgutil 로 시작해야 한다");
  assert.equal(trackedIssue([{ ...human, author: null }], "bgutil-audit", ""), null, "작성자를 알 수 없는 이슈(삭제된 계정)");
  assert.equal(trackedIssue([app], "bgutil-audit", ""), null, "App slug 가 없으면 github-actions 만 선택한다");
});

test("워크플로가 실행하는 스크립트: gh 의 JSON 을 받아 번호를 출력하고, 없으면 아무것도 출력하지 않는다", () => {
  const run = (issues: unknown) => execFileSync(process.execPath, ["scripts/vendor-issue.ts", "bgutil-audit", "musicbot-vendor"], { input: JSON.stringify(issues), encoding: "utf8" });
  assert.equal(run([{ number: 7, title: "bgutil x", author: { login: "app/musicbot-vendor" }, labels: [] }]).trim(), "7");
  assert.equal(run([{ number: 3, title: "bgutil x", author: { login: "someone" }, labels: [] }]), "");
  assert.equal(run([]), "");
});
