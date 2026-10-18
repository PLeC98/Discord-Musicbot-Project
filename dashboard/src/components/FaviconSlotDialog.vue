<template>
  <!-- 파비콘 한 크기의 팝업(추가하기 · 변경).
       위: 이미지 업로드(파일 선택) · 링크로 추가(누르면 주소 입력란이 열린다, 봇이 대신 다운로드해 넘긴다). 아래: 기록(최근 FAVICON_HISTORY 개, 새것부터
       행을 누르면 그 이미지를 쓴다, 미리 보기 · 업로드한 때 · 쓰고 있으면 칠하고 "사용 중", 행 안 오른쪽 끝에 기록에서 삭제). 바깥을 누르거나 Esc 면 닫는다 -->
  <Teleport to="body">
    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
      <div v-if="open && entry" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" tabindex="-1" @click.self="open = false" @keydown.esc="open = false">
        <div role="dialog" aria-modal="true" :aria-label="D.title(entry.size)" class="rounded-2xl bg-surface-container-high p-5 w-full max-w-md max-h-[90dvh] overflow-y-auto flex flex-col gap-4 animate-[art-in_350ms_var(--ease-spring-fast)]">
          <div class="flex flex-col gap-1">
            <h3 class="text-xl font-round font-semibold">{{ D.title(entry.size) }}</h3>
            <p class="text-sm text-on-surface-variant">{{ D.maxSize(APPEARANCE_MAX_BYTES) }}</p>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="tap state-layer flex flex-col items-center gap-1 rounded-2xl bg-surface-container-highest px-3 py-4 cursor-pointer disabled:opacity-38" :disabled="busy" @click="emit('upload')">
              <Icon name="upload" :size="24" />
              <span class="text-sm font-semibold">{{ D.fromFile }}</span>
              <span class="text-2xs text-on-surface-variant">{{ D.fromFileHint }}</span>
            </button>
            <button type="button" class="tap state-layer flex flex-col items-center gap-1 rounded-2xl px-3 py-4 cursor-pointer disabled:opacity-38" :class="linking ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-highest'" :disabled="busy" @click="toggleLink">
              <Icon name="link" :size="24" />
              <span class="text-sm font-semibold">{{ D.fromLink }}</span>
            </button>
          </div>
          <form v-if="linking" class="flex flex-col gap-1" @submit.prevent="submitLink">
            <label class="text-xs text-on-surface-variant" for="favicon-link">{{ D.linkLabel }}</label>
            <span class="flex gap-2">
              <input id="favicon-link" ref="linkInput" v-model.trim="link" type="url" inputmode="url" :placeholder="D.linkPlaceholder" class="flex-1 min-w-0 h-10 rounded-xl bg-surface-container px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary" />
              <BaseButton type="submit" :disabled="busy || !link">{{ D.linkFetch }}</BaseButton>
            </span>
            <span v-if="linkError" class="text-xs text-error">{{ linkError }}</span>
          </form>

          <section v-if="entry.history.length" class="flex flex-col gap-1">
            <h4 class="text-sm font-semibold">{{ H.title }}</h4>
            <p class="text-xs text-on-surface-variant mb-1">{{ H.desc(FAVICON_HISTORY) }}</p>
            <ul class="flex flex-col gap-1">
              <li v-for="one in entry.history" :key="one.id" class="relative">
                <!-- 행을 누르면 그 이미지를 쓴다. 쓰고 있는 행은 칠하고 "사용 중". 삭제 버튼은 행 안 오른쪽 끝에 겹쳐 둔다(버튼 안에 버튼을 넣을 수 없어서 형제로) -->
                <button type="button" class="tap state-layer w-full flex items-center gap-3 rounded-(--r-row) py-2 pl-2 pr-12 text-left disabled:cursor-default" :class="one.id === entry.current ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container cursor-pointer'" :aria-current="one.id === entry.current" :disabled="busy || one.id === entry.current" @click="emit('use', one.id)">
                  <span class="flex items-center justify-center size-16 shrink-0 rounded-xl bg-surface-container-highest">
                    <img :src="`/api/admin/appearance/favicon/${entry.size}/history/${one.id}`" alt="" :style="{ width: `${Math.min(entry.size, 64)}px`, height: `${Math.min(entry.size, 64)}px` }" />
                  </span>
                  <span class="flex-1 min-w-0 text-sm nums">{{ H.meta(one.at) }}</span>
                  <span v-if="one.id === entry.current" class="flex items-center gap-1 text-xs font-semibold"><Icon name="check" :size="16" />{{ H.inUse }}</span>
                </button>
                <button type="button" :class="[ICON_BTN, 'size-8']" class="absolute right-2 top-1/2 -translate-y-1/2 hover:text-error" :disabled="busy" :aria-label="H.removeOne" v-tooltip="H.removeOne" @click="emit('remove', one.id)"><Icon name="delete" :size="18" /></button>
              </li>
            </ul>
          </section>

          <div class="flex justify-end">
            <BaseButton variant="ghost" @click="open = false">{{ text.common.close }}</BaseButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import { ICON_BTN } from "../utils/icon-button.ts";
import { text } from "../text/index.ts";
const H = text.appearance.history;
const D = text.appearance.slotDialog;
import { APPEARANCE_MAX_BYTES, FAVICON_HISTORY, type FaviconSlot } from "../../../src/dashboard/contract/appearance.ts";

/** entry: 보여 줄 크기(바뀌면 그대로 따라간다). busy: 요청 중이라 버튼을 막는다 */
defineProps<{ entry: FaviconSlot | null; busy: boolean }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ upload: []; link: [url: string]; use: [id: string]; remove: [id: string] }>();

const linking = ref(false);
const link = ref("");
const linkError = ref("");
const linkInput = ref<HTMLInputElement | null>(null);

// 열 때마다 주소 입력란을 닫고 비운다
watch(open, (on) => {
  if (!on) return;
  linking.value = false;
  link.value = "";
  linkError.value = "";
});

async function toggleLink() {
  linking.value = !linking.value;
  linkError.value = "";
  if (linking.value) {
    await nextTick();
    linkInput.value?.focus();
  }
}

function isWebUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** http · https 주소만 넘긴다(다운로드는 봇이 한다) */
function submitLink() {
  const ok = isWebUrl(link.value);
  linkError.value = ok ? "" : D.linkBad;
  if (ok) emit("link", link.value);
}
</script>
