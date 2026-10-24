/**
 * 토큰 세기를 도는 스레드. 긴 글을 세는 동안 봇의 이벤트 루프가 멈추지 않게 따로 돈다.
 * 받는 것 { id, texts, tokenizer } → 주는 것 { id, counted, problem? } 또는 { id, error }. problem 은 젬마 파일을 읽지 못한 까닭(처음 한 번)
 */
import { parentPort } from "worker_threads";
import { count, takeGemmaProblem } from "./tokenizers.ts";

type Job = { id: number; texts: string[]; tokenizer: string };

// 실패는 약속 밖으로 새지 않고 오류로 답한다
async function answer({ id, texts, tokenizer }: Job) {
  try {
    const counted = [];
    for (const one of texts) counted.push(await count(one, tokenizer));
    parentPort?.postMessage({ id, counted, problem: takeGemmaProblem() });
  } catch (error) {
    parentPort?.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
}

parentPort?.on("message", (job: Job) => {
  answer(job).catch(() => {
    // answer 는 던지지 않는다(postMessage 자체가 실패하면 스레드가 끝나고 부모가 안다)
  });
});
