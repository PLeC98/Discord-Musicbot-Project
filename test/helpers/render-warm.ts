// 그리기 워커 예열. 그린 결과를 확인하는 테스트가 워커를 처음 띄우는 시간까지 재지 않게 한다

import { renderQueueMosaic } from "../../src/ui/card-render/render.ts";

/** 예열 한 번의 시간 상한(ms). 느린 Windows 러너에서는 워커를 처음 띄우는 데만 실제 그리기 시간 상한(15초)의 절반 넘게 걸린다 */
const WARM_TIMEOUT_MS = 60_000;

/**
 * 그리기 워커를 띄우고 글꼴을 등록해 둔다(모자이크와 시스템 카드가 같은 워커와 글꼴을 쓴다). 워커는 1분 동안 그리기가 없으면 끝나므로 그린 결과를 확인하는 테스트 바로 앞에서 부른다
 */
async function warmRenderWorker() {
  await renderQueueMosaic({ seed: null, cells: [{ number: 1, jpeg: null }] }, { timeoutMs: WARM_TIMEOUT_MS });
}

export { warmRenderWorker };
