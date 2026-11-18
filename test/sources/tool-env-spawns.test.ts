// 봇이 실행하는 외부 도구(yt-dlp, POToken 서버, 작업 ffmpeg)에 봇의 비밀값 환경 변수가 넘어가지 않는다(src/config/tool-env)

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { SECRET_ENV_NAMES } from "../../src/config/tool-env.ts";
import run, { useExec, type Exec } from "../../src/sources/ytdlp-spawn.ts";
import { createPotServer } from "../../src/sources/youtube/pot-server.ts";
import { jobEnv } from "../../src/media/ffmpeg/job.ts";
import { withConfig } from "../helpers/config.ts";

// 테스트 동안만 비밀값 환경 변수에 값을 둔다
const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of SECRET_ENV_NAMES) {
    saved.set(name, process.env[name]);
    process.env[name] = `secret-${name}`;
  }
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  useExec(null);
});

const leaked = (env: NodeJS.ProcessEnv | undefined) => {
  assert.ok(env, "환경을 따로 넘긴다(넘기지 않으면 봇의 환경을 통째로 물려받는다)");
  return SECRET_ENV_NAMES.filter((name) => name in env);
};

test("yt-dlp", async () => {
  let env: NodeJS.ProcessEnv | undefined;
  useExec(((_url: string, _flags: unknown, options: { env?: NodeJS.ProcessEnv }) => {
    env = options.env;
    return Object.assign(Promise.resolve({ stdout: "{}", stderr: "" }), new EventEmitter());
  }) as unknown as Exec);
  await run("https://youtu.be/x", { dumpSingleJson: true }).catch(() => {});
  assert.deepEqual(leaked(env), []);
  assert.equal(env?.PATH ?? env?.Path, process.env.PATH, "PATH는 그대로");
});

test("POToken 서버", async () => {
  let env: NodeJS.ProcessEnv | undefined;
  const spawn = (_cmd: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    env = options.env;
    return Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
  };
  let port = 46001;
  const server = createPotServer({ spawn, exists: () => true, freePort: async () => port++, fetch: async () => ({ ok: false }) });
  await withConfig({ bgutil: { enabled: true } }, () => server.start());
  void server.stop();
  assert.deepEqual(leaked(env), []);
});

test("작업 ffmpeg", () => {
  assert.deepEqual(leaked(jobEnv("win32")), []);
  assert.deepEqual(leaked(jobEnv("linux")), []);
});
