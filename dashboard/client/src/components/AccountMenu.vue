<template>
  <!-- 사이드바 하단 계정 영역 — 클릭하면 위로 펼쳐지는 메뉴 (Discord/ChatGPT식) -->
  <div class="shrink-0 border-t border-white/7 p-2">
    <button ref="triggerEl" type="button" aria-haspopup="menu" :aria-expanded="open" v-tooltip="rail ? user.displayName : null" :class="[triggerBase, open ? 'bg-white/8 text-fg' : 'text-muted hover:bg-white/6 hover:text-fg', iconOnly ? 'justify-center' : rail ? 'max-lg:justify-center' : '']" @click="toggle">
      <img v-if="user.avatarUrl" :src="user.avatarUrl" alt="" class="size-9 rounded-full shrink-0 border border-white/10" />
      <span v-else class="size-9 rounded-full shrink-0 border border-white/10 bg-linear-135 from-accent to-accent-2 text-sm font-bold text-white flex items-center justify-center">{{ initial }}</span>
      <template v-if="!iconOnly">
        <span :class="[rail && 'max-lg:hidden', 'flex-1 min-w-0 text-left text-[0.85rem] font-medium overflow-hidden whitespace-nowrap text-ellipsis']">{{ user.displayName }}</span>
        <Icon name="unfold" :size="15" :class="[rail && 'max-lg:hidden', 'text-muted']" />
      </template>
    </button>
  </div>

  <!-- 레일이 폭 전환을 위해 overflow-hidden이라 메뉴를 안에 두면 잘린다. body로 빼고 좌표로 붙인다. -->
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-200" @click="open = false" @contextmenu="open = false"></div>
    <div v-if="open" role="menu" :style="pos" class="fixed z-210 w-56 p-1.5 rounded-2xl bg-[rgba(18,22,42,0.97)] backdrop-blur-2xl backdrop-saturate-[1.6] border border-white/11 shadow-[0_12px_40px_rgba(0,0,0,0.55)] inset-shadow-glass">
      <div class="px-2.5 pt-1.5 pb-2.5">
        <div class="text-[0.85rem] font-semibold text-fg overflow-hidden whitespace-nowrap text-ellipsis">{{ user.displayName }}</div>
        <div v-if="handle" class="text-[0.75rem] text-muted overflow-hidden whitespace-nowrap text-ellipsis">@{{ handle }}</div>
      </div>
      <div class="mx-1 mb-1 h-px bg-white/8"></div>

      <router-link v-if="user.isOwner" to="/admin" role="menuitem" :class="[item, 'text-fg-soft hover:bg-white/8 hover:text-fg']" @click="open = false"> <Icon name="wrench" :size="16" />운영자 패널 </router-link>
      <button type="button" role="menuitem" :class="[item, 'w-full text-[#f87171] hover:bg-[rgba(248,113,113,0.13)]']" @click="logout"><Icon name="logout" :size="16" />로그아웃</button>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import axios from "axios";
import Icon from "./BaseIcon.vue";
import { useUserStore } from "../stores/user.js";

// rail=true면 사이드바 레일 안 — md~lg 구간에서 라벨을 숨기는 반응형 규칙이 붙는다(ServerSidebar와 동일 방식).
// collapsed는 lg+ 접힘 상태. 드로어에서는 둘 다 꺼진 상태로 쓴다.
const props = defineProps({
  rail: { type: Boolean, default: false },
  collapsed: { type: Boolean, default: false },
});

const user = useUserStore();
const triggerEl = ref(null);
const open = ref(false);
const pos = ref({ left: "0px", bottom: "0px" });

const MENU_WIDTH = 224; // w-56
const iconOnly = computed(() => props.rail && props.collapsed);
const initial = computed(() => user.displayName[0] || "?");
const handle = computed(() => (user.data?.username !== user.displayName ? user.data?.username : null));

const triggerBase = "w-full flex items-center gap-2.5 rounded-xl p-1.5 cursor-pointer transition-[background-color,color] duration-200";
const item = "flex items-center gap-2.5 px-2.5 py-2 rounded-xl no-underline cursor-pointer text-[0.85rem] font-medium transition-[background-color,color] duration-200";

function toggle() {
  if (open.value) {
    open.value = false;
    return;
  }
  // 메뉴는 트리거 위로 펼친다 — bottom 기준이라 높이를 몰라도 붙는다
  const r = triggerEl.value.getBoundingClientRect();
  pos.value = {
    left: `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)))}px`,
    bottom: `${Math.round(window.innerHeight - r.top + 6)}px`,
  };
  open.value = true;
}

async function logout() {
  open.value = false;
  try {
    await axios.post("/auth/logout");
  } finally {
    window.location.assign("/");
  }
}

// 창 크기가 바뀌면 좌표가 어긋난다. 다시 계산하는 대신 닫는다.
const onResize = () => (open.value = false);
const onKey = (e) => {
  if (e.key === "Escape") open.value = false;
};

onMounted(() => {
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKey);
});
onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  window.removeEventListener("keydown", onKey);
});
</script>
