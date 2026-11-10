// AI 모델 정보(모델 프로필 config/ai-models, 가격표 config/ai-prices)를 받는 길 하나.
// AI 설정 화면을 열 때, 모델 목록 새로고침, 설정을 복원한 뒤, `pnpm run update:models` 가 부른다. 정기적으로는 받지 않는다.
// 가격표를 받지 못해도 모델 프로필은 쓴다(가진 가격표로 센다). 실패는 여기서 warn 으로 남기고, 모델 프로필 쪽 실패만 던진다

import * as models from "./ai-models.ts";
import * as prices from "./ai-prices.ts";
import * as aiConfig from "./ai.ts";
import { PROVIDER_SPECS } from "./schema/ai-providers.ts";
import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/error-kind.ts";
import type { RefreshResult } from "./ai-model-types.ts";
const log = logger.child({ category: "config" });

/** 프로필을 받을 레지스트리(PROVIDER_SPECS 의 registry) */
const registries = () => [...new Set(Object.values(PROVIDER_SPECS).flatMap((one) => (one.registry ? [one.registry] : [])))];

// 화면을 열면서 목록 새로고침을 같이 누르거나 화면을 연달아 여는 일이 흔하다.
// 받는 중이면 그 결과를 같이 기다리고, 끝난 지 이만큼 안이면 다시 묻지 않고 그 결과를 쓴다(force 는 늘 묻는다)
const REASK_MS = 5000;
let running: Promise<RefreshResult> | null = null;
let last: { at: number; result: RefreshResult } | null = null;

/** 받는다. changed: 둘 중 하나라도 바뀌었다, count: 모델 프로필 수. force 면 해시와 상관없이 모델 프로필을 받는다 */
function refreshModelInfo({ force = false } = {}): Promise<RefreshResult> {
  if (running) return running;
  if (!force && last && Date.now() - last.at < REASK_MS) return Promise.resolve({ ...last.result, changed: false });
  running = both(force)
    .then((result) => ((last = { at: Date.now(), result }), result))
    .finally(() => (running = null));
  return running;
}

async function both(force: boolean): Promise<RefreshResult> {
  let got: RefreshResult;
  try {
    got = await models.refresh({ registries: registries(), force });
  } catch (error) {
    log.warn(`AI 모델 정보 불러오기 실패(PocketRisu 레지스트리): ${messageOf(error)}. 기존 정보를 씀`);
    throw error;
  }
  const priced = await prices.refresh().catch((error: unknown) => {
    log.warn(`AI 가격표 불러오기 실패(models.dev): ${messageOf(error)}. 기존 가격표로 비용 계산`);
    return null;
  });
  return { ...got, changed: got.changed || !!priced?.changed };
}

/**
 * 설정을 복원한 뒤(다음 기동의 스냅샷 교체, 대시보드 설정 불러오기). 프로바이더를 골라 둔 설정인데 받은 모델 정보가 없으면 한 번 받는다.
 * 기다리지 않는다
 */
function fetchIfMissing() {
  const provider = String(aiConfig.ai().provider ?? "off");
  if (provider === "off" || !PROVIDER_SPECS[provider] || models.saved()) return;
  void refreshModelInfo().catch(() => undefined);
}

export { refreshModelInfo, fetchIfMissing };
