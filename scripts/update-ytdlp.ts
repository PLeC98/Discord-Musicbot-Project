/**
 * 설치 후(Postinstall) 스크립트: 번들로 제공되는 yt-dlp 바이너리를 최신 버전으로 업데이트합니다.
 * YouTube 추출 기능이 계속 작동하도록 `npm install` 후에 자동으로 실행됩니다.
 * YouTube는 API를 수시로 변경하므로, 오래된 버전의 yt-dlp를 사용하면 음악 검색이 작동하지 않을 수 있습니다.
 *
 * `yt-dlp -U` 는 올렸을 때도 이미 최신일 때도 0 으로 끝나고, 받기에 실패하면 100 으로 끝난다.
 * 그래서 종료 코드로는 실패만 가르고, 올렸는지는 앞뒤 판을 견줘 본다.
 */
import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";

const binDir = path.join(import.meta.dirname, "..", "node_modules", "youtube-dl-exec", "bin");
const BINARY = process.platform === "win32" ? path.join(binDir, "yt-dlp.exe") : path.join(binDir, "yt-dlp");

/** 바이너리를 한 번 부른 결과. stdout 은 --version 에서만 읽는다 */
type Run = (args: string[]) => { status: number | null; stdout?: string };

const realRun: Run = (args) => {
  const r = spawnSync(BINARY, args, { encoding: "utf8", windowsHide: true, stdio: args.includes("-U") ? "inherit" : "pipe" });
  return { status: r.status, stdout: r.stdout ?? "" };
};

/** 업데이트 결과를 한 줄로. 앞뒤 판(모르면 null)과 -U 의 종료 코드로 가른다 */
function describeUpdate(before: string | null, status: number | null, after: string | null): { level: "info" | "warn"; line: string } {
  if (status !== 0) return { level: "warn", line: `⚠️  yt-dlp 업데이트 실패(종료 코드 ${status ?? "없음"}). 지금 판${before ? `(${before})` : ""}으로 계속합니다.` };
  if (before && after && before !== after) return { level: "info", line: `✅ yt-dlp 를 올렸습니다: ${before} → ${after}` };
  if (before && after) return { level: "info", line: `✅ yt-dlp 가 이미 최신입니다(${after}).` };
  return { level: "info", line: "✅ yt-dlp 업데이트를 마쳤습니다(판을 읽지 못했습니다)." };
}

function updateYtDlp(run: Run = realRun) {
  const version = () => {
    const r = run(["--version"]);
    return r.status === 0 && r.stdout?.trim() ? r.stdout.trim() : null;
  };
  const before = version();
  const { status } = run(["-U"]);
  return describeUpdate(before, status, status === 0 ? version() : null);
}

if (import.meta.main) {
  if (!fs.existsSync(BINARY)) {
    console.log("ℹ️  yt-dlp 바이너리를 아직 찾을 수 없어 업데이트를 건너뜁니다 (패키지 설치 후 실행됩니다).");
  } else {
    console.log("🔄 yt-dlp를 최신 버전으로 업데이트 중...");
    const { level, line } = updateYtDlp();
    // 업데이트 실패로 설치 전체를 깨지 않는다. 지금 판으로도 돈다
    if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

export { describeUpdate, updateYtDlp };
