// 안내 하나의 모양. 디스코드(ui/frame)와 대시보드가 같이 그린다. 이모지 · 색은 그리는 쪽이 topic · severity 로 고른다

import type { Code } from "../../rules/problems.ts";

/** 무엇에 관한 안내인가. 사용자가 할 일이 같으면 한 주제 */
type Topic = "failed" | "permission" | "voice" | "stale" | "input" | "notFound" | "link" | "blocked" | "live" | "waiting" | "muted" | "autoplay" | "state";
/** 오류 · 경고 안내. error 는 봇 쪽 문제, warning 은 사용자가 고칠 수 있거나 지금 상태라 못 한 것. 요청의 문제면 그 코드(code)를 단다 */
type Notice = { code?: Code; topic: Topic; severity: "error" | "warning"; title: string; body?: string };

/** 안내 하나. 본문이 없으면 칸을 두지 않는다 */
const noticeOf = (severity: Notice["severity"], topic: Topic, title: string, body?: string): Notice => (body ? { topic, severity, title, body } : { topic, severity, title });

export { noticeOf };
export type { Notice, Topic };
