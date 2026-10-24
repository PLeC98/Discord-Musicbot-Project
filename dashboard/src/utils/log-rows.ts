// 실시간 로그 화면의 한 줄. 받은 줄이거나, 받지 못한 줄 · 봇 재시작을 알리는 표시 줄이다

import type { WireEntry } from "../../../src/infra/log/levels.ts";

/**
 * line: 받은 줄. key 는 SSE id("기동표.번호")라 봇을 다시 시작해 번호가 처음부터여도 겹치지 않는다
 * gap: 다시 붙었을 때 서버가 쌓아 둔 줄 밖으로 밀려나 받지 못한 줄(missed 줄)
 * restart: 봇을 다시 시작했다(그 앞의 줄은 옛 실행의 것)
 */
type LogRow = (WireEntry & { key: string; mark?: undefined }) | { key: string; mark: "gap"; missed: number } | { key: string; mark: "restart" };

export type { LogRow };
