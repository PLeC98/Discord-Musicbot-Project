// 전체 백업. `pnpm run backup`(캐시 파일까지는 `pnpm run backup --with-audio`). .env · 설정 DB · 오디오 캐시 번들 · 파비콘 · 로그인 배경을 database/full-backups/ 의 ZIP 하나로(이전 것은 삭제한다).
// 봇이 켜져 있어도 된다. 옮길 때는 봇을 끈 채 그 ZIP 을 봇 폴더에 풀어 덮어쓰고 켠다(src/app/full-backup)

import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env 를 읽는다(없으면 만든다)
import { makeFullBackup } from "../src/app/full-backup.ts";

try {
  const made = await makeFullBackup({}, new Date(), { withAudio: process.argv.includes("--with-audio") });
  console.log(`전체 백업을 만들었습니다: ${made.file}`);
  console.log(`로그인 배경 ${made.backgrounds}개를 담았습니다(만드는 중인 배경은 담지 않습니다)`);
  if (made.audioFiles !== null) console.log(made.audioFiles ? `오디오 캐시: 캐시 파일 ${made.audioFiles}개와 자동 검색 결과 · 직접 지정한 음원을 담았습니다` : "오디오 캐시: 자동 검색 결과 · 직접 지정한 음원을 담았습니다(캐시 파일까지는 --with-audio)");
  if (made.replaced.length) console.log(`이전 백업을 삭제했습니다: ${made.replaced.join(", ")}`);
  if (!made.hasEnv) console.log("주의: .env 가 없어 담지 못했습니다. 옮긴 곳에서 .env 를 따로 맞춰야 합니다");
  console.log("");
  console.log("이 파일에는 봇 토큰과 SECRETS_KEY 가 평문으로 들어 있습니다. .env 처럼 다루고, 옮긴 뒤에는 삭제하세요.");
  console.log("옮기는 법: 옮길 봇 폴더에서 봇을 끄고, 이 ZIP 을 그 폴더에 풀어 덮어쓴 뒤 봇을 켭니다(설정 DB 는 시작할 때 교체하고, 오디오 캐시는 시작할 때 합칩니다).");
} catch (error) {
  console.error(`전체 백업을 만들지 못했습니다: ${(error as Error).message}`);
  process.exit(1);
}
