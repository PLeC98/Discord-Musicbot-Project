<template>
  <div class="flex flex-col gap-(--gap-in)">
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>

    <!-- 파비콘: 크기마다 무엇을 내는지 보이고, 올린 그림을 늘어놓는다. 끌어다 놓아도 된다(여러 장) -->
    <BaseCard icon="tab" :title="T.favicon">
      <template #actions><DocLink file="docs/favicon.md" /></template>
      <p class="mb-3 flex items-center gap-1 text-sm text-on-surface-variant">{{ T.faviconDesc }}<Icon name="info" :size="16" class="shrink-0 cursor-help" v-tooltip="T.faviconTip" /></p>

      <!-- 크기마다: 실제 크기 그대로(큰 것은 64 로 줄여) · 어디서 왔는지 -->
      <div class="flex flex-wrap items-end gap-x-4 gap-y-3 mb-4">
        <div v-for="use in state?.favicon.sizes ?? []" :key="use.size" class="flex flex-col items-center gap-1">
          <span class="flex items-center justify-center size-16 rounded-xl bg-surface-container-high">
            <img v-if="use.from !== 'none'" :src="`/favicon/${use.size}?v=${state!.favicon.version}`" alt="" :style="{ width: `${Math.min(use.size, 64)}px`, height: `${Math.min(use.size, 64)}px` }" />
            <Icon v-else name="block" :size="20" class="text-on-surface-variant" />
          </span>
          <span class="text-xs nums">{{ use.size }}</span>
          <span class="text-2xs text-on-surface-variant">{{ fromText(use) }}</span>
        </div>
      </div>

      <div class="flex flex-col gap-1 mb-3" :class="dragging && 'outline-2 outline-dashed outline-primary rounded-xl'" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
        <div v-for="one in state?.favicon.uploads ?? []" :key="one.id" class="flex items-center gap-3 h-12 px-2 rounded-(--r-row)">
          <img :src="`/api/admin/appearance/favicon/${one.id}`" alt="" class="size-8 shrink-0 rounded-md object-contain" />
          <span class="flex-1 min-w-0 text-sm nums">{{ one.side === null ? "SVG" : `${one.side} × ${one.side}` }}</span>
          <span class="text-xs text-on-surface-variant nums">{{ formatBytes(one.bytes) }}</span>
          <button type="button" :class="[ICON_BTN, 'size-10']" class="hover:text-error" :disabled="busy" :aria-label="T.removeOne" v-tooltip="T.removeOne" @click="removeIcon(one.id)"><Icon name="delete" :size="20" /></button>
        </div>
        <p v-if="state && !state.favicon.uploads.length" class="px-2 py-3 text-sm text-on-surface-variant">{{ T.noUploads }}</p>
      </div>

      <div class="flex items-center gap-2">
        <BaseButton :disabled="busy || !state" @click="iconInput?.click()"><Icon name="upload" :size="18" />{{ T.upload }}</BaseButton>
        <span class="text-xs text-on-surface-variant">{{ T.uploadHint }}</span>
      </div>
      <input ref="iconInput" type="file" multiple :accept="ICON_TYPES.join(',')" class="hidden" @change="onPick($event, uploadIcons)" />
    </BaseCard>
  </div>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import { problemText } from "../utils/problem.ts";
import { formatBytes } from "../../../src/ui/format.ts";
import { refreshFavicon } from "../utils/appearance.ts";
import { notify, notifyDone, notifyProblem } from "../composables/toasts.ts";
import { ref, onMounted } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import DocLink from "./DocLink.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import { APPEARANCE_MAX_BYTES, FAVICON_MIN_SIDE, type Appearance, type FaviconUse } from "../../../src/dashboard/contract/appearance.ts";
import { text } from "../text/index.ts";
const T = text.appearance;

const ICON_TYPES = ["image/png", "image/webp", "image/jpeg", "image/svg+xml"];

const state = ref<Appearance | null>(null);
const loadError = ref("");
const busy = ref(false);
const dragging = ref(false);
const iconInput = ref<HTMLInputElement | null>(null);

/** 그 크기가 어디서 왔는지 */
function fromText(use: FaviconUse) {
  if (use.from === "avatar") return T.from.avatar;
  if (use.from === "none") return T.from.none;
  if (use.from === "exact") return T.from.exact;
  const one = state.value?.favicon.uploads.find((up) => up.id === use.upload);
  return one?.side ? T.from.scaled(one.side) : T.from.stretched;
}

/** 바뀐 상태를 받는다. 파비콘이 바뀌었으면 열린 탭의 아이콘도 바꿔 끼운다 */
function apply(next: Appearance) {
  if (state.value && state.value.favicon.version !== next.favicon.version) refreshFavicon(next.favicon.version);
  state.value = next;
  loadError.value = "";
}

/** 올리기 전에 화면에서 거른다(서버도 다시 본다). 까닭이 있으면 그 글 */
async function refusal(file: File): Promise<string> {
  if (!ICON_TYPES.includes(file.type)) return T.refuse.format(file.name);
  if (file.size > APPEARANCE_MAX_BYTES) return T.refuse.tooBig(file.name, formatBytes(APPEARANCE_MAX_BYTES));
  if (file.type === "image/svg+xml") return "";
  try {
    const { width, height } = await createImageBitmap(file);
    if (width !== height) return T.refuse.notSquare(file.name, width, height);
    if (width < FAVICON_MIN_SIDE) return T.refuse.tooSmall(file.name, FAVICON_MIN_SIDE);
  } catch {
    return T.refuse.unreadable(file.name);
  }
  return "";
}

const put = (url: string, file: File) => axios.put<Appearance>(url, file, { headers: { "Content-Type": file.type } });

async function uploadIcons(files: File[]) {
  const refused: string[] = [];
  let done = 0;
  for (const file of files) {
    const why = await refusal(file);
    if (why) {
      refused.push(why);
      continue;
    }
    try {
      apply((await put("/api/admin/appearance/favicon", file)).data);
      done++;
    } catch (err) {
      notifyProblem(err, T.uploadFailed(file.name));
    }
  }
  if (refused.length) notify({ title: T.refusedTitle, body: refused.join("\n"), severity: "warning" });
  if (done) notifyDone(T.uploaded(done));
}

async function run(job: () => Promise<void>) {
  busy.value = true;
  try {
    await job();
  } finally {
    busy.value = false;
  }
}

function onPick(event: Event, upload: (files: File[]) => Promise<void>) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  void run(() => upload(files));
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length) void run(() => uploadIcons(files));
}

const removeIcon = (id: string) =>
  run(async () => {
    try {
      apply((await axios.delete<Appearance>(`/api/admin/appearance/favicon/${id}`)).data);
      notifyDone(T.removed);
    } catch (err) {
      notifyProblem(err, T.removeFailed);
    }
  });

onMounted(async () => {
  try {
    apply((await axios.get<Appearance>("/api/admin/appearance")).data);
  } catch (err) {
    loadError.value = problemText(err, T.loadFailed);
  }
});
</script>
