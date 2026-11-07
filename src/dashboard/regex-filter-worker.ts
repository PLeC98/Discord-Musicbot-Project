/**
 * 캐시 DB의 정규식 필터를 검사하는 워커 스레드(dashboard/regex-filter). 오래 걸려도 봇의 이벤트 루프를 막지 않게 따로 돈다.
 * 입력은 { id, sources, rows }, 출력은 { id, hits }, { id, tooLarge } 또는 { id, error }이다. rows는 행마다 검사할 값을 sources 순서대로 담은 배열이고, hits는 모든 정규식에 일치한 행의 인덱스다.
 * tooLarge: 값이 너무 길어 정규식 엔진의 한도를 넘은 경우(RangeError). 입력 탓이라 실패와 따로 알린다
 */
import { parentPort } from "worker_threads";

type Job = { id: number; sources: string[]; rows: Array<Array<string | null>> };

parentPort?.on("message", ({ id, sources, rows }: Job) => {
  try {
    const patterns = sources.map((source) => new RegExp(source, "i"));
    const hits: number[] = [];
    // 빈 값은 정규식에 맞지 않는다(rules/track-cache-filter의 matchFilter와 같다)
    for (const [i, values] of rows.entries()) if (values.every((value, k) => value !== null && value !== "" && patterns[k].test(value))) hits.push(i);
    parentPort?.postMessage({ id, hits });
  } catch (error) {
    if (error instanceof RangeError) return void parentPort?.postMessage({ id, tooLarge: true });
    parentPort?.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
