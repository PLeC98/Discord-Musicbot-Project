// 자동재생 소스가 같이 쓰는 요청 도우미.

import { setTimeout as sleep } from "node:timers/promises";
import config from "../../../config.ts";

const userAgent = () => config.userAgents.bot;

const TIMEOUT_MS = 15000;

// 바깥으로 나가는 요청. 시험은 useFetch 로 가짜를 넘긴다(기본은 진짜 fetch)
let send: typeof fetch = fetch;
function useFetch(fake: typeof fetch | null) {
  send = fake ?? fetch;
}

const rand = (n: number) => Math.floor(Math.random() * n);

const pick = <T>(list: T[]): T | null => (list.length ? list[rand(list.length)] : null);

// T: 받는 쪽이 읽는 칸만 적은 응답 모양. 검사하지 않으므로 칸은 모두 없을 수 있게 적는다
async function getJson<T = unknown>(url: string, headers: Record<string, string> = {}, timeoutMs = TIMEOUT_MS): Promise<T> {
  const res = await send(url, { headers: { Accept: "application/json", "User-Agent": userAgent(), ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${new URL(url).host})`);
  return (await res.json()) as T;
}

// getJson의 형제. 필터를 본문으로 받는 API용.
// 422 는 응답 본문을 같이 남긴다. 어느 값이 틀렸는지 저쪽이 적어 주는데, 상태 코드만 남기면
// 설정이 조용히 빈손이 되는 이유를 알 수 없다.
async function postJson<T = unknown>(url: string, body: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
  const res = await send(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": userAgent() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = res.status === 422 ? await res.text().catch(() => "") : "";
    throw new Error(`HTTP ${res.status} (${new URL(url).host})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

// 배열 옵션은 이름 뒤에 []를 붙여야 듣는다. 안 붙이면 400도 아니고 조용히 무시된다
// VocaDB 계열에서 가장 흔한 함정이라 여기 한 곳에서 책임진다.
function query(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      for (const one of value) q.append(`${key}[]`, String(one));
    } else q.append(key, String(value));
  }
  return q.toString();
}

/**
 * 저쪽에서 받아 기억해 두는 값(화면의 칸을 채우는 목록 · 범위).
 *
 * load() 는 값을 돌려주거나, 못 받았으면 스스로 까닭을 남기고 null 을 돌려준다.
 * ttlMs 동안은 기억한 값을 쓴다. 지나면 새로 묻되 waitMs 까지만 기다리고, 늦으면 기억한 값(없으면 null)으로 먼저 답한다.
 * 받기는 뒤에서 마저 한다. 못 받았으면 retryMs 동안 다시 묻지 않는다. 저쪽이 죽어 있을 때 부를 때마다 시간 초과를 기다리지 않게.
 */
function remembered<T>(load: () => Promise<T | null>, { ttlMs, retryMs, waitMs }: { ttlMs: number; retryMs: number; waitMs: number }) {
  let value: T | null = null;
  let at = 0;
  let failedAt = 0;
  let running: Promise<void> | null = null;
  const refresh = () =>
    (running ??= (async () => {
      try {
        const next = await load();
        if (next == null) failedAt = Date.now();
        else {
          value = next;
          at = Date.now();
        }
      } catch {
        failedAt = Date.now(); // load 가 까닭을 남긴다
      } finally {
        running = null;
      }
    })());
  return {
    async get(): Promise<T | null> {
      const fresh = value !== null && Date.now() - at < ttlMs;
      const resting = Date.now() - failedAt < retryMs;
      if (!fresh && !resting) await Promise.race([refresh(), sleep(waitMs, undefined, { ref: false })]);
      return value;
    },
    /** 테스트가 바깥으로 나가지 않게 값을 채운다. null 이면 처음 상태로 */
    seed(next: T | null | undefined) {
      value = next ?? null;
      at = next ? Date.now() : 0;
      failedAt = 0;
    },
  };
}

export { getJson, postJson, pick, rand, query, remembered, useFetch };
