<template>
  <!-- 이미지에서 쓸 영역을 선택하는 대화상자(파비콘의 이미지 편집하기). 틀은 aspect(가로 ÷ 세로)를 지킨다.
       "적용하기"를 누르면 선택한 영역을 원본 해상도로(긴 변 maxSide 까지) 잘라 png 로 넘긴다 -->
  <!-- 편집 창이라 여백이 20px 이다. 보는 창 폭을 재기 전의 추산(ImageCropper 의 room)도 이 여백으로 계산한다 -->
  <BaseDialog :open="open" width="xl" padding="editor" class="flex flex-col gap-3" :aria-label="T.title" @close="open = false">
    <h3 class="text-xl font-round font-semibold">{{ T.title }}</h3>
    <ImageCropper ref="cropper" :file="file" :aspect="aspect" />
    <p class="text-xs text-on-surface-variant nums">
      {{ T.picked(Math.round(sel.w), Math.round(sel.h)) }}<template v-if="target && sel.w < target"> · {{ T.tooSmall(target) }}</template>
    </p>
    <div class="flex gap-2 justify-end">
      <!-- 처음 열렸을 때의 틀(그 비율로 가장 크게, 가운데)로 되돌린다 -->
      <BaseButton variant="ghost" class="mr-auto" :disabled="!cropper?.ready" @click="cropper?.reset()">{{ T.reset }}</BaseButton>
      <BaseButton variant="ghost" @click="open = false">{{ text.common.cancel }}</BaseButton>
      <BaseButton :disabled="!cropper?.ready" @click="finish">{{ T.use }}</BaseButton>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import BaseDialog from "./BaseDialog.vue";
import BaseButton from "./BaseButton.vue";
import ImageCropper from "./ImageCropper.vue";
import { text } from "../text/index.ts";
const T = text.appearance.crop;

/** file: 자를 이미지. aspect: 가로 ÷ 세로(1 이면 정사각형). target: 쓸 크기(한 변 px, 그보다 작게 선택하면 알린다). maxSide: 넘기는 긴 변의 상한(쓰는 곳이 필요한 만큼, 안 주면 아주 큰 원본을 그대로 넘기지 않을 만큼) */
const props = withDefaults(defineProps<{ file: File | null; aspect: number; target?: number; maxSide?: number }>(), { target: undefined, maxSide: 2048 });
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ done: [blob: Blob] }>();

const cropper = ref<InstanceType<typeof ImageCropper> | null>(null);
const sel = computed(() => cropper.value?.sel ?? { x: 0, y: 0, w: 0, h: 0 });

/** 선택한 영역을 원본 해상도로(긴 변 maxSide 까지) 잘라 png 로 넘긴다. 회전, 반전은 편집 면과 같은 차례로 */
function finish() {
  const image = cropper.value?.image();
  if (!cropper.value || !image) return;
  const { sel: area, size, natural, rotate, flip } = cropper.value;
  const k = Math.min(1, props.maxSide / Math.max(area.w, area.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.w * k));
  canvas.height = Math.max(1, Math.round(area.h * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingQuality = "high";
  ctx.scale(k, k);
  ctx.translate(size.width / 2 - area.x, size.height / 2 - area.y);
  if (flip) ctx.scale(-1, 1);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(image, -natural.width / 2, -natural.height / 2);
  canvas.toBlob((blob) => {
    if (!blob) return;
    emit("done", blob);
    open.value = false;
  }, "image/png");
}
</script>
