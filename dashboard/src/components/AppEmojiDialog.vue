<template>
  <!-- 앱 이모지 추가 창(디스코드 서버 설정의 "이모지 추가" 창과 같은 편집): 정사각형 틀, 확대, 90도 회전, 좌우 반전, 이름, 미리보기.
       원본 파일과 편집 값을 그대로 보내고 봇이 원본에서 만든다(움직이는 GIF, WebP 가 움직임을 잃지 않게) -->
  <!-- 편집 창이라 여백이 20px 이다. 보는 창 폭을 재기 전의 추산(ImageCropper 의 room)도 이 여백으로 계산한다 -->
  <BaseDialog :open="open" width="xl" padding="editor" class="flex flex-col gap-3" :aria-label="T.title" @close="!busy && (open = false)">
    <h3 class="text-xl font-round font-semibold">{{ T.title }}</h3>
    <ImageCropper ref="cropper" :file="file" :aspect="1" turn />

    <!-- 이름과 미리보기: 넓으면 나란히, 좁으면 위아래 -->
    <div class="@container/emoji">
      <div class="flex flex-col gap-3 @md/emoji:flex-row @md/emoji:items-start">
        <label class="flex-1 min-w-0">
          <span :class="FIELD_LABEL">{{ T.name }}<span class="text-error" aria-hidden="true">*</span></span>
          <input v-model.trim="name" type="text" maxlength="32" required autocomplete="off" spellcheck="false" :class="[FIELD, 'w-full font-mono', issue && 'border-error!']" :aria-invalid="!!issue" @keydown.enter="!composing($event) && submit()" />
        </label>
        <div class="shrink-0">
          <span :class="FIELD_LABEL">{{ T.preview }}</span>
          <!-- 이 이모지가 실제로 그려지는 크기들, 큰 것부터. 어디의 크기인지는 툴팁으로 -->
          <div class="flex items-end gap-3 h-12">
            <span v-for="one in PREVIEWS" :key="one.where" class="relative overflow-hidden shrink-0" :style="{ width: `${one.px}px`, height: `${one.px}px` }" v-tooltip="T.previewAt(one.where, one.px)">
              <span v-if="cropper?.ready" class="absolute" :style="previewOf(one.px).box">
                <img :src="cropper.url" alt="" class="absolute max-w-none" :style="previewOf(one.px).image" draggable="false" />
              </span>
            </span>
          </div>
        </div>
      </div>
      <!-- 이름의 문제는 이름과 미리보기 줄 아래 폭 전체에 -->
      <p v-if="issue" class="mt-1 text-xs text-error">{{ issue }}</p>
    </div>

    <!-- 봇이 거절한 까닭(이미지, 한도 등). 알림은 이 창 아래에 깔려 창 안에 보인다 -->
    <NoticeBox v-if="failure" variant="note" tone="error" icon="cancel" class="mt-0!">
      <span class="min-w-0"
        ><span class="block font-medium">{{ failure.title }}</span
        ><span v-if="failure.body" class="block">{{ failure.body }}</span></span
      >
    </NoticeBox>

    <div class="flex gap-2 justify-end">
      <!-- 처음 열렸을 때(회전, 반전 없이, 가장 큰 정사각형, 가운데)로 되돌린다 -->
      <BaseButton variant="ghost" class="mr-auto" :disabled="!cropper?.ready || busy" @click="cropper?.reset()">{{ text.appearance.crop.reset }}</BaseButton>
      <BaseButton variant="ghost" :disabled="busy" @click="open = false">{{ text.common.cancel }}</BaseButton>
      <BaseButton :disabled="!canAdd" @click="submit">{{ T.add }}</BaseButton>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import axios from "axios";
import BaseDialog from "./BaseDialog.vue";
import BaseButton from "./BaseButton.vue";
import ImageCropper from "./ImageCropper.vue";
import { FIELD, FIELD_LABEL } from "../utils/field.ts";
import { composing } from "../utils/dom.ts";
import { problemNotice } from "../utils/problem.ts";
import NoticeBox from "./NoticeBox.vue";
import { LIMIT, problemCodeOf, replyOf } from "../utils/request.ts";
import { appEmojis, nameIssueText, nameProblem } from "../composables/app-emojis.ts";
import type { AppEmojiItem } from "../../../src/dashboard/contract/app-emojis.ts";
import { text } from "../text/index.ts";
const T = text.appEmojis.dialog;

