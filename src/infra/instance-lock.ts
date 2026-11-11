// 폴더(database)마다 실행 하나. 같은 폴더에서 봇이 둘 뜨면 DB, 토큰, 자식 기록을 함께 써 서로 덮어쓰고 같은 명령에 두 번 답한다.
// 로컬 소켓을 쥐어 막는다: Windows는 이름 있는 파이프, Linux는 추상 소켓, 그 밖은 임시 폴더의 유닉스 소켓.
// 프로세스가 어떻게 끝나든 OS가 쥔 것을 놓는다(유닉스 소켓만 파일이 남아, 붙어 보고 아무도 받지 않으면 삭제하고 다시 쥔다).

import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

type Held = { ok: true; release(): Promise<void> } | { ok: false; holder: number | null };

/** 이 폴더의 잠금 이름. 같은 폴더면 같은 이름이다(Windows는 대소문자를 가리지 않는다) */
function lockNameFor(dir: string, platform: NodeJS.Platform = process.platform) {
  const full = path.resolve(dir);
  const hash = crypto
    .createHash("sha256")
    .update(platform === "win32" ? full.toLowerCase() : full)
    .digest("hex")
    .slice(0, 16);
  if (platform === "win32") return `\\\\.\\pipe\\musicbot-${hash}`;
  if (platform === "linux") return `\0musicbot-${hash}`;
  return path.join(os.tmpdir(), `musicbot-${hash}.sock`);
}

function listen(name: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    // 붙는 쪽에 쥔 프로세스의 pid를 주고 닫는다. 그 밖의 일은 하지 않는다
    const server = net.createServer((socket) => socket.end(String(process.pid)));
    server.once("error", reject);
    server.listen(name, () => {
      server.removeListener("error", reject);
      // 잠금 때문에 프로세스가 끝나지 않는 일이 없게
      server.unref();
      resolve(server);
    });
  });
}

/** 쥔 실행에 붙어 그 pid를 받아 온다. 아무도 받지 않으면 null */
function holderOf(name: string): Promise<number | null> {
  return new Promise((resolve) => {
    let text = "";
    const socket = net.connect(name);
    socket.setTimeout(2000, () => socket.destroy());
    socket.on("data", (chunk) => (text += String(chunk)));
    // 연결하지 못하면 잡은 프로세스가 없다는 뜻이다. 남은 소켓 파일은 acquireInstanceLock이 삭제하고 다시 잡는다
    socket.on("error", () => resolve(null));
    socket.on("close", () => resolve(/^\d+$/.test(text) ? Number(text) : null));
  });
}

/**
 * 이 폴더의 잠금을 쥔다. 다른 실행이 쥐고 있으면 ok: false와 그 pid(알 수 있으면).
 * 쥔 잠금은 프로세스가 끝날 때 OS가 놓는다. release는 테스트, 정상 종료가 먼저 놓을 때
 */
async function acquireInstanceLock(dir: string): Promise<Held> {
  const name = lockNameFor(dir);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const server = await listen(name);
      return { ok: true, release: () => new Promise((done) => server.close(() => done())) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      const holder = await holderOf(name);
      if (holder !== null) return { ok: false, holder };
      // 유닉스 소켓 파일만 남았다(쥔 실행이 끝났다). 삭제하고 한 번 더
      if (attempt === 0 && !name.startsWith("\\\\") && !name.startsWith("\0")) fs.rmSync(name, { force: true });
      else return { ok: false, holder: null };
    }
  }
  return { ok: false, holder: null };
}

export { acquireInstanceLock, lockNameFor };
