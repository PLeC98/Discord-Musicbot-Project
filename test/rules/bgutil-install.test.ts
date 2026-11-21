// src/rules/bgutil-install.ts: bgutil 설치가 받을 태그와 커밋, 태그가 가리키는 커밋, lockfile에서 설치 스크립트를 돌릴 실행 의존성, 루트의 설치 스크립트

import test from "node:test";
import assert from "node:assert/strict";
import { bgutilTarget, isCommitSha, isPlainTag, rebuildTargets, rootInstallScripts, taggedCommit } from "../../src/rules/bgutil-install.ts";
import { BGUTIL_COMMIT, BGUTIL_VERSION } from "../../src/config/vendor-versions.ts";
import { loadConfig } from "../../src/config/index.ts";
import { logRuleLine } from "../../src/rules/text/index.ts";
import { rewriteConstant } from "../../src/rules/vendor-updates.ts";

const DEFAULTS = { version: "2.0.2", commit: "a".repeat(40) };
const OTHER = "b".repeat(40);

test("기본 태그와 고정한 커밋: 태그는 숫자 판, 커밋은 40자 소문자 16진", () => {
  assert.match(BGUTIL_VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(isCommitSha(BGUTIL_COMMIT), BGUTIL_COMMIT);
  assert.equal(isCommitSha("A".repeat(40)), false);
  assert.equal(isCommitSha("a".repeat(39)), false);
  assert.equal(isCommitSha("26475e9"), false, "짧은 커밋은 받지 않는다");
});

test("받을 짝: 고정이 없으면 기본 짝, 기본 태그만이면 고정한 커밋, 커밋을 주면 그 커밋", () => {
  assert.deepEqual(bgutilTarget("", "", DEFAULTS), { tag: "2.0.2", commit: DEFAULTS.commit });
  assert.deepEqual(bgutilTarget("2.0.2", "", DEFAULTS), { tag: "2.0.2", commit: DEFAULTS.commit });
  assert.deepEqual(bgutilTarget("2.0.3", OTHER, DEFAULTS), { tag: "2.0.3", commit: OTHER });
  assert.deepEqual(bgutilTarget("2.0.2", OTHER, DEFAULTS), { tag: "2.0.2", commit: OTHER }, "기본 태그에 다른 커밋을 주면 그 커밋으로 맞춰 본다(맞지 않으면 설치가 멈춘다)");
});

test("받을 짝: 다른 태그에 커밋이 없거나, 커밋만 있거나, 형식이 아니면 어느 이름이 왜 틀렸는지", () => {
  assert.deepEqual(bgutilTarget("2.0.3", "", DEFAULTS), { key: "BGUTIL_COMMIT", value: "", reason: { code: "bgutil-needs-commit", params: { tag: "2.0.2" } } });
  assert.deepEqual(bgutilTarget("", OTHER, DEFAULTS), { key: "BGUTIL_VERSION", value: "", reason: { code: "bgutil-commit-only" } });
  for (const commit of ["26475e9", "g".repeat(40), `${OTHER} `]) assert.equal((bgutilTarget("2.0.3", commit, DEFAULTS) as { key?: string }).key, "BGUTIL_COMMIT", commit);
  for (const tag of ["-x", "a:refs/heads/main", "v*", "a..b", "a b"]) {
    assert.equal(isPlainTag(tag), false, tag);
    assert.equal((bgutilTarget(tag, OTHER, DEFAULTS) as { key?: string }).key, "BGUTIL_VERSION", tag);
  }
  assert.equal(isPlainTag(""), false);
  for (const tag of ["2.0.2", "v1.3.2", "release_1-rc.2"]) assert.equal(isPlainTag(tag), true, tag);
});

test("설정값의 짝: 커밋은 소문자로 읽고, 틀린 짝은 둘 다 기본 짝으로 돌며 설정값 문제로 남는다", () => {
  const none = loadConfig({}).config.bgutil;
  assert.deepEqual([none.version, none.commit, none.pinned], [BGUTIL_VERSION, BGUTIL_COMMIT, false]);
  const pinned = loadConfig({}, { tunables: { BGUTIL_VERSION: "2.0.3", BGUTIL_COMMIT: ` ${"A".repeat(40)} ` } });
  assert.deepEqual([pinned.config.bgutil.version, pinned.config.bgutil.commit, pinned.config.bgutil.pinned], ["2.0.3", "a".repeat(40), true]);
  const half = loadConfig({}, { tunables: { BGUTIL_VERSION: "2.0.3" } });
  assert.deepEqual([half.config.bgutil.version, half.config.bgutil.commit, half.config.bgutil.pinned], [BGUTIL_VERSION, BGUTIL_COMMIT, false]);
  const lines = half.tuneProblems.map(logRuleLine);
  assert.ok(
    lines.some((line) => line.startsWith("BGUTIL_COMMIT 값이 잘못됨")),
    lines.join("\n"),
  );
});

test("태그가 가리키는 커밋: 주석 태그는 벗긴 줄, 가벼운 태그는 태그 줄, 없으면 null", () => {
  const annotated = `${"c".repeat(40)}\trefs/tags/2.0.3\n${OTHER}\trefs/tags/2.0.3^{}\n`;
  assert.equal(taggedCommit(annotated, "2.0.3"), OTHER);
  assert.equal(taggedCommit(`${OTHER.toUpperCase()}\trefs/tags/2.0.3\r\n`, "2.0.3"), OTHER);
  assert.equal(taggedCommit(`${OTHER}\trefs/tags/2.0.30\n`, "2.0.3"), null, "이름이 같은 태그만");
  assert.equal(taggedCommit("", "2.0.3"), null);
});

test("설치 스크립트를 돌릴 의존성: 실행 의존성 가운데 설치 스크립트가 있는 것만, 중첩도 이름 하나로", () => {
  const lock = {
    packages: {
      "": { hasInstallScript: true },
      "node_modules/canvas": { hasInstallScript: true },
      "node_modules/@swc/core": { hasInstallScript: true, dev: true },
      "node_modules/fsevents": { hasInstallScript: true, devOptional: true },
      "node_modules/express": {},
      "node_modules/a/node_modules/canvas": { hasInstallScript: true },
      "node_modules/@scope/native": { hasInstallScript: true },
      "node_modules/linked": { hasInstallScript: true, link: true },
    },
  };
  assert.deepEqual(rebuildTargets(lock), ["@scope/native", "canvas"]);
  assert.deepEqual(rebuildTargets({}), []);
});

test("설치 스크립트를 돌릴 의존성: 이름이 npm 패키지 형식이 아니면 예외를 던진다(셸 명령줄에 들어간다)", () => {
  for (const key of ["node_modules/a;rm -rf", "node_modules/$(x)", "node_modules/A"]) {
    assert.throws(() => rebuildTargets({ packages: { [key]: { hasInstallScript: true } } }), /잘못된 형식의 패키지 이름이 있습니다/, key);
  }
});

test("설치 스크립트를 돌릴 의존성: 이름이 같은 개발 의존성에도 설치 스크립트가 있으면 예외를 던진다(npm rebuild는 이름으로 모두 고른다)", () => {
  const lock = { packages: { "node_modules/canvas": { hasInstallScript: true }, "node_modules/jest/node_modules/canvas": { hasInstallScript: true, dev: true } } };
  assert.throws(() => rebuildTargets(lock), /canvas/);
});

test("루트의 설치 수명 주기 스크립트를 찾는다(--ignore-scripts로 건너뛰므로 사람이 본다)", () => {
  assert.deepEqual(rootInstallScripts({ scripts: { lint: "eslint", format: "prettier" } }), []);
  assert.deepEqual(rootInstallScripts({}), []);
  assert.deepEqual(rootInstallScripts({ scripts: { postinstall: "node x", prepare: "tsc", lint: "eslint" } }), ["postinstall", "prepare"]);
});

test("기본값 파일의 BGUTIL_COMMIT 줄을 감시 스크립트가 고칠 수 있다", () => {
  const text = `const BGUTIL_VERSION = "2.0.2";\nconst BGUTIL_COMMIT = "${DEFAULTS.commit}";\n`;
  assert.equal(rewriteConstant(rewriteConstant(text, "BGUTIL_VERSION", "2.0.3"), "BGUTIL_COMMIT", OTHER), `const BGUTIL_VERSION = "2.0.3";\nconst BGUTIL_COMMIT = "${OTHER}";\n`);
});
