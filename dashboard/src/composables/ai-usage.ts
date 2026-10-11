// AI 사용량 통계 화면의 상태: 기간 · 출처 거르기 · 보고서 · 통계 삭제. 화면이 보일 때 읽는다(active)

import { ref, watch } from "vue";
import axios from "axios";
import { problemText } from "../utils/problem.ts";
import { notifyDone, notifyProblem } from "./toasts.ts";
import type { AiLogSource, AiUsagePeriod, AiUsageReport } from "../../../src/dashboard/contract/ai-log.ts";
import { text } from "../text/index.ts";
const T = text.ai.usage;

export function useAiUsage(active: () => boolean) {
  const period = ref<AiUsagePeriod>(30);
  const sources = ref<AiLogSource[]>([]);
  const report = ref<AiUsageReport | null>(null);
  const loading = ref(false);
  const loadError = ref("");
  const clearing = ref(false);
  // 늦게 온 앞 물음의 답이 새 기간의 답을 덮지 않게 차례를 센다
  let seq = 0;

  async function load() {
    const mine = ++seq;
    loading.value = true;
    try {
      const params = new URLSearchParams({ period: String(period.value) });
      if (sources.value.length) params.set("sources", sources.value.join(","));
      const got = (await axios.get<AiUsageReport>(`/api/admin/ai/usage?${params}`)).data;
      if (mine !== seq) return;
      report.value = got;
      loadError.value = "";
    } catch (error) {
      if (mine === seq) loadError.value = problemText(error, T.loadFailed);
    } finally {
      if (mine === seq) loading.value = false;
    }
  }
  function toggleSource(source: AiLogSource) {
    sources.value = sources.value.includes(source) ? sources.value.filter((one) => one !== source) : [...sources.value, source];
  }
  async function clearAll() {
    clearing.value = true;
    try {
      await axios.delete("/api/admin/ai/usage");
      notifyDone(T.cleared);
      await load();
    } catch (error) {
      notifyProblem(error, T.clearFailed);
    } finally {
      clearing.value = false;
    }
  }

  watch([period, sources], () => void load());
  watch(active, (on) => on && void load(), { immediate: true });
  return { period, sources, report, loading, loadError, clearing, load, toggleSource, clearAll };
}
