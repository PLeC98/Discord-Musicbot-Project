<template>
  <!-- 디스플레이 탭의 파비콘 카드: 크기마다 올린다. 크기와 다른 이미지는 봇이 그 크기로 다시 만들고, 정사각형이 아니면 이미지 편집 대화상자로 잘라 올린다.
       추가하기 · 변경은 크기별 팝업(이미지 업로드 · 링크로 추가 · 기록)을 연다. 기록(최근 FAVICON_HISTORY 개)으로 다시 올리지 않고 갈아 끼운다 -->
  <div class="flex flex-col gap-(--gap-in)">
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>

    <BaseCard icon="tab" :title="T.favicon">
      <template #actions><DocLink file="docs/favicon.md" /></template>
      <p class="mb-3 flex items-center gap-1 text-sm text-on-surface-variant">{{ T.faviconDesc }}<Icon name="info" :size="16" class="shrink-0 cursor-help" v-tooltip="T.faviconTip" /></p>

      <!-- 크기 칸: 쓰이는 곳 · 지금 내는 이미지(칸 폭의 미리 보기 판, 이미지는 실제 크기, 큰 것은 128 로 줄여) · 어디서 왔는지 · 기록 개수(이미지를 지워도 기록이 있으면 보인다) · 추가하기(변경) · 삭제.
           칸에 끌어다 놓아도 된다. 남는 폭은 칸들이 나눠 갖는다 -->
      <div class="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
        <div v-for="slot in state?.slots ?? []" :key="slot.size" class="flex flex-col items-center gap-2 rounded-2xl bg-surface-container px-3 py-4 transition-[outline-color] outline-2 outline-dashed" :class="over === slot.size ? 'outline-primary' : 'outline-transparent'" @dragover.prevent="over = slot.size" @dragleave="over = null" @drop.prevent="onDrop($event, slot.size)">
          <span class="text-base font-semibold nums">{{ slot.size }}px</span>
          <span class="-mt-1.5 text-xs text-on-surface-variant">{{ T.useOf(slot.size) }}</span>
          <span class="flex items-center justify-center w-full max-w-40 aspect-square rounded-2xl bg-surface-container-high">
            <img v-if="slot.from !== 'none'" :src="`/favicon/${slot.size}?v=${state!.version}`" alt="" :style="{ width: `${Math.min(slot.size, 128)}px`, height: `${Math.min(slot.size, 128)}px` }" />
            <Icon v-else name="block" :size="32" class="text-on-surface-variant" />
          </span>
          <!-- 좁으면 출처와 기록 개수가 각각 통째로 다음 줄로 간다 -->
          <span class="flex flex-wrap items-center justify-center gap-x-1 text-xs">
            <span class="flex items-center gap-1 whitespace-nowrap" :class="slot.from === 'upload' ? 'text-on-surface' : 'text-on-surface-variant'">
              {{ fromText(slot) }}
              <Icon v-if="blurry(slot)" name="warning" :size="14" class="text-warning cursor-help" v-tooltip="T.blurryTip" />
            </span>
            <span v-if="slot.history.length" class="whitespace-nowrap text-on-surface-variant nums">· {{ T.history.count(slot.history.length) }}</span>
          </span>
          <span class="flex flex-wrap items-center justify-center gap-1">
            <BaseButton size="sm" variant="secondary" :disabled="busy || !state" @click="dialogFor = slot.size"><Icon :name="slot.current ? 'tune' : 'upload'" :size="16" />{{ slot.current ? T.replace : T.upload }}</BaseButton>
            <button v-if="slot.current" type="button" :class="[ICON_BTN, 'size-8']" class="hover:text-error" :disabled="busy" :aria-label="T.clearOne(slot.size)" v-tooltip="T.clearOne(slot.size)" @click="clear(slot.size)"><Icon name="delete" :size="18" /></button>
          </span>
        </div>
      </div>
      <input ref="fileInput" type="file" :accept="TYPES.join(',')" class="hidden" @change="onPick" />
    </BaseCard>

    <ImageCropDialog v-model="cropping" :file="cropFile" :aspect="1" :target="cropSize" :max-side="FAVICON_RESERVE_SIDE" @done="onCropped" />
    <FaviconSlotDialog v-model="dialogOpen" :entry="dialogSlot" :busy="busy" @upload="uploadFromDialog" @link="fromLink" @use="useImage" @remove="removeImage" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import { ICON_BTN } from "../utils/icon-button.ts";
