// event-link.js 의 모양(봇 쪽 시험이 부를 때 쓴다)

type Source = { readyState: number; onopen: (() => void) | null; onerror: (() => void) | null; addEventListener(name: string, fn: (e: never) => void): void; close(): void };
type State = "open" | "retrying" | "down";

export function eventLink(options: { url: string | (() => string); open: (url: string) => Source; events: Record<string, (e: never) => void>; onState?: (state: State) => void; check?: () => Promise<boolean>; delay?: (attempt: number) => number; schedule?: (fn: () => void, ms: number) => unknown; cancel?: (timer: unknown) => void }): { start(): void; stop(): void };
