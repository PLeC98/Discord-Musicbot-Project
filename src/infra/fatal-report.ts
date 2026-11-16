// 치명적 오류(힙 메모리 부족, V8, Node 내부 오류)로 프로세스가 죽을 때 Node 의 진단 보고서(JSON)를 남긴다. 이런 종료는 로그에 아무것도 남지 않는다.
// 보고서는 기본으로 환경 변수 전체를 담는다. .env 는 process.env 로 읽어 봇 토큰, 암호화 키가 들어 있으므로 환경 변수와 네트워크 인터페이스는 빼고 남긴다.
// 운영체제가 죽이는 충돌(세그폴트, Windows 의 0xC0000005) 때는 Node 가 보고서를 쓸 틈이 없어 남지 않는다

import fs from "node:fs";

type Report = Pick<NodeJS.ProcessReport, "directory" | "excludeEnv" | "reportOnFatalError"> & { excludeNetwork?: boolean };

/** directory 에 보고서를 남기게 한다. 폴더를 만들지 못하면 그 이유를 돌려준다(보고서만 못 남길 뿐 봇은 그대로 돈다) */
function enableFatalReport(directory: string, report: Report = process.report): string | null {
  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch (error) {
    return String((error as { message?: unknown }).message ?? error);
  }
  report.excludeEnv = true;
  report.excludeNetwork = true;
  report.directory = directory;
  report.reportOnFatalError = true;
  return null;
}

export { enableFatalReport };
