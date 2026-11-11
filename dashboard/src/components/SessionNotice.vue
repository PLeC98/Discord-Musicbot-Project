<template>
  <!-- 세션 끝, 연결 안 됨. 알림(ToastStack) 위에 남는 띠. 화면을 옮기지 않는다(고치던 설정을 지킨다) -->
  <!-- 알림(ToastStack)처럼 위에서 내려오고 오른쪽으로 빠진다 -->
  <Transition name="toast" mode="out-in">
    <!-- 다른 탭에서 다른 계정으로 로그인했다. 새로고침할 때까지 요청을 막는다(고치던 내용은 화면에 남는다) -->
    <div v-if="session.switched" role="alert" class="pointer-events-auto flex gap-3 items-center rounded-full pl-2 pr-2 py-2 text-body pane-menu">
      <span class="size-9 shrink-0 rounded-full bg-error-container text-on-error-container flex items-center justify-center"><Icon name="person" :size="20" /></span>
      <span class="flex-1 min-w-0 text-on-surface font-medium">{{ switchedNotice.title }}</span>
      <BaseButton variant="primary" size="sm" @click="reload">{{ T.reload }}</BaseButton>
    </div>
    <div v-else-if="session.ended || session.offline" role="alert" class="pointer-events-auto flex gap-3 items-center rounded-full pl-2 pr-2 py-2 text-body pane-menu">
      <span class="size-9 shrink-0 rounded-full bg-error-container text-on-error-container flex items-center justify-center"><Icon name="cloud_off" :size="20" /></span>
      <span class="flex-1 min-w-0 text-on-surface font-medium">{{ session.ended ? loginNotice.title : unansweredTitle("offline") }}</span>
      <BaseButton v-if="session.ended" variant="primary" size="sm" @click="showDialog = true">{{ T.loginAgain }}</BaseButton>
      <BaseButton v-else variant="ghost" size="sm" :disabled="checking" @click="retry">{{ T.retry }}</BaseButton>
    </div>
    <!-- SSE 연결만 끊겼다. 요청은 되므로 조작은 그대로 쓰고, 화면은 30초마다 다시 읽는다 -->
    <div v-else-if="session.streamDown" role="status" class="pointer-events-auto flex gap-3 items-center rounded-full pl-2 pr-4 py-2 text-body pane-menu">
      <span class="size-9 shrink-0 rounded-full bg-tertiary-container text-on-tertiary-container flex items-center justify-center"><Icon name="progress_activity" :size="20" class="animate-spin" /></span>
      <span class="flex-1 min-w-0 text-on-surface-variant">{{ T.reconnecting }}</span>
    </div>
  </Transition>

  <!-- 다른 대화상자(ConfirmDialog)와 같은 모양: 가운데 아이콘, 제목, 설명, 오른쪽 아래 버튼. 알림 띠보다 위(z-400).
       세션이 끝났을 때와 위험한 조작에 다시 로그인이 필요할 때(reauth, 세션은 살아 있다) 같은 대화상자를 쓴다 -->
  <BaseDialog :open="session.switched && showSwitched" width="md" layer="session" class="text-center" :aria-labelledby="switchedId" @close="showSwitched = false">
    <span class="size-12 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center mx-auto mb-4"><Icon name="person" :size="24" /></span>
    <h3 :id="switchedId" class="mb-4 text-xl font-round font-semibold text-on-surface">{{ switchedNotice.title }}</h3>
    <p class="mb-6 text-sm text-on-surface-variant">{{ switchedNotice.body }}</p>
    <p class="-mt-2 mb-6 text-on-surface-variant text-label">{{ codeLineOf("account-changed", 409) }}</p>
    <div class="flex gap-2 justify-end flex-wrap">
      <BaseButton variant="ghost" @click="showSwitched = false">{{ T.later }}</BaseButton>
      <BaseButton variant="primary" @click="reload">{{ T.reload }}</BaseButton>
    </div>
  </BaseDialog>
  <BaseDialog :open="(session.ended || session.reauth) && !session.switched && showDialog" width="md" layer="session" class="text-center" :aria-labelledby="titleId" @close="close">
    <span class="size-12 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center mx-auto mb-4"><Icon name="key" :size="24" /></span>
    <h3 :id="titleId" class="mb-4 text-xl font-round font-semibold text-on-surface">{{ notice.title }}</h3>
    <p class="mb-1 text-sm text-on-surface-variant">{{ notice.body }}</p>
    <p class="mb-6 text-sm text-on-surface-variant">{{ session.ended ? T.loginAgainBody : T.reauthBody }}</p>
    <p v-if="note" class="mb-4 text-sm text-tertiary">{{ note }}</p>
    <p class="-mt-2 mb-6 text-on-surface-variant text-label">{{ session.ended ? codeLineOf("login-required", 401) : codeLineOf("reauth-required", 403) }}</p>
    <div class="flex gap-2 justify-end flex-wrap">
      <BaseButton variant="ghost" @click="close">{{ T.later }}</BaseButton>
      <BaseButton v-if="session.ended" variant="ghost" :disabled="checking" @click="check">{{ T.loggedIn }}</BaseButton>
      <BaseButton variant="primary" @click="openLogin">{{ T.openLoginWindow }}</BaseButton>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, useId } from "vue";
