// 지연 판정과 기록 평균. /ping 과 대시보드 봇 상태 탭이 같은 계산식을 쓴다

import { LIMITS, levelOf, type Level } from "./status-levels.ts";

/** 연결의 하트비트 왕복(게이트웨이, 음성 게이트웨이). 대시보드의 핑과 같은 기준(rules/status-levels 의 LIMITS.ping) */
const linkLevel = (ms: number): Level => levelOf(ms, ...LIMITS.ping);

/**
 * 명령부터 응답이 만들어질 때까지, REST 왕복(응답 시간의 일부라 같은 기준). 상호작용은 3초 안에 답해야 하므로 그 전에 주의, 위험.
 * REST 는 디스코드 API 서버까지 거리에 따른 지연과 응답 메시지를 만드는 시간이 더해져 한국에서는 300 ~ 450ms 가 보통이다
 */
const RESPONSE_LIMITS = [1000, 2000] as const;
const responseLevel = (ms: number): Level => levelOf(ms, ...RESPONSE_LIMITS);

/** 기록 구간(분). 봇을 켠 지 1분이 안 됐어도 0분이 아니라 1분 */
const historyMinutes = (stepMs: number, count: number) => Math.max(1, Math.round((stepMs * count) / 60_000));

/** 기록의 평균(정수). 비었으면 0 */
const averageOf = (values: readonly number[]) => Math.round(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length));

export { linkLevel, responseLevel, RESPONSE_LIMITS, historyMinutes, averageOf };
