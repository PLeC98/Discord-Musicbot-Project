// 로그 문구: 로그 자체(log 분류). 파일 기록기의 줄이기와 멈춤, 기록 실패를 묶는 라벨

const log = {
  /** 한 줄이 상한을 넘어 필드를 뺐다. names: 뺀 필드 이름 몇 개(쉼표로 이음), extra: 이름을 적지 않은 나머지 수 */
  lineReduced: ({ bytes, names, extra }: { bytes: number; names: string; extra: number }) => `로그 줄이 상한을 넘어(${bytes}바이트) 뺀 필드: ${names}${extra > 0 ? ` 외 ${extra}개` : ""}`,
  /** 파일 기록이 멈췄다가 재개됐다. lost: 그동안 남기지 못한 줄 수 */
  fileResumed: ({ seconds, lost }: { seconds: number; lost: number }) => `파일 로그가 ${seconds}초 동안 멈췄다가 재개됨. 그동안 ${lost}줄을 남기지 못함`,
  fileLog: ({ file }: { file: string }) => `파일 로그(${file})`,
  destinationWrite: () => `로그 출력 대상 기록`,
};

export { log };
