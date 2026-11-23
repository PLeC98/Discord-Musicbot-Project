// 로그 문구: 바깥 요청(infra/safe-url). 요청 실패, 응답과 본문의 시간 상한, 다운로드 크기 상한. 직접 링크, 썸네일, AI 등 여러 분류의 줄에 값으로 들어간다

const net = {
  requestCancelled: () => `요청이 취소됨`,
  noResponse: ({ ms }: { ms: number }) => `응답이 ${ms}ms 동안 없음`,
  httpFailed: ({ status }: { status: number }) => `요청 실패: HTTP ${status}`,
  downloadTooBig: ({ maxBytes }: { maxBytes: number }) => `다운로드한 파일이 최대 크기(${maxBytes} bytes)를 초과함`,
  bodyStalled: ({ ms }: { ms: number }) => `본문이 ${ms}ms 동안 오지 않음`,
  downloadTimedOut: ({ ms }: { ms: number }) => `다운로드가 ${ms}ms 안에 끝나지 않음`,
};

export { net };
