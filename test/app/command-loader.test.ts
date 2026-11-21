// src/app/command-loader.ts: 커맨드 로드 + 배포(등록 요청은 가짜를 넘겨 실제로 배포하지 않는다).
// 배포 해시는 임시 파일에 써서 운영 database/deployed-commands.json을 건드리지 않는다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { RESTPostAPIApplicationCommandsJSONBody, RESTPutAPIApplicationCommandsResult } from "discord.js";
import type { GetCommands, PutCommands } from "../../src/app/command-loader.ts";
import { codeOf } from "../../src/rules/error-kind.ts";
import { fake } from "../helpers/fake.ts";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-cmdhash-"));
let hashSeq = 0;
const freshHashPath = () => path.join(tmpDir, `hash-${hashSeq++}.json`);
after(() => fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 }));

// 등록 요청 가짜. 보낸 정의의 이름을 등록한 것으로 돌려준다
const echo: PutCommands = async (_route, body) => fake<RESTPutAPIApplicationCommandsResult>(body.map((c) => ({ name: c.name, id: `id-${c.name}` })));
// 등록된 목록 읽기 가짜(등록을 건너뛴 기동). getImpl을 바꿔 실패를 낸다
let getImpl: GetCommands = async () => definitions().map((c) => ({ name: c.name, id: `got-${c.name}` }));
let getCalls = 0;
const get: GetCommands = (route) => {
  getCalls++;
  return getImpl(route);
};
let putImpl: PutCommands = echo;
let putCalls: Array<{ route: string; body: RESTPostAPIApplicationCommandsJSONBody[] }> = [];
const put: PutCommands = (route, body) => {
  putCalls.push({ route, body });
  return putImpl(route, body);
};

const { enabledCommands, followEnabledCommands, definitions, deployCommands, deployErrorLines } = await import("../../src/app/command-loader.ts");
const { tunablesChanged } = await import("../../src/config/tunables-changed.ts");
const { COMMANDS } = await import("../../src/discord/commands/index.ts");
const commands: RESTPostAPIApplicationCommandsJSONBody[] = definitions();
const config = (await import("../../src/config/index.ts")).default;
// 배포 경로의 앱 ID. 기동은 봇 토큰으로 읽어 넣는다(app/app-info)
(await import("../../src/infra/app-id.ts")).useAppId("123456789012345678");

test("봇 전체에서 SponsorBlock을 껐으면 /highlight를 등록하지도 실행 목록에 올리지도 않는다. /setting은 늘 있다(그리는 화면에서 그 부분이 빠진다)", async () => {
  const { withConfig } = await import("../helpers/config.ts");
  const names = () => definitions().map((c) => c.name);
  assert.deepEqual(
    withConfig({ sponsorblock: { enabled: false } }, () => enabledCommands().map((c) => c.name)),
    withConfig({ sponsorblock: { enabled: false } }, names),
    "배포하는 것과 실행 목록이 같은 집합",
  );
  assert.ok(withConfig({ sponsorblock: { enabled: true } }, names).includes("highlight"));
  const off = withConfig({ sponsorblock: { enabled: false } }, names);
  assert.ok(!off.includes("highlight") && off.includes("setting"));
  assert.equal(off.length, withConfig({ sponsorblock: { enabled: true } }, names).length - 1, "다른 명령은 그대로");
});

test("운영 설정값을 저장해 켜진 명령이 바뀌면 실행 목록을 다시 만들고 등록을 맞춘다. 바뀌지 않은 저장에는 아무것도 하지 않는다", async () => {
  const { withConfig } = await import("../helpers/config.ts");
  const calls: string[] = [];
  const off = withConfig({ sponsorblock: { enabled: true } }, () =>
    followEnabledCommands(
      () => calls.push("load"),
      () => calls.push("deploy"),
    ),
  );
  try {
    withConfig({ sponsorblock: { enabled: true } }, () => tunablesChanged());
    assert.deepEqual(calls, [], "켜진 명령이 그대로다");
    withConfig({ sponsorblock: { enabled: false } }, () => tunablesChanged());
    assert.deepEqual(calls, ["load", "deploy"], "SponsorBlock을 껐다");
    withConfig({ sponsorblock: { enabled: false } }, () => tunablesChanged());
    assert.deepEqual(calls, ["load", "deploy"]);
    withConfig({ sponsorblock: { enabled: true } }, () => tunablesChanged());
    assert.deepEqual(calls, ["load", "deploy", "load", "deploy"], "다시 켰다");
  } finally {
    off();
  }
});

test("이름이 같아도 배포할 정의의 문구가 바뀌면(봇 기본 언어를 바꿨을 때) 다시 등록한다", () => {
  const calls: string[] = [];
  let text = "한 언어";
  const off = followEnabledCommands(
    () => calls.push("load"),
    () => calls.push("deploy"),
    () => [{ name: "play", description: text }],
  );
  try {
    tunablesChanged();
    assert.deepEqual(calls, []);
    text = "다른 언어";
    tunablesChanged();
    assert.deepEqual(calls, ["load", "deploy"]);
  } finally {
    off();
  }
});

test("명령 목록의 명령 전부가 유효한 정의(name/description)다", () => {
  assert.ok(commands.length > 0);
  for (const c of commands) {
    assert.equal(typeof c.name, "string");
    assert.ok(c.name.length > 0);
    assert.equal(typeof ("description" in c ? c.description : undefined), "string");
  }
});

