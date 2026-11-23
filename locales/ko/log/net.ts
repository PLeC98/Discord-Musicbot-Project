// 로그 문구: 바깥 요청(infra/safe-url). 요청 실패, 응답과 본문의 시간 상한, 다운로드 크기 상한. 직접 링크, 썸네일, AI 등 여러 분류의 줄에 값으로 들어간다

const net = {
  requestCancelled: () => `요청이 취소됨`,
  noResponse: ({ ms }: { ms: number }) => `응답이 ${ms}ms 동안 없음`,
  httpFailed: ({ status }: { status: number }) => `요청 실패: HTTP ${status}`,
  downloadTooBig: ({ maxBytes }: { maxBytes: number }) => `다운로드한 파일이 최대 크기(${maxBytes} bytes)를 초과함`,
  bodyStalled: ({ ms }: { ms: number }) => `본문이 ${ms}ms 동안 오지 않음`,
  downloadTimedOut: ({ ms }: { ms: number }) => `다운로드가 ${ms}ms 안에 끝나지 않음`,
  badUrl: ({ rawUrl }: { rawUrl: string }) => `잘못된 URL: ${rawUrl}`,
  schemeNotAllowed: ({ protocol }: { protocol: string }) => `허용되지 않는 스키마: ${protocol}`,
  hostNotAllowed: ({ host }: { host: string }) => `받지 않는 주소: ${host}`,
  blockedIpLiteral: ({ host }: { host: string }) => `차단된 IP(리터럴): ${host}`,
  dnsFailed: ({ host, reason }: { host: string; reason: number | string }) => `DNS 해석 실패: ${host} (${reason})`,
  dnsEmpty: ({ host }: { host: string }) => `DNS 결과 없음: ${host}`,
  blockedIp: ({ address, host }: { address: string; host: string }) => `차단된 IP: ${address} (${host})`,
  redirectNoLocation: () => `리다이렉트 응답에 Location 헤더 없음`,
  tooManyRedirects: ({ max }: { max: number }) => `리다이렉트 횟수 초과(>${max})`,
  contentTypeNotAllowed: ({ type }: { type: string }) => `허용되지 않는 Content-Type: ${type}`,
  tooBigDeclared: ({ maxBytes, length }: { maxBytes: number; length: string }) => `파일이 최대 크기(${maxBytes} bytes)를 초과: ${length}`,
  tooBig: ({ maxBytes }: { maxBytes: number }) => `파일이 최대 크기(${maxBytes} bytes)를 초과함`,
};

export { net };
