<template>
  <!-- 라이선스(M3 대화상자, 설정 대화상자와 같은 모양): 이 봇(AGPL · 소스 코드 링크) · 포크해 온 원본(MIT) · 화면이 내보내는 글꼴 · 그림 · 라이브러리 · 봇이 함께 배포하는 데이터(data/).
       이 봇의 소스는 로그인 화면과 같은 기준: 운영자가 고친 소스(SOURCE_REPO_URL)가 원본 프로젝트와 다르면 둘 다, 같으면 하나. 주소를 못 받으면 링크 없이 알린다.
       줄을 누르면 그 저장소 · 누리집을 새 창으로 연다 -->
  <Teleport to="body">
    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
      <div v-if="open" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" @click.self="close">
        <div ref="dialogEl" role="dialog" aria-modal="true" aria-labelledby="license-title" class="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-surface-container-high animate-[art-in_350ms_var(--ease-spring-fast)] [&::-webkit-scrollbar-track]:my-(--sb-inset-dialog)" :class="overflowing ? 'py-6 pl-6 pr-5.25' : 'p-6'">
          <div class="flex items-center gap-3 mb-4">
            <span class="size-9 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center"><Icon name="license" :size="20" /></span>
            <h3 id="license-title" class="flex-1 text-xl font-round font-semibold">{{ T.title }}</h3>
            <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="text.common.close" @click="close"><Icon name="close" :size="20" /></button>
          </div>

          <div class="text-label font-semibold text-primary mb-2">{{ T.thisBot }}</div>
          <div class="flex flex-col mb-4">
            <template v-if="sourceRepo">
              <a :href="sourceRepo" target="_blank" rel="noopener" :class="row">
                <span class="flex-1 min-w-0">
                  <span class="block text-body font-medium truncate">{{ botName || T.thisBot }}</span>
                  <span class="block text-label text-on-surface-variant">GNU AGPL-3.0-or-later · {{ modified ? T.runningSourceModified : T.runningSource }}</span>
                </span>
                <Icon name="open_in_new" :size="20" class="shrink-0 text-on-surface-variant" />
              </a>
              <a v-if="modified" :href="projectRepo" target="_blank" rel="noopener" :class="row">
                <span class="flex-1 min-w-0">
                  <span class="block text-body font-medium truncate">{{ T.originalProject }}</span>
                  <span class="block text-label text-on-surface-variant">GNU AGPL-3.0-or-later · {{ T.originalSource }}</span>
                </span>
                <Icon name="open_in_new" :size="20" class="shrink-0 text-on-surface-variant" />
              </a>
            </template>
            <div v-else :class="row">
              <span class="flex-1 min-w-0">
                <span class="block text-body font-medium truncate">{{ botName || T.thisBot }}</span>
                <span class="block text-label text-on-surface-variant">GNU AGPL-3.0-or-later · {{ T.sourceUnknown }}</span>
              </span>
            </div>
            <a :href="UPSTREAM.url" target="_blank" rel="noopener" :class="row">
              <span class="flex-1 min-w-0">
                <span class="block text-body font-medium truncate">{{ UPSTREAM.name }}</span>
                <span class="block text-label text-on-surface-variant">{{ UPSTREAM.license }} · {{ T.upstreamPart }}</span>
              </span>
              <Icon name="open_in_new" :size="20" class="shrink-0 text-on-surface-variant" />
            </a>
          </div>

          <template v-for="group in GROUPS" :key="group.title">
            <div class="text-label font-semibold text-primary mb-2">{{ group.title }}</div>
            <div class="flex flex-col mb-4 last:mb-0">
              <a v-for="item in group.items" :key="item.name" :href="item.url" target="_blank" rel="noopener" :class="row">
                <span class="flex-1 min-w-0">
                  <span class="block text-body font-medium truncate">{{ item.name }}</span>
                  <span class="block text-label text-on-surface-variant"
                    >{{ item.license }}<template v-if="item.note"> · {{ item.note }}</template></span
                  >
                </span>
                <Icon name="open_in_new" :size="20" class="shrink-0 text-on-surface-variant" />
              </a>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import { onKeyStroke } from "@vueuse/core";
import { computed, ref, watch } from "vue";
import axios from "axios";
import Icon from "./BaseIcon.vue";
import { useOverflowing } from "../composables/overflowing.ts";
import { DATA_FILES, FONTS_AND_ART, LIBRARIES, UPSTREAM, isModifiedSource } from "../utils/licenses.ts";
import type { BotInfo } from "../../../src/dashboard/contract/identity.ts";
import { text } from "../text/index.ts";
const T = text.licenses;

// 내용이 화면보다 길면 구른다. 넘칠 때 오른쪽 여백을 3 줄여 막대까지가 왼쪽 여백과 같게
const dialogEl = ref<HTMLElement | null>(null);
const overflowing = useOverflowing(dialogEl);

const open = defineModel<boolean>({ required: true });
const close = () => (open.value = false);
onKeyStroke("Escape", () => open.value && close());

const GROUPS = [
  { title: T.groupFontsArt, items: FONTS_AND_ART },
  { title: T.groupLibraries, items: LIBRARIES },
  { title: T.groupData, items: DATA_FILES },
];

// 봇 이름 · 소스 저장소(AGPL 의 소스 제공. 서버의 SOURCE_REPO_URL, 없으면 원본 프로젝트)는 열 때 읽는다
const botName = ref("");
const sourceRepo = ref("");
const projectRepo = ref("");
/** 운영자가 고친 소스를 따로 공개했다(원본과 주소가 다르다) */
const modified = computed(() => isModifiedSource(sourceRepo.value, projectRepo.value));
watch(open, async (isOpen) => {
  if (!isOpen || sourceRepo.value) return;
  try {
    const { data } = await axios.get<BotInfo>("/api/bot", { quietSession: true });
    botName.value = data.name ?? "";
    sourceRepo.value = data.sourceRepo;
    projectRepo.value = data.projectRepo;
  } catch {
    // 못 읽으면 이름 없이, 소스 줄은 링크 없이 못 불러왔다고 알린다(다음에 열 때 다시 읽는다)
  }
});

// 설정 대화상자의 줄과 같은 모양(높이 56 이상, 누르면 새 창)
const row = "state-layer -mx-3 px-3 py-2 min-h-14 rounded-2xl flex items-center gap-4 no-underline text-on-surface";
</script>
