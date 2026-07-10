const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");
const config = require("../config");

// 모든 명령 파일을 읽어 SlashCommandBuilder JSON 배열로 변환.
function loadCommandData() {
  const commands = [];
  const commandsPath = path.join(__dirname, "..", "commands");
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if ("data" in command && "execute" in command) {
      commands.push(command.data.toJSON());
      console.log(`✅ Loaded command: ${command.data.name}`);
    } else {
      console.log(`⚠️  Warning: ${file} is missing required "data" or "execute" property.`);
    }
  }
  return commands;
}

// 프로세스가 실행 시점에 가진 커맨드 집합(핸들러가 로드된 것과 동일). 이 배열을 그대로 등록한다.
const commands = loadCommandData();

// 슬래시 커맨드를 Discord에 (재)배포하는 재사용 함수
async function deployCommands() {
  const scope = config.discord.guildId ? "guild" : "global";
  try {
    const rest = new REST().setToken(config.discord.token);
    const route = config.discord.guildId ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId) : Routes.applicationCommands(config.discord.clientId);
    const data = await rest.put(route, { body: commands });
    return { ok: true, count: data.length, scope, guildId: config.discord.guildId || null, names: data.map((c) => c.name) };
  } catch (error) {
    return { ok: false, error, scope, guildId: config.discord.guildId || null };
  }
}

// 배포 실패 로그 라인
function deployErrorLines(result) {
  const lines = [`❌ 커맨드 배포 실패 (${result.scope}): ${result.error?.message || result.error}`];
  if (result.error?.code === 50001) {
    lines.push('   → 봇이 대상 길드에 없거나 "applications.commands" 스코프로 초대되지 않았습니다.');
    lines.push("   → .env의 GUILD_ID를 비우면 전역 배포로 전환됩니다.");
  }
  return lines;
}

module.exports = { commands, deployCommands, loadCommandData, deployErrorLines };
