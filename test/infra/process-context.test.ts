// src/infra/process-registry.ts · guild-context.ts · process-memory.ts — 자식 프로세스가 어느 서버의 무슨 일인지(실행한 문맥에서), 메모리

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { inGuild } from "../../src/infra/guild-context.ts";
import * as registry from "../../src/infra/process-registry.ts";
import { parsePs, parseTasklist, processMemory, _internals as memoryInternals } from "../../src/infra/process-memory.ts";

let releases: Array<() => void> = [];
afterEach(() => {
  for (const release of releases) release();
  releases = [];
});

let nextPid = 900_001;
/** 살아 있는 척하는 자식(시그널을 보내지 않는다) */
function child(spawnfile: string) {
  return { pid: nextPid++, exitCode: null, signalCode: null, spawnfile };
}
const register = (...args: Parameters<typeof registry.register>) => {
  releases.push(registry.register(...args));
  return args[0]!.pid!;
};
const row = (pid: number) => registry.list().find((one) => one.pid === pid);

test("실행한 문맥의 서버와 일을 적는다. 일을 주면 문맥보다 앞서고, 문맥 밖이면 둘 다 null", () => {
  const warm = inGuild("g1", () => register(child("C:\\bin\\yt-dlp.exe"), "yt-dlp"), "prefetch");
  const play = inGuild("g1", () => register(child("/usr/bin/ffmpeg"), "ffmpeg:playback", { job: "play" }), "prefetch");
  const helper = register(child(process.execPath), "bgutil", { job: "pot-server" });
  const loose = register(child("/usr/bin/ffmpeg"), "ffmpeg:probe");

  assert.deepEqual([row(warm)?.guildId, row(warm)?.job, row(warm)?.program], ["g1", "prefetch", "yt-dlp"]);
  assert.deepEqual([row(play)?.guildId, row(play)?.job, row(play)?.program], ["g1", "play", "ffmpeg"]);
  assert.deepEqual([row(helper)?.guildId, row(helper)?.job, row(helper)?.program], [null, "pot-server", "node"]);
  assert.deepEqual([row(loose)?.guildId, row(loose)?.job], [null, null]);
});

test("문맥은 await 뒤에도 잇는다", async () => {
  const pid = await inGuild("g2", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return register(child("ffmpeg"), "ffmpeg:download");
  });
  assert.equal(row(pid)?.guildId, "g2");
});

test("메모리: tasklist CSV(자릿점은 로캘마다) · ps 의 RSS 를 MB 로, 물은 pid 만", () => {
  const csv = ['"ffmpeg.exe","4120","Console","1","31,456 K"', '"yt-dlp.exe","4200","Console","1","104.857 K"', '"other.exe","999","Console","1","5,000 K"'].join("\r\n");
  assert.deepEqual(
    [...parseTasklist(csv, new Set([4120, 4200]))],
    [
      [4120, 31],
      [4200, 102],
    ],
  );
  assert.deepEqual([...parsePs("  4120 32212\n 4200  104857\n", new Set([4120]))], [[4120, 31]]);
});

test("메모리를 못 읽은 까닭: 상한을 넘겨 끊었는지, 종료 코드와 stderr(UTF-8 이 아니면 길이만), 실행조차 못 했는지", () => {
  const failed = (fields: object) => Object.assign(new Error("Command failed: tasklist /FO CSV /NH"), fields);
  assert.equal(memoryInternals.failure(failed({ killed: true, signal: "SIGTERM", code: null }), Buffer.alloc(0)), "30초를 넘겨 끊음(SIGTERM)");
  assert.equal(memoryInternals.failure(failed({ killed: false, code: 1 }), Buffer.from("ERROR: Invalid argument.\r\n")), "종료 코드 1 · ERROR: Invalid argument.");
  // 한국어 Windows 의 tasklist 가 cp949 로 쓴 "오류:"
  assert.equal(memoryInternals.failure(failed({ killed: false, code: 1 }), Buffer.from([0xbf, 0xc0, 0xb7, 0xf9, 0x3a])), "종료 코드 1 · UTF-8 이 아닌 5바이트(콘솔 코드 페이지)");
  assert.equal(memoryInternals.failure(failed({ killed: false, code: 1 }), Buffer.alloc(0)), "종료 코드 1");
  assert.equal(memoryInternals.failure(Object.assign(new Error("spawn tasklist ENOENT"), { code: "ENOENT" }), Buffer.alloc(0)), "spawn tasklist ENOENT");
});

test("메모리: 이 프로세스를 실제로 잰다", { timeout: 60_000 }, async (t) => {
  const started = Date.now();
  const memory = await processMemory([process.pid]);
  // 바쁜 기계에서는 tasklist 가 상한을 넘긴다. 그때는 못 잰 것이지 틀린 것이 아니다
  if (!memory?.has(process.pid) && Date.now() - started >= memoryInternals.TIMEOUT_MS) return t.skip("tasklist · ps 가 상한 안에 끝나지 않음");
  assert.ok((memory?.get(process.pid) ?? 0) > 10, `${memory?.get(process.pid)}MB`);
  assert.equal((await processMemory([]))?.size, 0);
});
