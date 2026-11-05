<template>
  <!-- M3 대화상자의 막과 판. 막은 검정 50%, 판은 surface-container-high, 모서리 28px, 그림자 없음, 넘김은 DialogTransition.
       바깥을 누르거나 Esc, 기기의 뒤로면 close 를 낸다. 닫을지는 부르는 쪽이 정한다(요청 중이면 무시하는 등).
       class, aria-label 같은 속성은 판에 붙는다 -->
  <Teleport to="body">
    <DialogTransition>
      <div v-if="open" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4" :class="layer === 'session' ? 'z-400' : 'z-300'" @click.self="outside && emit('close')">
        <div ref="panel" v-bind="$attrs" :role="role" aria-modal="true" class="dialog-panel rounded-2xl bg-surface-container-high" :class="[WIDTHS[width], scroll && SCROLL, padClass]">
          <slot />
        </div>
      </div>
    </DialogTransition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import DialogTransition from "./DialogTransition.vue";
import { useCloseLayer } from "../composables/close-layer.ts";
import { useOverflowing } from "../composables/overflowing.ts";

defineOptions({ inheritAttrs: false });

type Width = "sm" | "md" | "lg" | "xl" | "3xl" | "4xl" | "fit";

/**
 * open: 보이는가. width: 판의 최대 폭(sm 384px, md 448px, lg 512px, xl 576px, 3xl 768px, 4xl 896px, fit 은 내용 폭을 26rem ~ 48rem 안에서).
 * scroll: 판이 화면보다 길면 판 안에서 스크롤한다.
 * padding: 판 여백. dialog 24px, editor 20px(보는 창을 넓게 쓰는 편집 창. 그 창의 폭 추산이 이 여백에 기댄다), none 은 안이 스스로 둔다.
 * outside: 바깥을 누르면 닫는가. layer: session 이면 세션 띠 층(z 400)에 뜬다
 */
const props = withDefaults(defineProps<{ open: boolean; width?: Width; role?: "dialog" | "alertdialog"; scroll?: boolean; padding?: "dialog" | "editor" | "none"; outside?: boolean; layer?: "dialog" | "session" }>(), { width: "sm", role: "dialog", scroll: false, padding: "dialog", outside: true, layer: "dialog" });
const emit = defineEmits<{ close: [] }>();

const WIDTHS: Record<Width, string> = {
  sm: "w-full max-w-sm",
  md: "w-full max-w-md",
  lg: "w-full max-w-lg",
  xl: "w-full max-w-xl",
  "3xl": "w-full max-w-3xl",
  "4xl": "w-full max-w-4xl",
  fit: "w-fit min-w-[min(26rem,100%)] max-w-[min(48rem,100%)]",
};
// 스크롤바 트랙은 위아래를 판의 둥근 모서리만큼 비운다(WebKit 계열만)
const SCROLL = "max-h-[calc(100dvh-2rem)] overflow-y-auto [&::-webkit-scrollbar-track]:my-(--sb-inset-dialog)";

const panel = ref<HTMLElement | null>(null);
const overflowing = useOverflowing(panel);
const PADDING = { dialog: "p-6", editor: "p-5", none: "" } as const;
// 넘치는 동안은 스크롤바 몫(3px)만큼 오른쪽 여백을 줄여 막대까지가 왼쪽 여백과 같게 한다
const padClass = computed(() => (props.padding === "dialog" && props.scroll && overflowing.value ? "py-6 pl-6 pr-5.25" : PADDING[props.padding]));

useCloseLayer(
  computed(() => props.open),
  () => emit("close"),
);

/** panel: 판 요소(크기를 재는 쪽이 쓴다) */
defineExpose({ panel });
</script>
