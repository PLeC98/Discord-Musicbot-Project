// src/sources/ytdlp-spawn.ts: 실제 yt-dlp 바이너리(ytdlpBinary.path(), 지금 버전)로 부르는 계약. 네트워크 없이 --version 과 모르는 플래그만 쓴다.
// 연령 제한, 삭제 영상 판별(youtube/errors)이 error.stderr 와 message 를 읽으므로 실패 모양을 지킨다. 실행한 yt-dlp 는 레지스트리가 추적하고 끝나면 놓는다.
// 검사용 인자는 url 이 아니라 flags 로 넘긴다(url 은 -- 뒤에 붙어 yt-dlp 가 글자 그대로의 URL 로 읽는다).
// 바이너리가 없으면 로컬은 건너뛰고, CI 에서는 실패한다(설치가 깨졌다는 뜻이다).

import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import run from "../../src/sources/ytdlp-spawn.ts";
import type { YtDlpFlags, YtDlpError } from "../../src/sources/ytdlp-spawn.ts";
import * as registry from "../../src/infra/process-registry.ts";
import { ytdlpBinary } from "../../src/sources/ytdlp-binary.ts";

const BINARY = ytdlpBinary.path();
const hasBinary = BINARY !== null && fs.existsSync(BINARY);
if (!hasBinary && process.env.CI) throw new Error(`yt-dlp 가 설치되지 않음(CI 의 postinstall 이 설치해야 한다): ${BINARY ?? "기록 없음"}`);
const opts = { skip: hasBinary ? false : `yt-dlp 바이너리 없음 (${BINARY ?? "기록 없음"})` };

test("성공 계약: 버전 문자열을 돌려주고 프로세스 등록을 해제한다", opts, async () => {
  const before = registry.size();
  const version = await run("", { version: true });
  assert.match(String(version), /^[0-9]{4}[.][0-9]{2}[.][0-9]{2}/, "yt-dlp 버전 문자열");
  assert.equal(registry.size(), before, "정상 종료 후 레지스트리에 남으면 안 된다(누수)");
});

test("실패 계약: stderr를 담은 Error. 연령제한/삭제영상 판별이 이걸 읽는다", opts, async () => {
  const before = registry.size();
  // 모르는 플래그를 넘겨 본다
  const failed = await run("", { definitelyBogusFlag: true } as YtDlpFlags).then(
    () => null,
    (e: YtDlpError) => e,
  );
  assert.ok(failed instanceof Error, "실패는 Error로 던져야 한다");
  assert.match(failed.stderr ?? "", /no such option: --definitely-bogus-flag/i, "stderr가 실려 있어야 한다");
  assert.equal(failed.message, failed.stderr, "message = stderr");
  assert.equal(failed.exitCode, 2);
  assert.equal(registry.size(), before, "실패해도 레지스트리에 남으면 안 된다(누수)");
});

test("실행 중에는 레지스트리가 프로세스를 추적한다", opts, async () => {
  const before = registry.size();
  const pending = run("", { version: true });
  // 줄에서 자리를 잡은 뒤에 띄운다
  await new Promise((done) => setImmediate(done));
  assert.equal(registry.size(), before + 1, "실행 중에는 추적되어야 종료 시 정리할 수 있다");
  await pending.catch(() => {});
  assert.equal(registry.size(), before);
});
