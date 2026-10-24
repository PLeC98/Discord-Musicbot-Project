// 봇을 돌리는 사용자만 읽고 쓰게(POSIX 0600). 설정 DB · 세션 · 스냅샷처럼 비밀(암호문)이나 로그인이 든 파일.
// Windows 는 이 권한이 먹지 않는다. 사용자 프로필 · 봇 폴더의 권한에 기댄다(README)

import fs from "fs";

function ownerOnly(file: string) {
  if (process.platform === "win32") return;
  fs.chmodSync(file, 0o600);
}

export { ownerOnly };
