<template>
  <!-- 세션 끝 · 연결 안 됨. 알림(ToastStack) 위에 남는 띠. 화면을 옮기지 않는다(고치던 설정을 지킨다) -->
  <div v-if="session.ended || session.offline" role="alert" class="pointer-events-auto flex gap-3 items-center rounded-full pl-2 pr-2 py-2 text-body pane-menu">
    <span class="size-9 shrink-0 rounded-full bg-error-container text-on-error-container flex items-center justify-center"><Icon name="cloud_off" :size="20" /></span>
    <span class="flex-1 min-w-0 text-on-surface font-medium">{{ session.ended ? loginNotice.title : unansweredTitle("offline") }}</span>
    <BaseButton v-if="session.ended" variant="primary" size="sm" @click="showDialog = true">{{ T.loginAgain }}</BaseButton>
    <BaseButton v-else variant="ghost" size="sm" :disabled="checking" @click="retry">{{ T.retry }}</BaseButton>
  </div>
  <!-- 실시간 연결만 끊겼다. 요청은 되므로 조작은 그대로 쓰고, 화면은 30초마다 다시 읽는다 -->
  <div v-else-if="session.streamDown" role="status" class="pointer-events-auto flex gap-3 items-center rounded-full pl-2 pr-4 py-2 text-body pane-menu">
    <span class="size-9 shrink-0 rounded-full bg-tertiary-container text-on-tertiary-container flex items-center justify-center"><Icon name="progress_activity" :size="20" class="animate-spin" /></span>
    <span class="flex-1 min-w-0 text-on-surface-variant">{{ T.reconnecting }}</span>
  </div>

  <!-- 다른 대화상자(ConfirmDialog)와 같은 모양: 가운데 아이콘 · 제목 · 설명, 오른쪽 아래 단추. 알림 띠보다 위(z-400).
       세션이 끝났을 때와 위험한 조작에 다시 로그인이 필요할 때(reauth, 세션은 살아 있다) 같은 대화상자를 쓴다 -->
  <Teleport to="body">
    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
      <div v-if="(session.ended || session.reauth) && showDialog" class="fixed inset-0 z-400 bg-black/50 flex items-center justify-center p-4" @click.self="close">
        <div role="dialog" aria-modal="true" class="rounded-2xl bg-surface-container-high p-6 max-w-md w-full text-center animate-[art-in_350ms_var(--ease-spring-fast)]">
          <span class="size-12 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center mx-auto mb-4"><Icon name="key" :size="24" /></span>
          <h3 class="mb-4 text-xl font-round font-semibold text-on-surface">{{ notice.title }}</h3>
          <p class="mb-1 text-sm text-on-surface-variant">{{ notice.body }}</p>
          <p class="mb-6 text-sm text-on-surface-variant">{{ session.ended ? T.loginAgainBody : T.reauthBody }}</p>
          <p v-if="note" class="mb-4 text-sm text-tertiary">{{ note }}</p>
          <p class="-mt-2 mb-6 text-on-surface-variant text-label">{{ session.ended ? codeLineOf("login-required", 401) : codeLineOf("reauth-required", 403) }}</p>
          <div class="flex gap-2 justify-end flex-wrap">
            <BaseButton variant="ghost" @click="close">{{ T.later }}</BaseButton>
            <BaseButton v-if="session.ended" variant="ghost" :disabled="checking" @click="check">{{ T.loggedIn }}</BaseButton>
            <BaseButton variant="primary" @click="openLogin">{{ T.loginInNewWindow }}</BaseButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import axios from "axios";
import Icon from "./BaseIcon.vue";
import BaseButton from "./BaseButton.vue";
import { session } from "../composables/session.ts";
import { useUserStore } from "../stores/user.ts";
import { codeLineOf, noticeText, unansweredTitle } from "../utils/problem.ts";
import { text } from "../text/index.ts";
const T = text.shell;

// 세션 끝은 서버가 401 로 거절할 때와 같은 문장(login-required), 다시 로그인은 reauth-required
const loginNotice = noticeText("login-required");
const notice = computed(() => (session.ended ? loginNotice : noticeText("reauth-required")));

const user = useUserStore();
const router = useRouter();
const showDialog = ref(false);
const checking = ref(false);
const note = ref("");

// 끝났다고 알게 된 때 한 번 띄운다. 닫아도 띠가 남는다. 다시 로그인은 거절당할 때마다 띄운다(띠는 없다)
watch(
  () => session.ended || session.reauth,
  (shown) => {
    showDialog.value = shown;
    note.value = "";
  },
);

function close() {
  showDialog.value = false;
  session.reauth = false;
}

function openLogin() {
  // 사용자가 누른 때에만 연다(그렇지 않으면 브라우저가 팝업으로 막는다)
  window.open("/auth/login", "_blank");
  // 다시 로그인은 세션이 살아 있어 확인할 것이 없다. 새 창에서 마친 뒤 돌아와 다시 저장하면 된다
  if (!session.ended) close();
}

async function check() {
  checking.value = true;
  note.value = (await user.resumeSession()) ? "" : T.notLoggedInYet;
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
    } else
      await axios.get("/api/me").catch(() => {
        /* 닿았는지만 본다. 닿으면 요청 한 곳이 띠를 걷는다 */
      });
  } finally {
    checking.value = false;
  }
}

// 다른 창에서 로그인하고 돌아오면 알아서 잇는다
const onReturn = () => {
  if (session.ended && !document.hidden) void user.resumeSession();
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
