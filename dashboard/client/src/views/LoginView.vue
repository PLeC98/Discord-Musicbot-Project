<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">
        <img v-if="botAvatar" :src="botAvatar" :alt="botName" class="bot-avatar" />
        <span v-else>🎵</span>
      </div>
      <h1>{{ botName || "MusicBot" }} 대시보드</h1>
      <p>Discord 계정으로 로그인하세요</p>

      <a href="/auth/login" class="btn btn-primary discord-btn">
        <svg width="18" height="14" viewBox="0 0 71 55" fill="none">
          <path
            d="M60.1 4.9A58.5 58.5 0 0 0 45.4.7a40.3 40.3 0 0 0-1.8 3.7 54.1 54.1 0 0 0-16.3 0 38.3 38.3 0 0 0-1.8-3.7 58.4 58.4 0 0 0-14.7 4.2C1.5 18.2-.9 31 .3 43.6a58.9 58.9 0 0 0 17.9 9.1 44.4 44.4 0 0 0 3.8-6.2 38.2 38.2 0 0 1-6-2.9l1.4-1.1c11.6 5.4 24.1 5.4 35.5 0l1.5 1a38.2 38.2 0 0 1-6 2.9 43.9 43.9 0 0 0 3.8 6.2 58.7 58.7 0 0 0 17.9-9c1.5-15.3-2.5-28-10.6-38.7Zm-36.8 31c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.2 6.4 7.2 0 4-2.8 7.2-6.4 7.2Zm23.6 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.2 6.4 7.2 0 4-2.8 7.2-6.4 7.2Z"
            fill="currentColor"
          />
        </svg>
        Discord로 로그인
      </a>

      <p v-if="error" class="error-text">{{ errorText }}</p>
    </div>

    <a v-if="sourceRepo" :href="sourceRepo" target="_blank" rel="noopener" class="source-link">
      Source Code (AGPL-3.0)
    </a>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStore } from "../stores/user.js";
import axios from "axios";

const route = useRoute();
const router = useRouter();
const user = useUserStore();

const botAvatar = ref(null);
const botName = ref("");
const sourceRepo = ref(null);

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
  } catch {
    /* 봇 준비 전이면 기본 이모지로 폴백 */
  }
});
</script>

<style scoped>
.login-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 20px;
}

.login-card {
  background: rgba(12, 16, 36, 0.78);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  padding: 32px 44px 42px 44px;
  text-align: center;
  width: 380px;
  box-shadow:
    0 8px 40px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.login-logo {
  font-size: 3.5rem;
  margin-bottom: 20px;
  display: flex;
  justify-content: center;
  filter: drop-shadow(0 0 20px rgba(124, 111, 246, 0.45));
}

.bot-avatar {
  width: 128px;
  height: 128px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.14);
  box-shadow:
    0 0 0 4px rgba(124, 111, 246, 0.28),
    0 8px 28px rgba(0, 0, 0, 0.45);
}

h1 {
  font-size: 1.6rem;
  margin-bottom: 8px;
  font-weight: 800;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #e8eaf6 0%, #c4b5fd 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

p {
  color: var(--text-muted);
  margin-bottom: 32px;
  font-size: 0.9rem;
}

.discord-btn {
  font-size: 0.95rem;
  padding: 12px 24px;
  justify-content: center;
  width: 100%;
  border-radius: 14px;
}

.error-text {
  color: var(--danger);
  margin-top: 16px;
  margin-bottom: 0;
}

/* 우측 하단의 은은한 소스 공개 링크 (AGPL 13조 고지) */
.source-link {
  position: fixed;
  right: 14px;
  bottom: 10px;
  font-size: 0.72rem;
  color: var(--text-muted);
  opacity: 0.45;
  text-decoration: none;
  transition: opacity 0.2s;
}

.source-link:hover {
  opacity: 0.9;
  text-decoration: underline;
}

</style>
