// 전체 백업. `pnpm run backup`. .env · 설정 DB · 파비콘을 database/full-backups/ 의 ZIP 하나로(이전 것은 지운다). 봇이 켜져 있어도 된다.
// 옮길 때는 봇을 끈 채 그 ZIP 을 봇 폴더에 풀어 덮어쓰고 켠다(src/app/full-backup)

import { makeFullBackup } from "../src/app/full-backup.ts";

try {
  const made = await makeFullBackup();
  console.log(`전체 백업을 만들었습니다: ${made.file}`);
  if (made.replaced.length) console.log(`이전 백업을 지웠습니다: ${made.replaced.join(", ")}`);
  if (!made.hasEnv) console.log("주의: .env 가 없어 담지 못했습니다. 옮긴 곳에서 .env 를 따로 맞춰야 합니다");
  console.log("");
  console.log("이 파일에는 봇 토큰과 SECRETS_KEY 가 평문으로 들어 있습니다. .env 처럼 다루고, 옮긴 뒤에는 지우세요.");
  console.log("옮기는 법: 옮길 봇 폴더에서 봇을 끄고, 이 ZIP 을 그 폴더에 풀어 덮어쓴 뒤 봇을 켭니다(설정 DB 는 켤 때 바꿔 끼웁니다).");
} catch (error) {
  console.error(`전체 백업을 만들지 못했습니다: ${(error as Error).message}`);
  process.exit(1);
}
