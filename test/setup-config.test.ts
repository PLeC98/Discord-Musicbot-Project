// src/config/env-file.ts(설치 · 진입 파일이 부른다) — .env 가 없으면 예시를 복사하고 무작위 비밀을 채운다. 있으면 손대지 않는다. 진입 파일은 그 뒤 읽는다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { setupEnv, loadEnv, fillLine } from "../src/config/env-file.ts";
import { loadConfig } from "../src/config/index.ts";
import { isSecretsKey } from "../src/rules/secrets-key.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-env-"));
const EXAMPLE = path.join(import.meta.dirname, "..", ".env.example");
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("없으면 만든다: 두 비밀은 채우고 사람이 채울 값은 비워 둔다. 같은 설정 검사를 지난다", () => {
  const target = path.join(dir, "fresh.env");
  assert.equal(setupEnv(target, EXAMPLE), true);
  const values = parseEnv(fs.readFileSync(target, "utf8"));
  assert.ok(isSecretsKey(values.SECRETS_KEY ?? ""));
  assert.ok((values.SESSION_SECRET ?? "").length >= 64);
  assert.equal(values.DISCORD_TOKEN, "");

  const { problems } = loadConfig({ ...values, DISCORD_TOKEN: "t", CLIENT_ID: "1", CLIENT_SECRET: "s" });
  assert.deepEqual(problems, []);
});

test("만들 때마다 다른 값이다", () => {
  const [a, b] = ["a.env", "b.env"].map((name) => {
    const target = path.join(dir, name);
    setupEnv(target, EXAMPLE);
    return parseEnv(fs.readFileSync(target, "utf8")).SECRETS_KEY;
  });
  assert.notEqual(a, b);
});

test("이미 있으면 손대지 않는다", () => {
  const target = path.join(dir, "kept.env");
  fs.writeFileSync(target, "DISCORD_TOKEN=mine\n");
  assert.equal(setupEnv(target, EXAMPLE), false);
  assert.equal(fs.readFileSync(target, "utf8"), "DISCORD_TOKEN=mine\n");
});

test("값을 넣어도 줄의 주석은 남는다. 값이 이미 있는 줄 · 다른 키는 그대로", () => {
  const text = "SECRETS_KEY=        # 설명\nOTHER=1\nSESSION_SECRET=keep\n";
  assert.equal(fillLine(text, "SECRETS_KEY", "abc"), "SECRETS_KEY=abc  # 설명\nOTHER=1\nSESSION_SECRET=keep\n");
  assert.equal(fillLine(text, "SESSION_SECRET", "new"), text);
});

// 진입 파일이 부트스트랩을 맨 먼저 부르는지는 test/architecture 가 본다
test("읽기: 파일의 값을 process.env 에 올리되 이미 있는 값(셸)은 덮지 않는다. 없으면 false", () => {
  const target = path.join(dir, "load.env");
  fs.writeFileSync(target, "B96_FROM_FILE=file\nB96_FROM_SHELL=file\n");
  process.env.B96_FROM_SHELL = "shell";
  try {
    assert.equal(loadEnv(target), true);
    assert.equal(process.env.B96_FROM_FILE, "file");
    assert.equal(process.env.B96_FROM_SHELL, "shell");
    assert.equal(loadEnv(path.join(dir, "missing.env")), false);
  } finally {
    delete process.env.B96_FROM_FILE;
    delete process.env.B96_FROM_SHELL;
  }
});
