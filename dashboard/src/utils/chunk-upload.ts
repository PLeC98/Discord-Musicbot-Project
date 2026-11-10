// 큰 파일을 청크로 올린다(봇의 /api/admin/uploads, src/dashboard/routes/uploads.ts). 다 올리면 업로드 id를 돌려주고, 기능 경로가 그 id로 가져간다.
// 연결이 끊기거나 시간 한도, 요청 제한(429), 봇 쪽 오류(5xx), 위치 어긋남이면 기다렸다 봇이 받은 위치부터 이어 올린다.
// 받은 위치가 오르지 않은 채 6번 재시도하고도 실패하면 중단한다. 중단하거나 취소하면 봇의 업로드를 지운다

import axios, { type AxiosInstance } from "axios";
import { failureKind, problemCodeOf, replyOf, statusOf } from "./request.ts";
import type { UploadProgress, UploadPurpose, UploadStarted, UploadStatus } from "../../../src/dashboard/contract/uploads.ts";

const BASE = "/api/admin/uploads";
/** 청크 하나의 시간 한도(봇의 요청 시간 제한과 같다). 기본 한도(10초)면 느린 망에서 청크가 늘 끊긴다 */
const CHUNK_TIMEOUT = 300_000;
/** 재시도하기 전에 기다리는 시간(초, 차례대로). 받은 위치가 오르지 않은 채 이만큼 재시도하고도 실패하면 중단한다 */
const WAITS = [1, 2, 4, 8, 16, 30];

/** ms 동안 기다린다. signal이 취소되면 그 이유로 실패한다 */
function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    function stop() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/** 재시도할 오류인가: 봇에게서 응답을 못 받음(끊김, 시간 초과. 화면이 취소한 것은 빼고), 요청 제한, 봇 쪽 오류, 위치 어긋남.
 *  응답 없는 실패는 오류 코드로 가르지 않는다(브라우저는 ERR_NETWORK, 연결이 끊기면 ECONNRESET 처럼 환경마다 다르다) */
function retryable(error: unknown) {
  const kind = failureKind(error);
  if (kind === "timeout" || kind === "offline") return true;
  const status = statusOf(error);
  if (status === undefined) return kind !== "aborted";
  return status === 429 || (status !== undefined && status >= 500) || problemCodeOf(replyOf(error)) === "upload-offset";
}

/** 요청 제한의 Retry-After(밀리초). 없으면 null */
function retryAfterOf(error: unknown) {
  const seconds = Number((error as { response?: { headers?: Record<string, string> } }).response?.headers?.["retry-after"]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/** 봇이 받은 위치. 위치 어긋남이면 그 응답에, 아니면 물어본다(묻기도 실패하면 아는 위치 그대로. 업로드가 없어졌으면 그 실패를 던진다) */
async function receivedNow(http: AxiosInstance, id: string, error: unknown, known: number, signal?: AbortSignal) {
  const reply = replyOf(error) as { received?: unknown } | undefined;
  if (problemCodeOf(reply) === "upload-offset" && typeof reply?.received === "number") return reply.received;
  try {
    return (await http.get<UploadStatus>(`${BASE}/${id}`, { signal })).data.received;
  } catch (asked) {
    if (signal?.aborted || problemCodeOf(replyOf(asked)) === "upload-gone") throw asked;
    return known;
  }
}

/** file을 올린다. onProgress: 진행률(0 ~ 1). signal로 중단한다. http: 요청에 쓸 axios(기본값은 화면 전체가 쓰는 인스턴스). 다 올린 업로드 id */
export async function uploadFile(file: Blob, purpose: UploadPurpose, { onProgress, signal, http = axios }: { onProgress?: (share: number) => void; signal?: AbortSignal; http?: AxiosInstance } = {}): Promise<string> {
  const { id, chunkSize } = (await http.post<UploadStarted>(BASE, { purpose, size: file.size }, { signal })).data;
  let received = 0;
  let fails = 0;
  try {
    while (received < file.size) {
      const at = received;
      try {
        const { data } = await http.put<UploadProgress>(`${BASE}/${id}`, file.slice(at, at + chunkSize), {
          params: { offset: at },
          headers: { "Content-Type": "application/octet-stream" },
          timeout: CHUNK_TIMEOUT,
          signal,
          onUploadProgress: (event) => onProgress?.((at + event.loaded) / file.size),
        });
        received = data.received;
        fails = 0;
      } catch (error) {
        if (signal?.aborted || !retryable(error) || fails >= WAITS.length) throw error;
        await wait(retryAfterOf(error) ?? WAITS[fails] * 1000, signal);
        fails++;
        const next = await receivedNow(http, id, error, received, signal);
        if (next > received) fails = 0;
        received = next;
      }
      onProgress?.(received / file.size);
    }
    return id;
  } catch (error) {
    // 취소한 신호를 쓰지 않고 따로 보낸다. 못 지워도 봇이 15분 뒤에 지운다
    void http.delete(`${BASE}/${id}`).catch(() => undefined);
    throw error;
  }
}
