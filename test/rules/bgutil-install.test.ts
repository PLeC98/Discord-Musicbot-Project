// src/rules/bgutil-install.ts: bgutil 설치가 받을 태그와 커밋, 잠금 파일에서 설치 스크립트를 돌릴 실행 의존성, 루트의 설치 스크립트

import test from "node:test";
import assert from "node:assert/strict";
import { bgutilPin, isCommitSha, isPlainTag, rebuildTargets, rootInstallScripts } from "../../src/rules/bgutil-install.ts";
import { BGUTIL_COMMIT, BGUTIL_VERSION } from "../../src/config/vendor-versions.ts";
import { loadConfig } from "../../src/config/index.ts";
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

test("받을 커밋: 기본 태그면 고정한 커밋, BGUTIL_COMMIT 을 주면 그 커밋", () => {
  assert.deepEqual(bgutilPin("2.0.2", "", DEFAULTS), { tag: "2.0.2", commit: DEFAULTS.commit });
  assert.deepEqual(bgutilPin("2.0.3", OTHER, DEFAULTS), { tag: "2.0.3", commit: OTHER });
  assert.deepEqual(bgutilPin("2.0.2", OTHER, DEFAULTS), { tag: "2.0.2", commit: OTHER }, "기본 태그에 다른 커밋을 주면 그 커밋으로 맞춰 본다(맞지 않으면 설치가 멈춘다)");
});

test("받을 커밋: 다른 태그에 커밋이 없거나, 커밋이나 태그 형식이 아니면 받지 않는다", () => {
  const missing = bgutilPin("2.0.3", "", DEFAULTS);
  assert.ok("error" in missing && missing.error.includes("BGUTIL_COMMIT") && missing.error.includes("2.0.2"), JSON.stringify(missing));
  for (const commit of ["26475e9", "g".repeat(40), `${OTHER} `]) assert.ok("error" in bgutilPin("2.0.3", commit, DEFAULTS), commit);
  for (const tag of ["", "-x", "a:refs/heads/main", "v*", "a..b", "a b"]) {
    assert.equal(isPlainTag(tag), false, tag);
    assert.ok("error" in bgutilPin(tag, OTHER, DEFAULTS), tag);
  }
  for (const tag of ["2.0.2", "v1.3.2", "release_1-rc.2"]) assert.equal(isPlainTag(tag), true, tag);
});

test(".env 의 BGUTIL_COMMIT 은 소문자로 읽고, 비면 빈 글자", () => {
  assert.equal(loadConfig({}).config.bgutil.commit, "");
  assert.equal(loadConfig({ BGUTIL_COMMIT: ` ${"A".repeat(40)} ` }).config.bgutil.commit, "a".repeat(40));
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

test("설치 스크립트를 돌릴 의존성: 이름이 npm 패키지 형식이 아니면 던진다(셸 명령줄에 들어간다)", () => {
  for (const key of ["node_modules/a;rm -rf", "node_modules/$(x)", "node_modules/A"]) {
    assert.throws(() => rebuildTargets({ packages: { [key]: { hasInstallScript: true } } }), /패키지 이름이 아닙니다/, key);
  }
});

test("설치 스크립트를 돌릴 의존성: 이름이 같은 개발 의존성에도 설치 스크립트가 있으면 던진다(npm rebuild 는 이름으로 모두 고른다)", () => {
  const lock = { packages: { "node_modules/canvas": { hasInstallScript: true }, "node_modules/jest/node_modules/canvas": { hasInstallScript: true, dev: true } } };
  assert.throws(() => rebuildTargets(lock), /canvas/);
});

test("루트의 설치 수명 주기 스크립트를 찾는다(--ignore-scripts 로 건너뛰므로 사람이 본다)", () => {
  assert.deepEqual(rootInstallScripts({ scripts: { lint: "eslint", format: "prettier" } }), []);
  assert.deepEqual(rootInstallScripts({}), []);
  assert.deepEqual(rootInstallScripts({ scripts: { postinstall: "node x", prepare: "tsc", lint: "eslint" } }), ["postinstall", "prepare"]);
});

test("기본값 파일의 BGUTIL_COMMIT 줄을 감시 스크립트가 고칠 수 있다", () => {
  const text = `const BGUTIL_VERSION = "2.0.2";\nconst BGUTIL_COMMIT = "${DEFAULTS.commit}";\n`;
  assert.equal(rewriteConstant(rewriteConstant(text, "BGUTIL_VERSION", "2.0.3"), "BGUTIL_COMMIT", OTHER), `const BGUTIL_VERSION = "2.0.3";\nconst BGUTIL_COMMIT = "${OTHER}";\n`);
});
