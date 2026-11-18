// src/config/tool-env.ts: 외부 도구에 넘기는 환경에 봇의 비밀값 환경 변수가 없고, 설정 모듈이 읽는 비밀값 이름이 목록에 다 들어 있다

import { test } from "node:test";
import assert from "node:assert/strict";
import { SECRET_ENV_NAMES, toolEnv } from "../../src/config/tool-env.ts";
import { loadConfig } from "../../src/config/index.ts";

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

test("넘긴 객체를 고치지 않는다", () => {
  const env = { PATH: "/bin", DISCORD_TOKEN: "t" };
  toolEnv(env, "linux");
  assert.deepEqual(env, { PATH: "/bin", DISCORD_TOKEN: "t" });
});
