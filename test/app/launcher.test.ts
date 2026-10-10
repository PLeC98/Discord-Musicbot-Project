// src/app/launcher.ts — 실행기. 다시 시작 코드일 때만 다시 띄우고, 신호는 넘기고 기다린다(바깥 감시 pm2 · systemd · 도커와 겹쳐도 어긋나지 않게).

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { launch, type LauncherDeps } from "../../src/app/launcher.ts";
import { EXIT, LAUNCHER_ENV } from "../../src/app/exit-codes.ts";
import { fakeWith } from "../helpers/fake.ts";

function setup(platform: NodeJS.Platform = "linux") {
  const children: Array<EventEmitter & { killed: string[]; env: NodeJS.ProcessEnv | undefined }> = [];
  const exits: number[] = [];
  const said: string[] = [];
  const proc = fakeWith<LauncherDeps["proc"]>()(Object.assign(new EventEmitter(), { platform, execPath: "node", execArgv: [], env: { KEEP: "1" } }));
  const spawn: LauncherDeps["spawn"] = (_command, args, options) => {
    assert.deepEqual(args, ["bot.ts"]);
    const child = Object.assign(new EventEmitter(), {
      killed: [] as string[],
      env: options.env,
      kill: (signal?: NodeJS.Signals | number) => {
        child.killed.push(String(signal));
        return true;
      },
    });
    children.push(child);
    return fakeWith<ReturnType<LauncherDeps["spawn"]>>()(child);
  };
  launch("bot.ts", { spawn, proc, exit: (code) => void exits.push(code), say: (line) => void said.push(line) });
  return { children, exits, said, proc };
}

test("봇에 실행기 표시를 넘겨 띄우고, 다시 시작 코드로 끝나면 다시 띄운다", () => {
  const { children, exits } = setup();
  assert.equal(children.length, 1);
  assert.deepEqual([children[0].env?.[LAUNCHER_ENV], children[0].env?.KEEP], ["1", "1"], "환경은 물려주고 표시를 더한다");
  children[0].emit("exit", EXIT.restart, null);
  assert.equal(children.length, 2);
  assert.deepEqual(exits, []);
});

// 크래시 · 기동 실패는 바깥 감시가 정한 대로(다시 띄우기 · 간격 · 횟수 한도). 실행기가 몰래 되살리지 않는다
test("다른 코드로 끝나면 같은 코드로 끝난다. 신호로 끝났으면 128 + 번호", () => {
  for (const code of [EXIT.stopped, EXIT.globalFlood, EXIT.transient, EXIT.badSetup, 1]) {
    const { children, exits } = setup();
    children[0].emit("exit", code, null);
    assert.deepEqual([children.length, exits], [1, [code]]);
  }
  const { children, exits } = setup();
  children[0].emit("exit", null, "SIGKILL");
  assert.deepEqual(exits, [137]);
});

test("받은 신호는 봇에 넘기고, 그 뒤에는 다시 시작 코드여도 다시 띄우지 않는다", () => {
  const { children, exits, proc } = setup();
  proc.emit("SIGTERM");
  assert.deepEqual(children[0].killed, ["SIGTERM"]);
  assert.deepEqual(exits, [], "봇이 끝날 때까지 기다린다");
  children[0].emit("exit", EXIT.restart, null);
  assert.deepEqual([children.length, exits], [1, [EXIT.restart]]);
});

// Windows 의 Ctrl+C 는 같은 콘솔의 봇에도 바로 가고, kill 은 신호가 아니라 강제 종료다
test("Windows 에서는 신호를 넘기지 않고 봇이 끝나기를 기다린다", () => {
  const { children, exits, proc } = setup("win32");
  proc.emit("SIGINT");
  assert.deepEqual(children[0].killed, []);
  children[0].emit("exit", EXIT.stopped, null);
  assert.deepEqual(exits, [EXIT.stopped]);
});

test("봇을 띄우지 못하면 알리고 1 로 끝난다", () => {
  const { children, exits, said } = setup();
  children[0].emit("error", new Error("ENOENT"));
  assert.deepEqual(exits, [1]);
  assert.match(said.join("\n"), /ENOENT/);
});
