// 설치 스크립트의 파일 받기. 전체 시간은 묶지 않고(느린 망에서 큰 압축 파일을 받는 중일 수 있다), 응답이나 다음 조각이 idleMs 동안 오지 않을 때만 끊는다

const IDLE_MS = 60_000;

/** url의 본문 전체. 2xx가 아니거나 idleMs 동안 받은 것이 없으면 던진다 */
async function download(url: string, { idleMs = IDLE_MS }: { idleMs?: number } = {}): Promise<Buffer> {
  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => abort.abort(new Error(`${idleMs / 1000}초 동안 받은 것이 없어 끊음. ${url}`)), idleMs);
  };
  arm();
  try {
    const res = await fetch(url, { redirect: "follow", signal: abort.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}. ${url}`);
    const chunks: Uint8Array[] = [];
    if (res.body) {
      for await (const chunk of res.body) {
        arm();
        chunks.push(chunk);
      }
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

export { download };
