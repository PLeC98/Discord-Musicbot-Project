// request.js 의 모양(봇 쪽 시험이 부를 때 쓴다)

import type { AxiosInstance } from "axios";

export const LIMIT: { short: number; long: number; none: number };
export function failureKind(error: unknown): "timeout" | "offline" | "aborted" | null;
export function installRequests(http: AxiosInstance, hooks: { onSessionEnd: () => void; onReach: (ok: boolean) => void }): void;
