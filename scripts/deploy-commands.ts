// 슬래시 커맨드를 Discord에 수동 (재)배포하는 독립 스크립트. `pnpm commands`.
// 게이트웨이, 음성과 무관한 REST PUT이라 봇이 돌아가는 중에 실행해도 되고, 봇 재시작 없이 커맨드 정의가 갱신된다.

import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env를 읽는다(없으면 만든다)
import * as configCheck from "../src/app/config-check.ts";
import * as loadedConfig from "../src/config/index.ts"; // 설정 값과 함께 문제, 경고 목록

configCheck.stopOnConfigProblems(loadedConfig, console);

// 어떤 명령을 올릴지는 운영 설정값(SponsorBlock 켜기 등)이 정하고, 그 값은 settings.db에 있다. 봇이 켜져 있어도 건드리지 않게 읽기 전용으로 본다
const tunables = await import("../src/store/tunables.ts");
const { PROJECT } = await import("../src/infra/project-paths.ts");
const path = await import("node:path");
tunables.loadReadOnly(path.join(PROJECT.database, "settings.db"));

// 명령 목록은 설정 검사를 지난 뒤에 불러온다(src/index.ts가 본체를 부르는 순서와 같다)
const { deployCommands, definitions, deployErrorLines } = await import("../src/app/command-loader.ts");
const { loadApp, readApp } = await import("../src/app/app-info.ts");
const { messageOf } = await import("../src/rules/error-kind.ts");
const commands = definitions();
const { scriptLine } = await import("../src/infra/script-line.ts");
const say = scriptLine("commands");
// 배포 경로의 앱 ID는 봇 토큰으로 읽는다(기동과 같다)
const app = await loadApp(() => readApp(loadedConfig.default.discord.token)).catch((error: unknown) => {
  say("error", `디스코드 앱 설정 불러오기 실패: ${messageOf(error)}`);
  process.exit(1);
});
say("info", `슬래시 명령어 ${commands.length}개 배포 시작(앱 ${String(app.id)})`);
const r = await deployCommands({ force: true }); // 수동 실행은 명시적 재배포라 해시가 같아도 올린다

if (r.ok) {
  const where = r.scope === "guild" ? `서버 ${r.guildId ?? "없음"}` : "전역";
  say("info", `명령어 ${r.count}개 배포 완료(${where}): ${r.names.map((n) => `/${n}`).join(", ")}`);
} else {
  deployErrorLines(r).forEach((line) => say("error", line));
  process.exitCode = 1;
}
