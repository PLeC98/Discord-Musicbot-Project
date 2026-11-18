// src/sources/bgutil/version.ts: 봇이 쓰는 bgutil 빌드와 설정한 버전을 비교해 기동 때 알리기만 한다

import { test } from "node:test";
import assert from "node:assert/strict";
import sink from "../../src/infra/log/sink.ts";
import { withConfig } from "../helpers/config.ts";
import { bgutilVersions, warnOffTarget } from "../../src/sources/bgutil/version.ts";
import type { BgutilBundle } from "../../src/sources/bgutil/bundle.ts";

const SHA = "a".repeat(40);
const built = (version: string, commit = SHA): BgutilBundle => ({ folder: `${version}-1790000000000`, root: "/fake", serverDir: "/fake/server", entry: "/fake/server/build/main.js", tag: version, commit, version });
const target = { version: "2.0.2", commit: SHA };

// 기동 확인이 남긴 줄(경고, 정보)
function warned(bundle: BgutilBundle | null) {
  const from = sink.buffer.length;
  warnOffTarget(bundle);
  return sink.buffer.slice(from).filter((e) => e.level === "warn" || e.level === "info");
}

test("설치와 설정이 같으면 아무것도 남기지 않고 상태만 싣는다", () =>
  withConfig({ bgutil: target }, () => {
    assert.deepEqual(warned(built("2.0.2")), []);
    assert.deepEqual(bgutilVersions(built("2.0.2")), { installed: "2.0.2", target: "2.0.2", same: true });
  }));

test("설치가 설정과 다르면(코드를 받고 다시 설치하지 않음) 무엇을 할지 warn 한 줄", () =>
  withConfig({ bgutil: target }, () => {
    const lines = warned(built("2.0.0"));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].level, "warn");
    assert.match(lines[0].text, /설치 2\.0\.0, 설정 2\.0\.2\. 대시보드 업데이트 탭의 bgutil 카드에서 받거나 pnpm run install:bgutil로 맞춘 뒤 봇을 다시 시작하세요/);
    assert.deepEqual(bgutilVersions(built("2.0.0")), { installed: "2.0.0", target: "2.0.2", same: false });
  }));

test("태그가 같고 커밋만 다르면 커밋을 붙여 알린다", () =>
  withConfig({ bgutil: target }, () => {
    const lines = warned(built("2.0.2", "b".repeat(40)));
    assert.match(lines[0]?.text ?? "", /설치 2\.0\.2\(bbbbbbb\), 설정 2\.0\.2\(aaaaaaa\)/);
    assert.equal(bgutilVersions(built("2.0.2", "b".repeat(40)))?.same, false);
  }));

test("설치돼 있지 않으면 남기지 않고 상태도 없다", () =>
  withConfig({ bgutil: target }, () => {
    assert.deepEqual(warned(null), []);
    assert.equal(bgutilVersions(null), null);
  }));
