/**
 * 설치 후(Postinstall) 스크립트: 번들로 제공되는 yt-dlp 바이너리를 최신 버전으로 업데이트합니다.
 * YouTube 추출 기능이 계속 작동하도록 `npm install` 후에 자동으로 실행됩니다.
 * YouTube는 API를 수시로 변경하므로, 오래된 버전의 yt-dlp를 사용하면 음악 검색이 작동하지 않을 수 있습니다.
 */
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const binDir = path.join(__dirname, "..", "node_modules", "youtube-dl-exec", "bin");
const binary = process.platform === "win32" ? path.join(binDir, "yt-dlp.exe") : path.join(binDir, "yt-dlp");

if (!fs.existsSync(binary)) {
  console.log("ℹ️  yt-dlp 바이너리를 아직 찾을 수 없어 업데이트를 건너뜁니다 (패키지 설치 후 실행됩니다).");
  process.exit(0);
}

console.log("🔄 yt-dlp를 최신 버전으로 업데이트 중...");
try {
  execFileSync(binary, ["-U"], { stdio: "inherit" });
} catch (e) {
  // 일부 플랫폼에서 업데이트가 적용되었을 때 yt-dlp가 종료 코드 1을 반환하는 것은 오류가 아님.
  if (e.status !== 1) {
    console.warn("⚠️  yt-dlp 업데이트를 건너뛰었습니다 (네트워크 문제 또는 이미 최신 상태임).");
  }
}
