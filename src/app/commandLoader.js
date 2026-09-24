import { REST, Routes } from "discord.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import moduleLoader from "./moduleLoader.js";
const { loadModules } = moduleLoader;
import config from "../../config.ts";

// 배포 지문 저장 파일. 정의 무변경 기동에서 등록 PUT을 생략하기 위함. database/는 gitignore.
// env 오버라이드는 테스트 시임 (임시 파일. 운영 지문 미접촉)
const HASH_PATH = process.env.DEPLOYED_COMMANDS_HASH_PATH || path.join(import.meta.dirname, "..", "..", "database", "deployed-commands.json");

// 명령 파일을 읽어 { file, command } 목록과 실패 목록으로 나눈다.
// 등록(index.js)과 배포 정의가 같은 결과를 쓴다. 두 곳이 따로 읽으면 서로 다른 집합이 될 수 있다.
async function loadCommandModules(dir = path.join(import.meta.dirname, "..", "..", "commands")) {
  const { modules, failures, missing } = await loadModules(dir);

  const commands = [];
  for (const { file, module } of modules) {
    if ("data" in module && "execute" in module) commands.push({ file, command: module });
    else failures.push({ file, error: new Error("슬래시 명령 형식이 아닙니다 (data·execute 없음)") });
  }
  return { commands, failures, missing };
}

// 명령 파일은 불러오는 순간이 아니라 처음 필요할 때 한 번 읽는다. 등록과 배포가 같은 결과를 쓴다
let loading = null;
const loadedCommands = () => (loading ??= loadCommandModules());

/** 배포용 JSON. 핸들러로 등록되는 것과 같은 집합이다 */
async function definitions() {
  const { commands } = await loadedCommands();
  return commands.map(({ command }) => command.data.toJSON());
}

// 현재 명령어 세트 + 배포 대상의 지문. 어느 하나라도 바뀌면 재배포 대상
function deployFingerprint(scope, guildId, commands) {
  const src = JSON.stringify({ clientId: config.discord.clientId, scope, guildId, commands });
  return crypto.createHash("sha256").update(src).digest("hex");
}

function readDeployedFingerprint(hashPath) {
  try {
    return JSON.parse(fs.readFileSync(hashPath, "utf8")).fingerprint || null;
  } catch {
    return null; // 파일 없음/손상 → 재배포 (안전한 쪽)
  }
}

function writeDeployedFingerprint(hashPath, fingerprint) {
  try {
    fs.mkdirSync(path.dirname(hashPath), { recursive: true });
    fs.writeFileSync(hashPath, JSON.stringify({ fingerprint, deployedAt: new Date().toISOString() }));
  } catch {
    /* 지문 저장 실패는 다음 기동에서 한 번 더 배포될 뿐. 무해 */
  }
}

// 슬래시 명령어를 Discord에 (재)배포하는 재사용 함수.
// 기동 경로는 정의 무변경이면 PUT 생략(지문 비교), 대시보드 재배포·수동 스크립트는 force로 항상 PUT.
// hashPath는 테스트 시임 (임시 파일. 운영 지문 미접촉).
async function deployCommands({ force = false, hashPath = HASH_PATH } = {}) {
  const scope = config.discord.guildId ? "guild" : "global";
  const guildId = config.discord.guildId || null;
  const commands = await definitions();
  const fingerprint = deployFingerprint(scope, guildId, commands);

  if (!force && readDeployedFingerprint(hashPath) === fingerprint) {
    return { ok: true, skipped: true, count: commands.length, scope, guildId, names: commands.map((c) => c.name) };
  }

  try {
    const rest = new REST().setToken(config.discord.token);
    const route = guildId ? Routes.applicationGuildCommands(config.discord.clientId, guildId) : Routes.applicationCommands(config.discord.clientId);
    const data = await rest.put(route, { body: commands });
    writeDeployedFingerprint(hashPath, fingerprint); // 성공 시에만 기록. 실패하면 다음 기동에 재시도
    return { ok: true, skipped: false, count: data.length, scope, guildId, names: data.map((c) => c.name) };
  } catch (error) {
    return { ok: false, error, scope, guildId };
  }
}

// 배포 실패 로그 라인
function deployErrorLines(result) {
  const lines = [`❌ 명령어 배포 실패 (${result.scope}): ${result.error?.message || result.error}`];
  if (result.error?.code === 50001) {
    lines.push('   → 봇이 대상 서버에 없거나 "applications.commands" 스코프로 초대되지 않았습니다.');
    lines.push("   → .env의 GUILD_ID를 비우면 전역 배포로 전환됩니다.");
  }
  return lines;
}

const exported = { loadedCommands, definitions, deployCommands, loadCommandModules, deployErrorLines };
export default exported;
export { exported as "module.exports" };
