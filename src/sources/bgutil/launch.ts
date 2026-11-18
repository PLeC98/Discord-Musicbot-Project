// bgutil POToken 서버를 띄우는 방법과 준비 확인. 봇의 POToken 서버(sources/youtube/pot-server)와 설치의 띄워 보기(sources/bgutil/trial)가 같이 쓴다.
// 로거를 불러오지 않는다: 설치 스크립트도 이 모듈을 쓰는데, 로거를 불러오면 console.*를 가로챈다

import net from "node:net";
import path from "node:path";

/** 서버는 127.0.0.1 하나에만 연다(정하지 않으면 ::1과 127.0.0.1에 따로 열고 하나만 열려도 돈다) */
const HOST = "127.0.0.1";
/** 체크아웃의 server 폴더 안에서 실행할 파일 */
const ENTRY = path.join("build", "main.js");
// 서버보다 먼저 싣는 코드: 띄운 쪽이 열어 둔 표준 입력이 닫히면(어떻게 끝나든 OS가 닫는다) 서버도 끝난다. bgutil은 고치지 않는다
const EXIT_WITH_PARENT = "data:text/javascript,process.stdin.on('end',()=>process.exit(0));process.stdin.on('error',()=>process.exit(0));process.stdin.resume();";

/** node에 넘길 인자(cwd는 server 폴더) */
const serverArgs = (port: number) => ["--import", EXIT_WITH_PARENT, "build/main.js", "-p", String(port), "-H", HOST];

/** OS가 준 빈 포트. 열었다 곧바로 닫으므로 서버가 열기 전에 남이 잡을 수 있다(그때 서버는 곧 끝난다) */
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** 준비 확인(/ping)의 응답에 실린 서버 버전. 버전 필드가 없거나 읽지 못하면 null */
async function versionOf(res: { json?(): Promise<unknown> }): Promise<string | null> {
  try {
    const version = ((await res.json?.()) as { version?: unknown } | undefined)?.version;
    return typeof version === "string" ? version : null;
  } catch {
    // 응답에 버전이 없으면 알 수 없는 버전이다
    return null;
  }
}

export { HOST, ENTRY, EXIT_WITH_PARENT, serverArgs, pickFreePort, versionOf };
