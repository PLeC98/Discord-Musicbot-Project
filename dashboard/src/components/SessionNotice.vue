<template>
  <!-- 세션 끝 · 연결 안 됨. 알림(ToastStack) 위에 남는 띠. 화면을 옮기지 않는다(고치던 설정을 지킨다) -->
  <div v-if="session.ended || session.offline" role="alert" class="pointer-events-auto flex gap-2.5 items-center rounded-xl px-3.5 py-2.5 text-[0.85rem] bg-[rgba(12,16,36,0.92)] backdrop-blur-xl border border-danger/40 shadow-[0_8px_28px_rgba(0,0,0,0.5)]">
    <Icon name="error" :size="16" class="shrink-0 text-danger" />
    <span class="flex-1 min-w-0 text-fg">{{ session.ended ? "로그인이 만료됐어요." : "봇에 연결할 수 없어요." }}</span>
    <BaseButton v-if="session.ended" variant="primary" size="sm" @click="showDialog = true">다시 로그인</BaseButton>
    <BaseButton v-else variant="ghost" size="sm" :disabled="checking" @click="retry">다시 시도</BaseButton>
  </div>
  <!-- 실시간 연결만 끊겼다. 요청은 되므로 조작은 그대로 쓰고, 화면은 30초마다 다시 읽는다 -->
  <div v-else-if="session.streamDown" role="status" class="pointer-events-auto flex gap-2.5 items-center rounded-xl px-3.5 py-2 text-[0.8rem] bg-[rgba(12,16,36,0.92)] backdrop-blur-xl border border-warning/35 shadow-[0_8px_28px_rgba(0,0,0,0.5)]">
    <Icon name="spinner" :size="14" class="shrink-0 text-warning animate-spin" />
    <span class="flex-1 min-w-0 text-fg-soft">실시간 갱신을 다시 잇는 중이에요.</span>
  </div>

  <Teleport to="body">
    <div v-if="session.ended && showDialog" class="fixed inset-0 bg-black/65 backdrop-blur-[6px] flex items-center justify-center z-400 p-4" @click.self="showDialog = false">
      <div role="dialog" aria-modal="true" class="bg-[rgba(12,16,36,0.88)] backdrop-blur-2xl backdrop-saturate-[1.8] border border-white/12 rounded-[20px] p-8 max-w-100 w-full text-center shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <p class="mb-2 text-[0.95rem] text-fg">로그인이 만료됐어요.</p>
        <p class="mb-1 text-[0.82rem] text-fg-soft">로그인한 지 오래됐거나 로그아웃해서 이 탭의 요청을 받을 수 없어요.</p>
        <p class="mb-5.5 text-[0.82rem] text-muted">새 창에서 다시 로그인한 뒤 이 탭으로 돌아오면 이어서 쓸 수 있어요. 고치던 내용은 그대로 남아 있어요.</p>
        <p v-if="note" class="mb-4 text-[0.82rem] text-warning">{{ note }}</p>
        <div class="flex gap-2.5 justify-center">
          <BaseButton variant="ghost" @click="showDialog = false">나중에</BaseButton>
          <BaseButton variant="ghost" :disabled="checking" @click="check">로그인했어요</BaseButton>
          <BaseButton variant="primary" @click="openLogin">새 창에서 로그인</BaseButton>
        </div>
        <p class="mt-4 text-muted text-[0.75rem]">오류 코드: login-required (HTTP 401)</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import axios from "axios";
import Icon from "./BaseIcon.vue";
import BaseButton from "./BaseButton.vue";
import { session } from "../composables/session.js";
import { useUserStore } from "../stores/user.js";

const user = useUserStore();
const router = useRouter();
const showDialog = ref(false);
const checking = ref(false);
const note = ref("");

// 끝났다고 알게 된 때 한 번 띄운다. 닫아도 띠가 남는다
watch(
  () => session.ended,
  (ended) => {
    showDialog.value = ended;
    note.value = "";
  },
);

function openLogin() {
  // 사용자가 누른 때에만 연다(그렇지 않으면 브라우저가 팝업으로 막는다)
  window.open("/auth/login", "_blank");
}

async function check() {
  checking.value = true;
  note.value = (await user.resumeSession()) ? "" : "아직 로그인되지 않았어요. 새 창에서 로그인을 마쳐 주세요.";
  checking.value = false;
}

// 연결 안 됨: 로그인했는지도 모르던 처음이면 다시 묻고 가려던 곳으로, 그 뒤라면 한 번 닿아 본다(닿으면 띠가 걷힌다)
async function retry() {
  checking.value = true;
  try {
    if (!user.fetched) {
      await user.fetchMe();
      if (user.fetched) await router.replace(window.location.pathname + window.location.search + window.location.hash);
      // 서버 오류(5xx)면 답은 왔지만 여전히 모른다. 띠를 남겨 다시 시도할 수 있게
      else session.offline = true;
    } else await axios.get("/api/me").catch(() => {});
  } finally {
    checking.value = false;
  }
}

// 다른 창에서 로그인하고 돌아오면 알아서 잇는다
const onReturn = () => {
  if (session.ended && !document.hidden) user.resumeSession();
};
onMounted(() => {
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
});
onUnmounted(() => {
  window.removeEventListener("focus", onReturn);
  document.removeEventListener("visibilitychange", onReturn);
});
</script>
