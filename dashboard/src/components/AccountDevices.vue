<template>
  <!-- 설정 창 "계정"의 로그인한 기기: 기기마다 종류 아이콘 · 브라우저 · OS · 위치 · 마지막 활동, 이 기기가 아니면 로그아웃. 끊기는 서버가 최근 로그인을 요구한다(지났으면 다시 로그인 창).
       위치를 IP 위치 DB 로 보였으면 아래에 출처 링크(DB-IP 가 요구한다) -->
  <div class="flex flex-col">
    <p v-if="loadError" class="text-label text-error py-2">{{ loadError }}</p>
    <div v-for="d in devices" :key="d.id" class="-mx-3 px-3 py-2 min-h-14 rounded-2xl flex items-center gap-4">
      <Icon :name="ICON[d.kind ?? 'unknown']" :size="20" class="text-on-surface-variant" />
      <span class="flex-1 min-w-0">
        <span class="flex items-center gap-2 text-body font-medium"
          ><span class="truncate">{{ d.known ? T.name(d.browser, d.os) || T.unknown : T.unknown }}</span
          ><span v-if="d.current" class="shrink-0 px-2 rounded-full text-label font-semibold bg-secondary-container text-on-secondary-container">{{ T.current }}</span></span
        >
        <span class="block text-label text-on-surface-variant truncate" v-tooltip="cityOf(d)">{{ subOf(d) }}</span>
      </span>
      <BaseButton v-if="!d.current" variant="ghost" size="sm" :disabled="busy" @click="signOut(d)">{{ T.signOut }}</BaseButton>
    </div>
    <div v-if="others > 0" class="flex justify-end pt-2">
      <BaseButton variant="secondary" :disabled="busy" @click="asking = true">{{ T.signOutOthers }}</BaseButton>
    </div>
    <a v-if="geoip" href="https://db-ip.com" target="_blank" rel="noopener noreferrer" class="self-start mt-2 text-xs text-on-surface-variant hover:underline">{{ T.attribution }}</a>
    <ConfirmDialog v-model="asking" icon="logout" :title="T.confirmTitle" :body="T.confirmBody(others)" :confirm-label="T.signOutOthers" :busy="busy" @confirm="signOutOthers" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import Icon from "./BaseIcon.vue";
import BaseButton from "./BaseButton.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { problemText } from "../utils/problem.ts";
import { relativeTime } from "../utils/locale.ts";
import type { IconName } from "../icons.ts";
import type { LoginDevice, LoginDevices, SignedOut } from "../../../src/dashboard/contract/identity.ts";
import { text } from "../text/index.ts";
const T = text.settings.devices;

const ICON: Record<NonNullable<LoginDevice["kind"]> | "unknown", IconName> = { desktop: "computer", mobile: "smartphone", tablet: "tablet", unknown: "help" };

const devices = ref<LoginDevice[]>([]);
const geoip = ref(false);
const loadError = ref("");
const busy = ref(false);
const asking = ref(false);
const others = computed(() => devices.value.filter((d) => !d.current).length);

// 마지막 활동: 5분 안이면 지금(서버가 5분마다 적는다), 그 밖은 "3시간 전"
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];
function agoText(at: number | null) {
  if (at === null) return "";
  const diff = Date.now() - at;
  if (diff < 5 * 60_000) return T.now;
  const [unit, size] = UNITS.find(([, ms]) => diff >= ms) ?? UNITS[UNITS.length - 1];
  return relativeTime.format(-Math.floor(diff / size), unit);
}

/** 둘째 줄: 위치(지역 · 나라, 내부망) · 마지막 활동. 기록이 없으면 그렇다고 */
function subOf(d: LoginDevice) {
  if (!d.known) return T.unknownDesc;
  const place = d.place?.kind === "private" ? T.private : d.place?.kind === "geo" ? [d.place.region, d.place.country].filter(Boolean).join(", ") : "";
  return [place, agoText(d.seenAt)].filter(Boolean).join(" · ");
}
/** 도시(동 단위까지라 툴팁으로) */
const cityOf = (d: LoginDevice) => (d.place?.kind === "geo" && d.place.city ? d.place.city : null);

async function load() {
  try {
    const { data } = await axios.get<LoginDevices>("/api/me/devices");
    devices.value = data.devices;
    geoip.value = data.geoip;
    loadError.value = "";
  } catch (e) {
    loadError.value = problemText(e, T.loadFailed);
  }
}

async function signOut(d: LoginDevice) {
  busy.value = true;
  try {
    const { data } = await axios.delete<SignedOut>(`/api/me/devices/${d.id}`);
    notifyDone(T.done(data.count));
  } catch (e) {
    notifyProblem(e, T.failed);
  } finally {
    busy.value = false;
    void load();
  }
}

async function signOutOthers() {
  busy.value = true;
  try {
    const { data } = await axios.post<SignedOut>("/api/me/devices/sign-out-others");
    notifyDone(T.done(data.count));
  } catch (e) {
    notifyProblem(e, T.failed);
  } finally {
    busy.value = false;
    asking.value = false;
    void load();
  }
}

onMounted(load);
</script>
