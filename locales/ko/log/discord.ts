// 로그 문구: 디스코드 연결과 요청(discord 분류). 거절된 요청 누적 등

const discord = {
  /** 디스코드 요청 제한으로 기다린다. ms: 풀릴 때까지, global: 봇 전체에 걸린 제한 */
  rateLimited: ({ method, route, ms, global }: { method: string; route: string; ms: number; global: boolean }) => `요청 제한 대기: ${method} ${route} | ${ms}ms${global ? " | 전역" : ""}`,
  invalidRequestWarning: ({ count, seconds }: { count: number; seconds: number }) => `거절된 디스코드 요청 누적 ${count}회(10분 윈도우 남은 시간 ${seconds}초). 1만 회를 넘으면 디스코드에서 이 IP를 일시 차단함`,
  gatewayDisconnected: ({ shardId, cause }: { shardId: number; cause: string }) => `게이트웨이 연결 끊김(샤드 ${shardId}): ${cause}. 재연결 중`,
  gatewayReconnecting: ({ attempt }: { attempt: number }) => `게이트웨이 연결이 끊겨 재연결 중(${attempt}번째 시도)`,
  gatewayClosed: ({ shardId, code, closeName, firstError }: { shardId: number; code: number; closeName: string; firstError: string }) => `게이트웨이 연결이 닫혀 재연결하지 않음(샤드 ${shardId}): 닫힘 코드 ${code}${closeName}${firstError}`,
  gatewayReasonReconnect: () => `디스코드가 재연결을 요청함(op 7)`,
  gatewayReasonZombie: () => `하트비트 응답 없음`,
  gatewayReasonDisconnected: () => `디스코드가 끊음`,
  gatewayReasonInvalidSession: () => `세션이 무효`,
  gatewayCloseCode: ({ code }: { code: number }) => `닫힘 코드 ${code}`,
  gatewayCloseReason: ({ reason, code }: { reason: string; code: number }) => `${reason}, 코드 ${code}`,
  gatewayErrors: ({ count, first }: { count: number; first: string }) => `연결 오류 ${count}번(첫: ${first})`,
  gatewayCauseUnknown: () => `모름`,
  gatewayReconnected: ({ how, attempt, cause }: { how: string; attempt: number; cause: string }) => `게이트웨이 재연결: ${how} | 시도 ${attempt}회 | 원인=${cause}`,
  gatewaySessionResumed: () => `세션 재개`,
  gatewayNewSession: () => `새 세션`,
  /** discord.js가 알린 경고. text: 라이브러리의 글 그대로(바깥 글) */
  libraryWarning: ({ text }: { text: string }) => `${text}`,
  /** discord.js의 진행 기록(하트비트, 게이트웨이). text: 라이브러리의 글 그대로(바깥 글) */
  libraryDebug: ({ text }: { text: string }) => `${text}`,
  /** discord.js REST의 진행 기록. text: 라이브러리의 글 그대로(바깥 글) */
  restDebug: ({ text }: { text: string }) => `${text}`,
};

export { discord };
