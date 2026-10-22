<template>
  <!-- IP 위치 정보 카드 안(ConfigTunables 의 in-geoip 슬롯): 지금 판 · 업데이트 확인(새 판이 있으면 업데이트 버튼, 없으면 "이미 최신") · 받는 중 진행. 누르면 바로 하는 일이라 저장 막대와 상관없다 -->
  <div class="flex flex-col gap-2">
    <p class="text-sm text-on-surface-variant">{{ !state ? "" : !state.enabled ? T.off : state.version ? T.version(state.version, mb(state.bytes)) : T.noVersion }}</p>
    <div v-if="state?.job === 'downloading'" class="flex flex-col gap-1">
      <div class="h-1 rounded-full bg-surface-container-highest overflow-hidden">
        <div class="h-full bg-primary transition-[width]" :style="{ width: `${percent}%` }"></div>
      </div>
      <p class="text-xs text-on-surface-variant">{{ T.downloading(mb(state.received) ?? 0, mb(state.total)) }}</p>
    </div>
    <div v-else-if="state?.enabled" class="flex flex-wrap items-center gap-2">
      <BaseButton variant="secondary" :disabled="checking" @click="check">{{ checking ? T.checking : T.check }}</BaseButton>
      <BaseButton v-if="found?.latest && found.latest !== state.version" @click="update">{{ T.update(found.latest, mb(found.size)) }}</BaseButton>
      <span v-else-if="found" class="text-sm text-on-surface-variant">{{ found.latest ? T.latest : T.notFound }}</span>
    </div>
    <p v-if="state?.error && state.job === 'idle'" class="text-xs text-(--warn-ink)">{{ T.failed(state.error) }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import axios from "axios";
import BaseButton from "./BaseButton.vue";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { saved } from "../composables/tunables.ts";
import type { GeoipCheck, GeoipStatus } from "../../../src/dashboard/contract/admin.ts";
import { text } from "../text/index.ts";
const T = text.geoip;

const state = ref<GeoipStatus | null>(null);
const found = ref<GeoipCheck | null>(null);
const checking = ref(false);
let timer = 0;

const mb = (bytes: number | null) => (bytes === null ? null : Math.round(bytes / 1e6));
const percent = computed(() => (state.value?.total ? Math.min(100, Math.round(((state.value.received ?? 0) / state.value.total) * 100)) : 0));

// 받는 동안은 1초마다 다시 읽는다. 끝나면 판이 바뀌었는지 알린다
async function refresh() {
  const before = state.value;
  try {
    state.value = (await axios.get<GeoipStatus>("/api/admin/geoip")).data;
  } catch (e) {
    notifyProblem(e, T.loadFailed);
    return;
  }
  const now = state.value;
  if (before && before.job !== "idle" && now.job === "idle" && now.version !== before.version && now.version) {
    notifyDone(T.updated, now.version);
    found.value = null;
  }
  clearTimeout(timer);
  if (now.job !== "idle") timer = window.setTimeout(() => void refresh(), 1000);
}

async function check() {
  checking.value = true;
  try {
    found.value = (await axios.post<GeoipCheck>("/api/admin/geoip/check")).data;
  } catch (e) {
    notifyProblem(e, T.checkFailed);
  } finally {
    checking.value = false;
  }
}

async function update() {
  try {
    state.value = (await axios.post<GeoipStatus>("/api/admin/geoip/update")).data;
    void refresh();
  } catch (e) {
    notifyProblem(e, T.updateFailed);
  }
}

onMounted(refresh);
// 켜기 · 자동 업데이트를 저장하면 다시 읽는다(켜면 서버가 곧바로 한 번 확인한다)
watch(
  () => [saved.value.GEOIP_ENABLED, saved.value.GEOIP_AUTO_UPDATE],
  () => void refresh(),
);
onUnmounted(() => clearTimeout(timer));
</script>
