// 전체 백업. `pnpm run backup`(캐시 파일까지는 `pnpm run backup --with-audio`). .env, 설정 DB, 사용자 데이터 DB, 오디오 캐시 번들, 파비콘, 로그인 배경을 database/full-backups/의 ZIP 하나로(이전 것은 삭제한다).
// 봇이 켜져 있어도 된다. 옮길 때는 봇을 끈 채 그 ZIP을 봇 폴더에 풀어 덮어쓰고 켠다(src/app/full-backup)

import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env를 읽는다(없으면 만든다)
import { makeFullBackup } from "../src/app/full-backup.ts";
import { L } from "../src/infra/log/text.ts";
import { asText } from "../src/infra/log/log-text.ts";

try {
  const made = await makeFullBackup({}, new Date(), { withAudio: process.argv.includes("--with-audio") });
  console.log(asText(L.backup.made({ file: made.file })));
  console.log(asText(L.backup.backgroundsIncluded({ backgrounds: made.backgrounds })));
  if (made.users) console.log(asText(L.backup.usersIncluded()));
  if (made.audioFiles !== null) console.log(asText(made.audioFiles ? L.backup.audioIncluded({ audioFiles: made.audioFiles }) : L.backup.audioIndexOnly()));
  if (made.replaced.length) console.log(asText(L.backup.previousRemoved({ files: made.replaced.join(", ") })));
  if (made.left.length) console.log(asText(L.backup.previousLeft({ files: made.left.join(", ") })));
  if (!made.hasEnv) console.log(asText(L.backup.envMissing()));
  if (made.legacyParts.length) console.log(asText(L.backup.legacyPartsLeft({ files: made.legacyParts.join(", ") })));
  if (made.partLeft) console.warn(asText(L.backup.partLeft({ path: made.partLeft.path, code: made.partLeft.code })));
  if (made.tempLeft.length) console.log(asText(L.backup.tempLeft({ files: made.tempLeft.join(", ") })));
  console.log("");
  console.log(asText(L.backup.secretsWarning()));
  console.log(asText(L.backup.howToMove()));
} catch (error) {
  console.error(asText(L.backup.failed({ error: (error as Error).message })));
  process.exit(1);
}