/** file: 올릴 원본. 열 때마다 새 파일을 준다 */
const props = defineProps<{ file: File | null }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ added: [emoji: AppEmojiItem] }>();

/**
 * 미리보기 크기(px). 디스코드는 웹 클라이언트 CSS 의 값: 메시지 글 속 1.375em(16px 글), 이모지만 있는 메시지 3rem, 임베드 본문 18px, 음성 채널 상태 12px 글의 1.375em.
 * 대시보드는 선택기 칸과 장르 24px, 공지 미리보기 14px 글의 1.375em, 입력란 14px 글
 */
const PREVIEWS = [
  { px: 48, where: T.where.jumbo },
  { px: 24, where: T.where.picker },
  { px: 22, where: T.where.message },
  { px: 19.25, where: T.where.announcePreview },
  { px: 18, where: T.where.announce },
  { px: 16.5, where: T.where.voiceStatus },
  { px: 14, where: T.where.input },
];

const cropper = ref<InstanceType<typeof ImageCropper> | null>(null);
const name = ref("");
/** 봇이 거절한 이름의 까닭. 이름을 고치면 지운다 */
const refused = ref("");
const busy = ref(false);
/** 봇이 거절한 까닭(이름 밖의 것). 다시 추가하거나 다른 파일이면 지운다 */
const failure = ref<{ title: string; body: string } | null>(null);

/** 파일 이름에서 처음 이름을 만든다(영문, 숫자, 밑줄만). 규칙에 맞지 않으면 비운다 */
function nameFrom(file: File) {
  const base = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/\W+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return nameProblem(base, new Map()) ? "" : base;
}
watch(
  () => props.file,
  (file) => {
    name.value = file ? nameFrom(file) : "";
    refused.value = "";
    failure.value = null;
  },
  { immediate: true },
);
watch(name, () => (refused.value = ""));

// 형식, 다른 이모지의 이름은 화면이 바로 알린다
const issue = computed(() => {
  if (refused.value) return refused.value;
  if (!name.value) return "";
  const code = nameProblem(name.value, new Map(appEmojis.value.map((one) => [one.name, one.icon])));
  return nameIssueText(code) ?? "";
});
const canAdd = computed(() => !!cropper.value?.ready && !!name.value && !issue.value && !busy.value);

/** 미리보기 칸(px 정사각형)에 선택한 영역이 꽉 차게: 돌린 이미지 상자를 옮기고 그 안에 편집 면과 같은 돌림으로 */
function previewOf(px: number) {
  const { sel, size, imageStyle } = cropper.value!;
  const k = px / sel.w;
  return { box: { left: `${-sel.x * k}px`, top: `${-sel.y * k}px`, width: `${size.width * k}px`, height: `${size.height * k}px` }, image: imageStyle(k) };
}

async function submit() {
  const c = cropper.value;
  if (!canAdd.value || !c || !props.file) return;
  // 봇은 영역이 이미지 밖이면 거절한다. 정수로 맞춘 뒤 이미지 안에 넣는다
  const { size, sel } = c;
  const side = Math.max(1, Math.min(Math.round(sel.w), size.width, size.height));
  const left = Math.min(Math.max(0, Math.round(sel.x)), size.width - side);
  const top = Math.min(Math.max(0, Math.round(sel.y)), size.height - side);
  const params = { name: name.value, rotate: c.rotate, left, top, side, ...(c.flip && { flip: 1 }) };
  busy.value = true;
  failure.value = null;
  try {
    // 움직이는 이미지는 프레임마다 만들어 오래 걸릴 수 있다
    const { data } = await axios.post<AppEmojiItem>("/api/app-emojis", props.file, { params, headers: { "Content-Type": props.file.type }, timeout: LIMIT.long });
    open.value = false;
    emit("added", data);
  } catch (err) {
    const why = nameIssueText(problemCodeOf(replyOf(err)));
    if (why) refused.value = why;
    else failure.value = problemNotice(err, text.appEmojis.addFailed);
  } finally {
    busy.value = false;
  }
}
</script>