import { useRouter } from "vue-router";
import axios from "axios";
import BaseDialog from "./BaseDialog.vue";
import Icon from "./BaseIcon.vue";
import BaseButton from "./BaseButton.vue";
import { session, openLoginWindow, onSignedIn, endReauth, loginWindow } from "../composables/session.ts";
import { useUserStore } from "../stores/user.ts";
import { codeLineOf, noticeText, unansweredTitle } from "../utils/problem.ts";
import { text } from "../text/index.ts";
const T = text.shell;

// 세션 끝은 서버가 401 로 거절할 때와 같은 문장(login-required), 재로그인 안내는 reauth-required
const loginNotice = noticeText("login-required");
const switchedNotice = noticeText("account-changed");
const notice = computed(() => (session.ended ? loginNotice : noticeText("reauth-required")));

const user = useUserStore();
const router = useRouter();
const showDialog = ref(false);
const checking = ref(false);
const note = ref("");

// 끝났다고 알게 된 때 한 번 연다. 닫아도 띠가 남는다. 재로그인 안내는 거절당할 때마다 연다(띠는 없다)
watch(
  () => session.ended || session.reauth,
  (shown) => {
    showDialog.value = shown;
    note.value = "";
    // 다른 경로(탭 복귀 시 확인, 로그인했어요 버튼)로 재로그인이 확인되어 닫혔다. 로그인 창 대기 상태도 끝낸다
    if (!shown) void loginWindow.signedIn();
  },
);

// 나중에: 다시 로그인을 기다리던 요청은 거절대로 실패한다(세션 끝은 띠가 남는다)
function close() {
  showDialog.value = false;
  if (session.reauth) endReauth(false);
  // 재로그인을 취소했다. 기다리는 동안 받은 401이 있으면 로그인 상태를 확인한다
  void loginWindow.abandoned();
}
const titleId = useId();
const switchedId = useId();
// 계정이 바뀐 것을 감지했을 때 대화상자를 한 번 연다. 닫아도 상단 배너는 남는다
const showSwitched = ref(false);
watch(
  () => session.switched,
  (on) => {
    showSwitched.value = on;
    // 재로그인을 기다리던 요청은 다른 계정으로 다시 보낼 수 없다. 원래 거절 응답대로 실패 처리한다(처리 중 상태로 남지 않게 한다)
    if (on && session.reauth) endReauth(false);
  },
);
const reload = () => window.location.reload();

function openLogin() {
  // 사용자가 누른 때에만 연다(그렇지 않으면 브라우저가 팝업으로 막는다). 창을 닫지 않고 마치기를 기다린다
  openLoginWindow();
  note.value = T.loginWindowOpen;
}

// 로그인 창이 로그인을 마쳤다. 세션 끝이면 이어 쓰고, 다시 로그인이면 기다리던 요청을 다시 보낸다
async function signedIn() {
  // 기다리는 동안 받은 401(새 로그인으로 이전 세션이 종료되어 실패한 진행 중 요청)은 세션이 유효한지 확인해 살아 있으면 세션 만료로 처리하지 않는다
  await loginWindow.signedIn();
  if (session.ended) await check();
  if (session.reauth) {
    showDialog.value = false;
    endReauth(true);
  }
}

async function check() {
  checking.value = true;
  note.value = (await user.resumeSession()) ? "" : T.notLoggedInYet;
  checking.value = false;
}

// 연결 안 됨: 로그인했는지도 모르던 처음이면 다시 확인하고 가려던 곳으로, 그 뒤라면 한 번 닿아 본다(닿으면 띠가 사라진다)
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
        /* 닿았는지만 본다. 닿으면 요청 한 곳이 띠를 제거한다 */
      });
  } finally {
    checking.value = false;
  }
}

// 다른 창에서 로그인하고 돌아오면 알아서 잇는다
const onReturn = () => {
  if (session.ended && !document.hidden) void user.resumeSession();
};
let stopListening: (() => void) | null = null;
onMounted(() => {
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
  stopListening = onSignedIn(() => {
    loginWindow.elsewhere();
    void signedIn();
  });
});
onUnmounted(() => {
  window.removeEventListener("focus", onReturn);
  document.removeEventListener("visibilitychange", onReturn);
  stopListening?.();
});
</script>
