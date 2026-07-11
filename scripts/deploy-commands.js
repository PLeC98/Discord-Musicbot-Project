"use strict";

// 슬래시 커맨드를 Discord에 수동 (재)배포하는 독립 스크립트 — `pnpm run cmddeploy`.
// 봇 프로세스와 무관하게 실행되므로 봇 재시작 없이 언제든 커맨드 정의를 갱신한다.
// (게이트웨이/음성과 무관한 REST PUT이라 봇이 돌아가는 중에 실행해도 안전.)

const { deployCommands, commands, deployErrorLines } = require("../src/commandLoader");

(async () => {
  console.log(`\n🚀 ${commands.length}개 슬래시 커맨드 배포를 시작합니다...`);
  const r = await deployCommands({ force: true }); // 수동 스크립트 = 명시적 재배포 의도 — 지문 무시

  if (r.ok) {
    const where = r.scope === "guild" ? `길드 ${r.guildId}에` : "전역으로";
    console.log(`✅ ${r.count}개 커맨드를 ${where} 배포했습니다.`);
    console.log("   " + r.names.map((n) => `/${n}`).join(", "));
    if (r.scope === "global") console.log("ℹ️  전역 배포는 반영에 최대 1시간(보통 수분) 걸릴 수 있습니다.");
    process.exit(0);
  } else {
    deployErrorLines(r).forEach((line) => console.error(line));
    process.exit(1);
  }
})();
