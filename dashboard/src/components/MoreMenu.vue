<template>
  <!-- ⋯ 버튼과 그 메뉴. 메뉴는 카드의 overflow 에 잘리지 않게 body 로 빼고 좌표로 붙인다(버튼 오른쪽 끝에 맞춰 아래로, 아래가 모자라면 위로) -->
  <button ref="triggerEl" type="button" :class="buttonClass" aria-haspopup="menu" :aria-expanded="open" :aria-label="label" v-tooltip="open ? null : label" @click="toggle"><Icon name="more_vert" :size="20" /></button>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-270" @click="open = false" @contextmenu="open = false"></div>
    <Transition enter-from-class="opacity-0 scale-90" leave-to-class="opacity-0 scale-95" enter-active-class="transition-[opacity,scale] spring-fast" leave-active-class="transition-[opacity,scale] duration-150">
      <div v-if="open" role="menu" :style="pos" class="fixed z-280 min-w-48 p-2 rounded-3xl pane-menu" :class="placeAbove ? 'origin-bottom-right' : 'origin-top-right'">
        <button v-for="one in items" :key="one.label" type="button" role="menuitem" class="state-layer w-full flex items-center gap-3 h-10 px-3 rounded-full cursor-pointer text-body font-medium text-left" :class="one.danger ? 'text-error' : 'text-on-surface'" @click="pick(one)"><Icon :name="one.icon" :size="20" />{{ one.label }}</button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useCloseLayer } from "../composables/close-layer.ts";
import Icon from "./BaseIcon.vue";
import type { IconName } from "../icons.ts";

type Item = { label: string; icon: IconName; danger?: boolean; select: () => void };
defineProps<{ items: Item[]; label: string; buttonClass?: string | string[] }>();

const triggerEl = ref<HTMLElement | null>(null);
const open = ref(false);
useCloseLayer(open, () => (open.value = false));
const pos = ref<Record<string, string>>({});
const placeAbove = ref(false);

function toggle() {
  if (open.value) return void (open.value = false);
  const r = triggerEl.value?.getBoundingClientRect();
  if (!r) return;
  placeAbove.value = r.bottom > window.innerHeight * 0.7;
  const right = `${Math.round(Math.max(8, window.innerWidth - r.right))}px`;
  pos.value = placeAbove.value ? { right, bottom: `${Math.round(window.innerHeight - r.top + 8)}px` } : { right, top: `${Math.round(r.bottom + 8)}px` };
  open.value = true;
}

function pick(one: Item) {
  open.value = false;
  one.select();
}

// 창 크기가 바뀌면 좌표가 어긋난다. 다시 계산하는 대신 닫는다
const onResize = () => (open.value = false);
onMounted(() => window.addEventListener("resize", onResize));
onUnmounted(() => window.removeEventListener("resize", onResize));
</script>