import { problemText } from "../utils/problem.ts";
import { formatBytes } from "../../../src/ui/format.ts";
import { refreshFavicon } from "../utils/appearance.ts";
import { notify, notifyDone, notifyProblem } from "../composables/toasts.ts";
import BaseCard from "./BaseCard.vue";
import DocLink from "./DocLink.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import ImageCropDialog from "./ImageCropDialog.vue";
import FaviconSlotDialog from "./FaviconSlotDialog.vue";
import { APPEARANCE_MAX_BYTES, FAVICON_MIN_SIDE, FAVICON_RESERVE_SIDE, type FaviconSlot, type FaviconSlots } from "../../../src/dashboard/contract/appearance.ts";
import { text } from "../text/index.ts";
const T = text.appearance;

const TYPES = ["image/png", "image/webp", "image/jpeg", "image/svg+xml"];
const API = "/api/admin/appearance/favicon";

const state = ref<FaviconSlots | null>(null);
const loadError = ref("");
const busy = ref(false);
/** 끌어다 놓는 중인 칸 */
const over = ref<number | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
/** 파일을 고르는 칸 */
let pickingFor = 0;
const cropping = ref(false);
const cropFile = ref<File | null>(null);
const cropSize = ref(0);
/** 팝업을 연 크기(없으면 닫힘) */
const dialogFor = ref<number | null>(null);
const dialogSlot = computed(() => state.value?.slots.find((slot) => slot.size === dialogFor.value) ?? null);
const dialogOpen = computed({ get: () => dialogFor.value !== null, set: (on) => !on && (dialogFor.value = null) });

const currentOf = (slot: FaviconSlot) => slot.history.find((one) => one.id === slot.current) ?? null;
function fromText(slot: FaviconSlot) {
  if (slot.from === "upload") return T.from.upload;
  if (slot.from === "scaled" && slot.source) return T.from.scaled(slot.source);
  return slot.from === "avatar" ? T.from.avatar : T.from.none;
}
/** 이 크기보다 작은 이미지를 늘려 쓰는지(올린 이미지가 작거나, 빌린 보관본이 작음) */
function blurry(slot: FaviconSlot) {
  const now = currentOf(slot);
  if (slot.from === "upload") return !!now && !now.vector && now.width < slot.size;
  return slot.from === "scaled" && (slot.sourceSide ?? 0) < slot.size;
}

/** 바뀐 상태를 받는다. 파비콘이 바뀌었으면 열린 탭의 아이콘도 바꿔 끼운다 */
function apply(next: FaviconSlots) {
  if (state.value && state.value.version !== next.version) refreshFavicon(next.version);
  state.value = next;
  loadError.value = "";
}

async function run(job: () => Promise<void>) {
  busy.value = true;
  try {
    await job();
  } finally {
    busy.value = false;
  }
}

/** 올리기 전에 화면에서 거른다(서버도 다시 본다). 까닭이 있으면 그 글. 래스터면 크기도 돌려준다 */
async function check(file: File): Promise<{ why: string; width: number; height: number }> {
  const no = (why: string) => ({ why, width: 0, height: 0 });
  if (!TYPES.includes(file.type)) return no(T.refuse.format(file.name));
  if (file.size > APPEARANCE_MAX_BYTES) return no(T.refuse.tooBig(file.name, formatBytes(APPEARANCE_MAX_BYTES)));
  if (file.type === "image/svg+xml") return { why: "", width: 0, height: 0 };
  try {
    const { width, height } = await createImageBitmap(file);
    if (Math.min(width, height) < FAVICON_MIN_SIDE) return no(T.refuse.tooSmall(file.name, FAVICON_MIN_SIDE));
    return { why: "", width, height };
  } catch {
    return no(T.refuse.unreadable(file.name));
  }
}