test("배포용 정의는 켜진 명령이다(언어가 하나뿐이면 /language는 꺼진다)", () => {
  assert.deepEqual(
    commands.map((c) => c.name),
    COMMANDS.filter((c) => c.enabled?.() ?? true).map((c) => c.name),
  );
  assert.ok(!commands.some((c) => c.name === "language"));
});

test("커맨드 이름 중복 없음 (중복은 Discord 등록 시 덮어씀)", () => {
  const names = commands.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, `중복: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
});

test("deployCommands: 성공 경로. 현재 로드된 세트 전체를 1회 PUT", async () => {
  putCalls = [];
  const result = await deployCommands({ hashPath: freshHashPath(), put, get });

  assert.ok(result.ok);
  assert.equal(result.skipped, false);
  assert.equal(result.count, commands.length);
  assert.deepEqual(result.names.sort(), commands.map((c) => c.name).sort());
  assert.equal(result.scope, config.discord.guildId ? "guild" : "global", "GUILD_ID 유무로 스코프 자동 선택");
  assert.equal(putCalls.length, 1);
  assert.deepEqual(putCalls[0].body, commands, "로드된 정의를 그대로 등록");
});

test("deployCommands: 정의 변경 없는 재기동은 PUT 생략, force는 항상 PUT", async () => {
  const hashPath = freshHashPath();
  putCalls = [];

  await deployCommands({ hashPath, put, get }); // 첫 배포: 해시 기록
  const second = await deployCommands({ hashPath, put, get }); // 변경 없는 재기동
  assert.ok(second.ok);
  assert.equal(second.skipped, true);
  assert.equal(second.count, commands.length, "생략이어도 카운트/이름은 보고");
  assert.equal(putCalls.length, 1, "두 번째는 PUT 없음");

  const forced = await deployCommands({ hashPath, force: true, put, get }); // 대시보드 버튼/수동 스크립트
  assert.ok(forced.ok);
  assert.equal(forced.skipped, false);
  assert.equal(putCalls.length, 2, "force는 지문이 같아도 PUT");
});

test("deployCommands: 실패 시 예외를 던지지 않고 {ok:false, error} 반환 + 지문 미기록(다음 기동 재시도)", async () => {
  const hashPath = freshHashPath();
  putImpl = async () => {
    throw Object.assign(new Error("Missing Access"), { code: 50001 });
  };
  const result = await deployCommands({ hashPath, put, get });
  putImpl = echo;

  assert.ok(!result.ok);
  assert.equal(codeOf(result.error), 50001);
  assert.ok(["guild", "global"].includes(result.scope));

  putCalls = [];
  const retry = await deployCommands({ hashPath, put, get });
  assert.ok(retry.ok);
  assert.equal(retry.skipped, false, "실패는 배포된 것으로 기록되지 않음");
  assert.equal(putCalls.length, 1);
});

test("deployCommands: 등록한 명령의 id로 멘션을 만든다. 등록을 건너뛴 기동은 등록된 목록을 읽어 오고, 못 읽으면 글자로 남긴다", async () => {
  const { commandMention } = await import("../../src/ui/command-mentions.ts");
  const hashPath = freshHashPath();
  getCalls = 0;
  await deployCommands({ hashPath, put, get });
  assert.equal(commandMention("play"), "</play:id-play>");
  assert.equal(getCalls, 0, "등록했으면 읽지 않는다");

  await deployCommands({ hashPath, put, get });
  assert.equal(getCalls, 1);
  assert.equal(commandMention("play"), "</play:got-play>");

  getImpl = async () => {
    throw new Error("network down");
  };
  const result = await deployCommands({ hashPath, put, get });
  getImpl = async () => definitions().map((c) => ({ name: c.name, id: `got-${c.name}` }));
  assert.ok(result.ok && result.skipped, "읽기 실패는 등록 결과를 바꾸지 않는다");
  assert.equal(commandMention("없는명령"), "`/없는명령`");
});

test("배포 실패의 원인 안내: 서버 배포의 50001은 GUILD_ID, 그 외(전역 50001, 50035, 앱 오류)는 붙이지 않는다", async () => {
  const { withConfig } = await import("../helpers/config.ts");
  const failWith = (code: number) => deployCommands({ hashPath: freshHashPath(), force: true, put: async () => Promise.reject(Object.assign(new Error(`거절 ${code}`), { code })), get });
  const hintOf = async (code: number, guildId: string | null) => {
    const r = await withConfig({ discord: { guildId } }, () => failWith(code));
    assert.ok(!r.ok);
    return r.hint;
  };
  assert.equal(await hintOf(50001, "112233445566778899"), "GUILD_ID 서버(112233445566778899)에 봇이 없음. .env의 GUILD_ID가 맞는지, 봇이 서버에서 나가지 않았는지 확인하세요");
  assert.equal(await hintOf(20012, null), null, "앱 ID는 토큰에서 읽어 틀릴 수 없다");
  assert.equal(await hintOf(50001, null), null, "전역 50001은 원인을 짐작할 근거가 없다");
  assert.equal(await hintOf(50035, "112233445566778899"), null, "형식 검사를 지난 뒤의 50035는 명령 정의 쪽이다");

  assert.deepEqual(deployErrorLines({ scope: "guild", error: new Error("Missing Access"), hint: "안내" }), ["명령어 배포 실패(guild): Missing Access", "안내"]);
  assert.deepEqual(deployErrorLines({ scope: "global", error: new Error("boom"), hint: null }), ["명령어 배포 실패(global): boom"]);
});
