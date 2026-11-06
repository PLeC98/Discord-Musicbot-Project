/**
 * 캐시 DB 의 정규식 필터를 맞춰 보는 스레드(dashboard/regex-filter). 오래 걸려도 봇의 이벤트 루프를 막지 않게 따로 돈다.
 * 받는 것 { id, sources, rows } → 주는 것 { id, hits } 또는 { id, error }. rows 는 행마다 sources 차례의 값, hits 는 모든 정규식에 맞은 행의 번호
 */
import { parentPort } from "worker_threads";

type Job = { id: number; sources: string[]; rows: Array<Array<string | null>> };

parentPort?.on("message", ({ id, sources, rows }: Job) => {
  try {
    const patterns = sources.map((source) => new RegExp(source, "i"));
    const hits: number[] = [];
    // 빈 값은 정규식에 맞지 않는다(rules/track-cache-filter 의 matchFilter 와 같다)
    for (const [i, values] of rows.entries()) if (values.every((value, k) => value !== null && value !== "" && patterns[k].test(value))) hits.push(i);
    parentPort?.postMessage({ id, hits });
  } catch (error) {
    parentPort?.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