/** 그 크기에 추가한다. 정사각형이 아니면 이미지 편집 대화상자를 먼저 띄운다 */
async function choose(size: number, file: File) {
  const { why, width, height } = await check(file);
  if (why) return notify({ title: T.refusedTitle, body: why, severity: "warning" });
  if (file.type !== "image/svg+xml" && width !== height) {
    cropFile.value = file;
    cropSize.value = size;
    cropping.value = true;
    return;
  }
  await run(() => send(size, file));
}

async function send(size: number, file: File) {
  try {
    apply((await axios.put<FaviconSlots>(`${API}/${size}`, file, { headers: { "Content-Type": file.type } })).data);
    notifyDone(T.uploaded(size));
  } catch (err) {
    notifyProblem(err, T.uploadFailed(file.name));
  }
}

function onCropped(blob: Blob) {
  const name = cropFile.value?.name.replace(/\.[^.]+$/, "") ?? "favicon";
  void run(() => send(cropSize.value, new File([blob], `${name}.png`, { type: "image/png" })));
}

/** 팝업의 이미지 업로드: 팝업을 닫고 파일을 고른다(같은 누름 안에서 열어야 브라우저가 파일 창을 띄운다) */
function uploadFromDialog() {
  if (dialogFor.value === null) return;
  pickingFor = dialogFor.value;
  dialogFor.value = null;
  fileInput.value?.click();
}

/** 팝업의 링크로 추가: 봇이 대신 받아 넘긴 이미지를 업로드와 같은 길로(정사각형이 아니면 편집 대화상자) */
function fromLink(url: string) {
  const size = dialogFor.value;
  if (size === null) return;
  void run(async () => {
    let file: File;
    try {
      const res = await axios.post<Blob>(`${API}/fetch`, { url }, { responseType: "blob" });
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "link") || "link";
      file = new File([res.data], name, { type: res.data.type });
    } catch (err) {
      // 봇이 까닭을 문제 코드로 답한다(가져오지 못함 · 이미지가 아님)
      notifyProblem(err, T.slotDialog.linkFailed);
      return;
    }
    dialogFor.value = null;
    busy.value = false;
    await choose(size, file);
  });
}
function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void choose(pickingFor, file);
}
function onDrop(event: DragEvent, size: number) {
  over.value = null;
  const file = event.dataTransfer?.files?.[0];
  if (file) void choose(size, file);
}

/** 그 크기를 비운다(기록은 남는다) */
const clear = (size: number) =>
  run(async () => {
    try {
      apply((await axios.delete<FaviconSlots>(`${API}/${size}`)).data);
      notifyDone(T.cleared(size));
    } catch (err) {
      notifyProblem(err, T.clearFailed(size));
    }
  });

/** 기록의 이미지로 갈아 끼운다 */
const useImage = (id: string) => {
  const size = dialogFor.value;
  if (size === null) return;
  return run(async () => {
    try {
      apply((await axios.put<FaviconSlots>(`${API}/${size}/current`, { id })).data);
      notifyDone(T.history.used(size));
    } catch (err) {
      notifyProblem(err, T.history.useFailed(size));
    }
  });
};

/** 기록에서 삭제한다(지금 쓰는 이미지면 그 크기도 빈다) */
const removeImage = (id: string) => {
  const size = dialogFor.value;
  if (size === null) return;
  return run(async () => {
    try {
      apply((await axios.delete<FaviconSlots>(`${API}/${size}/history/${id}`)).data);
      notifyDone(T.history.removed(size));
    } catch (err) {
      notifyProblem(err, T.history.removeFailed(size));
    }
  });
};

onMounted(async () => {
  try {
    apply((await axios.get<FaviconSlots>(API)).data);
  } catch (err) {
    loadError.value = problemText(err, T.loadFailed);
  }
});
</script>
