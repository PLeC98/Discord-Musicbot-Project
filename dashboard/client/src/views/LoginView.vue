<template>
  <div class="flex items-center justify-center min-h-screen p-4">
    <div class="text-center rounded-3xl bg-[rgba(12,16,36,0.78)] backdrop-blur-2xl backdrop-saturate-[1.8] border border-white/10 pt-8 px-11 pb-10.5 w-95 shadow-[0_8px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)]">
      <div class="text-[3.5rem] mb-5 flex justify-center drop-shadow-[0_0_20px_rgba(124,111,246,0.45)]">
        <img v-if="botAvatar" :src="botAvatar" :alt="botName" class="size-32 rounded-full border-[3px] border-white/14 shadow-[0_0_0_4px_rgba(124,111,246,0.28),0_8px_28px_rgba(0,0,0,0.45)]" />
        <Icon v-else name="music" :size="56" class="text-accent" />
      </div>
      <h1 class="text-[1.6rem] mb-2 font-extrabold tracking-[-0.02em] bg-linear-135 from-[#e8eaf6] to-[#c4b5fd] bg-clip-text text-transparent">{{ botName || "MusicBot" }} 대시보드</h1>
      <p class="text-muted mb-8 text-[0.9rem]">Discord 계정으로 로그인하세요</p>

      <BaseButton variant="primary" size="lg" href="/auth/login">
        <svg width="18" height="14" viewBox="0 0 71 55" fill="none">
          <path
            d="M60.1 4.9A58.5 58.5 0 0 0 45.4.7a40.3 40.3 0 0 0-1.8 3.7 54.1 54.1 0 0 0-16.3 0 38.3 38.3 0 0 0-1.8-3.7 58.4 58.4 0 0 0-14.7 4.2C1.5 18.2-.9 31 .3 43.6a58.9 58.9 0 0 0 17.9 9.1 44.4 44.4 0 0 0 3.8-6.2 38.2 38.2 0 0 1-6-2.9l1.4-1.1c11.6 5.4 24.1 5.4 35.5 0l1.5 1a38.2 38.2 0 0 1-6 2.9 43.9 43.9 0 0 0 3.8 6.2 58.7 58.7 0 0 0 17.9-9c1.5-15.3-2.5-28-10.6-38.7Zm-36.8 31c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.2 6.4 7.2 0 4-2.8 7.2-6.4 7.2Zm23.6 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.2 6.4 7.2 0 4-2.8 7.2-6.4 7.2Z"
            fill="currentColor"
          />
        </svg>
        Discord로 로그인
      </BaseButton>

      <p v-if="error" class="text-danger mt-4 text-[0.9rem]">{{ errorText }}</p>
    </div>

    <!-- 우측 하단의 은은한 소스 공개 링크 (AGPL 13조 고지) -->
    <div class="fixed right-3.5 bottom-2.5 flex flex-col items-end gap-0.5">
      <a v-if="!sourceRepo || projectRepo === sourceRepo" :href="sourceRepo" target="_blank" rel="noopener" :class="sourceLink">Source Code (AGPL-3.0)</a>
      <template v-else>
        <a :href="projectRepo" target="_blank" rel="noopener" :class="sourceLink"> Modified Source Code (AGPL-3.0) </a>
        <a :href="sourceRepo" target="_blank" rel="noopener" :class="sourceLink"> Original Source Code (AGPL-3.0) </a>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStore } from "../stores/user.js";
import Icon from "../components/BaseIcon.vue";
import axios from "axios";
import BaseButton from "../components/BaseButton.vue";

const sourceLink = "text-[0.72rem] text-muted opacity-45 no-underline transition-opacity duration-200 hover:opacity-90 hover:underline";

const route = useRoute();
const router = useRouter();
const user = useUserStore();

const botAvatar = ref(null);
const botName = ref("");
const sourceRepo = ref(null);
const projectRepo = ref(null);

const error = computed(() => route.query.error);
const errorText = computed(() => {
  if (error.value === "auth_failed") return "인증에 실패했습니다. 다시 시도해주세요.";
  if (error.value === "no_code") return "인증 코드를 받지 못했습니다.";
  return "알 수 없는 오류가 발생했습니다.";
});

onMounted(async () => {
  if (user.isLoggedIn) {
    router.replace("/dashboard");
    return;
  }
  try {
    const res = await axios.get("/api/bot");
    botAvatar.value = res.data.avatarUrl;
    botName.value = res.data.name;
    sourceRepo.value = res.data.sourceRepo;
    projectRepo.value = res.data.projectRepo;
  } catch {
    /* 봇 준비 전이면 기본 이모지로 폴백 */
  }
});
</script>
