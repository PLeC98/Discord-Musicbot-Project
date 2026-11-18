// src/config/tool-env.ts: 외부 도구에 넘기는 환경에 봇의 비밀값 환경 변수가 없고, 설정 모듈이 읽는 비밀값 이름이 목록에 다 들어 있다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SECRET_ENV_NAMES, toolEnv } from "../../src/config/tool-env.ts";
import { loadConfig } from "../../src/config/index.ts";
import { PROJECT } from "../../src/infra/project-paths.ts";

const SECRETS: readonly string[] = SECRET_ENV_NAMES;
// 이름은 비밀값처럼 보이지만 값은 비밀값이 아닌 것: 파일 경로, 쿠키 출처(브라우저 이름), 요청 수 제한
const NOT_SECRET = new Set(["DASHBOARD_TLS_KEY", "COOKIES_SOURCE", "RATE_LIMIT_AUTH_WINDOW_SEC", "RATE_LIMIT_AUTH_MAX"]);
const LOOKS_SECRET = /TOKEN|SECRET|PASS|COOKIE|KEY|AUTH|CRED/i;

test("설정 모듈이 읽는 이름 중 비밀값처럼 보이는 것은 비밀값 목록과 비밀값 아님 목록 중 한쪽에 있다", () => {
  const { envNames } = loadConfig({});
  const unsorted = [...envNames].filter((name) => LOOKS_SECRET.test(name) && !SECRETS.includes(name) && !NOT_SECRET.has(name));
  assert.deepEqual(unsorted, [], "새 이름이 비밀값이면 SECRET_ENV_NAMES에, 아니면 이 테스트의 NOT_SECRET에 추가한다");
});

test("비밀값 목록의 이름은 설정 모듈이 실제로 읽는다(옛 이름이 남지 않는다)", () => {
  const { envNames } = loadConfig({});
  assert.deepEqual(
    SECRETS.filter((name) => !envNames.has(name)),
    [],
  );
});

test("비밀값 환경 변수를 빼고 나머지(PATH, 프록시)는 그대로 둔다", () => {
  const env = { PATH: "/bin", HTTPS_PROXY: "http://proxy:3128", DISCORD_TOKEN: "t", CLIENT_SECRET: "c", SECRETS_KEY: "k", SESSION_SECRET: "s" };
  assert.deepEqual(toolEnv(env, "linux"), { PATH: "/bin", HTTPS_PROXY: "http://proxy:3128" });
});

test("Windows는 대소문자가 다른 비밀값 이름도 뺀다. 다른 OS는 다른 이름으로 본다", () => {
  const env = { Path: "C:\\Windows", discord_token: "t", Session_Secret: "s" };
  assert.deepEqual(toolEnv(env, "win32"), { Path: "C:\\Windows" });
  assert.deepEqual(toolEnv(env, "linux"), env);
});

// 자식 프로세스를 띄우는 봇 코드는 toolEnv()를 넘긴다. 예외는 OS 도구나 봇 자신을 띄우는 곳, 환경을 호출부에서 받는 곳뿐이다
const EXEMPT: Record<string, string> = {
  "src/app/launcher.ts": "봇 자신을 다시 실행한다",
  "src/infra/available-memory.ts": "OS 도구(vm_stat)",
  "src/infra/console-text.ts": "OS 도구(reg)",
  "src/infra/cpu-affinity.ts": "OS 도구(powershell)",
  "src/infra/kill-tree.ts": "OS 도구(taskkill)",
  "src/infra/leftover-children.ts": "OS 도구(taskkill)",
  "src/infra/process-memory.ts": "OS 도구(powershell, ps)",
  "src/infra/process-snapshot.ts": "OS 도구(powershell, ps)",
  "src/infra/system-upload.ts": "OS 도구(powershell)",
  "src/infra/script-job.ts": "환경을 호출부에서 받는다",
  "src/infra/tool-run.ts": "환경을 호출부에서 받는다",
  "src/sources/ytdlp-exec.ts": "환경을 호출부(ytdlp-spawn)에서 받는다",
};

test("자식 프로세스를 띄우는 봇 코드는 비밀값을 뺀 환경을 넘기거나 예외 목록에 있다", () => {
  const src = path.join(PROJECT.root, "src");
  const files = fs
    .readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `src/${f.split(path.sep).join("/")}`);
  const spawning = files.filter((f) => {
    const text = fs.readFileSync(path.join(PROJECT.root, f), "utf8");
    return /from "(node:)?child_process"/.test(text) && /\b(spawn|spawnSync|execFile|execFileSync|execSync|exec|fork)\(/.test(text);
  });
  assert.ok(spawning.length >= 10, `찾은 파일이 너무 적다(${spawning.length}개)`);
  const missing = spawning.filter((f) => !(f in EXEMPT) && !fs.readFileSync(path.join(PROJECT.root, f), "utf8").includes("toolEnv("));
  assert.deepEqual(missing, [], "외부 도구면 toolEnv()를 넘기고, OS 도구면 EXEMPT에 이유와 함께 추가한다");
  assert.deepEqual(
    Object.keys(EXEMPT).filter((f) => !spawning.includes(f)),
    [],
    "더는 프로세스를 띄우지 않는 파일은 예외 목록에서 뺀다",
  );
});

test("넘긴 객체를 고치지 않는다", () => {
  const env = { PATH: "/bin", DISCORD_TOKEN: "t" };
  toolEnv(env, "linux");
  assert.deepEqual(env, { PATH: "/bin", DISCORD_TOKEN: "t" });
});
