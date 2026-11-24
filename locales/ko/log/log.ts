// 로그 문구: 로그 자체(log 분류). 파일 기록기의 긴 줄 줄이기와 기록 멈춤, 기록 실패를 묶는 라벨

const log = {
  /** 한 줄이 상한을 넘어 필드를 뺐다. names: 뺀 필드 이름 몇 개(쉼표로 이음), extra: 이름을 적지 않은 나머지 수 */
  lineReduced: ({ bytes, names, extra }: { bytes: number; names: string; extra: number }) => `로그 줄이 상한을 넘어(${bytes}바이트) 뺀 필드: ${names}${extra > 0 ? ` 외 ${extra}개` : ""}`,
  /** 파일 기록이 멈췄다가 재개됐다. lost: 그동안 남기지 못한 줄 수 */
  fileResumed: ({ seconds, lost }: { seconds: number; lost: number }) => `파일 로그가 ${seconds}초 동안 멈췄다가 재개됨. 그동안 ${lost}줄을 남기지 못함`,
  fileLog: ({ file }: { file: string }) => `파일 로그(${file})`,
  destinationWrite: () => `로그 출력 대상 기록`,
  rotatedListFailed: ({ dir, caller, error, code }: { dir: string; caller: string; error: string; code: string }) => `로그 폴더 읽기 실패(로테이션된 로그 파일 없음으로 처리): ${dir} | 작업=${caller} | ${error} (${code})`,
  openFailed: () => `파일을 열 수 없음`,
  pruneLabel: () => `로그 정리`,
  rotateFailed: () => `로그 회전 실패`,
  writeFailed: () => `기록 실패`,
  destinationLost: ({ error }: { error: string }) => `${error} (해당 로그 유실)`,
  /** 제목을 모르는 곡(로그 줄의 곡 라벨) */
  untitled: () => `(제목 없음)`,
  /** 너무 긴 값의 가운데를 줄였다. count: 줄인 글자 수 */
  clipped: ({ count }: { count: number }) => `(가운데 ${count}자 생략)`,
  /** 기동 초기에 모아 둔 줄을 첫 기록처에 다시 쓰다 실패했다. failed: 실패한 줄 수, total: 모아 둔 줄 수, error: 첫 실패의 첫 줄 */
  replayFailed: ({ failed, total, error }: { failed: number; total: number; error: string }) => `기동 초기 버퍼 로그 기록 실패(실패 건 파일에서 누락): ${failed}/${total}건 | ${error}`,
  /** 지난 로그 파일을 지우지 못했다 */
  oldFileDeleteFailed: ({ name, error }: { name: string; error: string }) => `지난 로그 파일 삭제 실패(${name}): ${error}`,
};

export { log };
