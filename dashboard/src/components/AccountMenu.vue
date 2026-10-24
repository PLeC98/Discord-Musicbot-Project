<template>
  <button
    ref="triggerEl"
    type="button"
    aria-haspopup="menu"
    :aria-expanded="open"
    v-tooltip="wide || compact ? null : user.displayName"
    class="state-layer flex items-center cursor-pointer text-on-surface transition-[border-radius,background-color] spring-fast"
    :class="[wide ? 'w-full p-1.5 pr-3 rounded-full gap-3' : labeled ? 'w-full rounded-full py-1 pl-1.5 pr-3.5 gap-3 -my-1' : 'rounded-full gap-3', open && (wide || labeled) ? 'bg-on-surface/8' : '', !wide && !compact && !labeled ? 'mx-auto' : '']"
    @click="toggle"
  >
    <!-- labeled: 펼친 세로 막대. 캡슐 안 여백은 위아래 4px · 왼쪽 6px(옆을 조금 길게). 위아래 여백만큼 바깥으로 넘쳐(-my-1) 접었을 때와 높이가 같다(시계 · 그림이 움직이지 않는다). 옆에 이름 · 아이디 -->
    <img v-if="user.avatarUrl" :src="user.avatarUrl" alt="" class="rounded-full shrink-0" :class="compact ? 'size-9' : 'size-12'" />
    <span v-else class="rounded-full shrink-0 bg-tertiary-container text-on-tertiary-container font-round font-semibold flex items-center justify-center" :class="compact ? 'size-9 text-body' : 'size-12 text-title'">{{ initial }}</span>
    <span v-if="labeled" class="flex-1 min-w-0 text-left whitespace-nowrap">
      <span class="block text-sm leading-4.5 font-semibold truncate">{{ user.displayName }}</span>
      <span v-if="handle" class="block text-xs leading-4 text-on-surface-variant truncate">@{{ handle }}</span>
    </span>
    <template v-if="wide">
      <span class="flex-1 min-w-0 text-left">
        <span class="block text-body font-medium truncate">{{ user.displayName }}</span>
        <span v-if="handle" class="block text-label text-on-surface-variant truncate">@{{ handle }}</span>
      </span>
      <Icon name="unfold_more" :size="20" class="text-on-surface-variant" />
    </template>
  </button>

  <!-- 레일이 overflow-hidden 이라 메뉴를 안에 두면 잘린다. body 로 빼고 좌표로 붙인다(트리거가 아래쪽이면 위로, 위쪽이면 아래로).
       휴대폰은 사이드 드로어(App.vue, 막 250 · 사이드 드로어 260) 안에서 여므로 그보다 위에 둔다(알림 · 대화상자 300 보다는 아래) -->
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-270" @click="open = false" @contextmenu="open = false"></div>
    <Transition enter-from-class="opacity-0 scale-90" leave-to-class="opacity-0 scale-95" enter-active-class="transition-[opacity,scale] spring-fast" leave-active-class="transition-[opacity,scale] duration-150">
      <div v-if="open" role="menu" :style="pos" class="fixed z-280 w-70 p-2 rounded-3xl pane-menu" :class="placeAbove ? 'origin-bottom-left' : 'origin-top-right'">
        <div class="flex items-center gap-3 px-2 pt-2 pb-3">
          <!-- 버튼과 같다: 프로필 그림, 없으면 이름 첫 글자 -->
          <img v-if="user.avatarUrl" :src="user.avatarUrl" alt="" class="size-11 rounded-full shrink-0" />
          <span v-else class="size-11 rounded-full shrink-0 bg-tertiary-container text-on-tertiary-container font-round font-semibold text-title flex items-center justify-center">{{ initial }}</span>
          <div class="min-w-0">
            <div class="text-title font-semibold truncate">{{ user.displayName }}</div>
            <div v-if="handle" class="text-label text-on-surface-variant truncate">@{{ handle }}</div>
          </div>
        </div>
        <div v-if="user.viewAs" class="mx-2 mb-2 px-3 py-2 rounded-xl text-label font-semibold bg-tertiary-container text-on-tertiary-container">{{ user.viewAsLabel }} {{ T.viewingAs }}</div>

        <div class="px-2 pb-2 pt-1 text-label font-semibold text-on-surface-variant">{{ T.brightness }}</div>
        <!-- 이어 붙은 버튼 그룹(M3E connected button group). 선택한 버튼은 모서리가 둥글게 바뀐다 -->
        <div class="flex gap-0.5 px-2 pb-3" role="group" :aria-label="T.brightness">
          <button
            v-for="(m, i) in MODE_ITEMS"
            :key="m.mode"
            type="button"
            class="state-layer flex-1 h-10 flex items-center justify-center gap-2 text-label font-semibold cursor-pointer transition-[border-radius,background-color,color] spring-fast"
            :class="[mode === m.mode ? 'bg-secondary text-on-secondary rounded-xl' : 'bg-surface-highest text-on-surface-variant ' + (i === 0 ? 'rounded-l-xl rounded-r-sm active:rounded-r-xs' : i === MODE_ITEMS.length - 1 ? 'rounded-r-xl rounded-l-sm active:rounded-l-xs' : 'rounded-sm active:rounded-xs')]"
            @click="setMode(m.mode)"
          >
            <Icon :name="m.icon" :size="18" :fill="mode === m.mode" />{{ m.label }}
          </button>
        </div>

        <div class="mx-2 mb-2 h-px bg-outline-variant/60"></div>
        <button type="button" role="menuitem" :class="[item, 'w-full']" @click="openSettings"><Icon name="settings" :size="20" />{{ T.settings }}</button>
        <!-- 권한 보기(오버라이드) 중에도 그대로 둔다(디스코드의 "역할 적용해서 서버 보기"도 서버 설정 메뉴는 그대로다. 오버라이드 중이라는 것은 위 띠가 알린다) -->
        <router-link v-if="user.isRealOwner" to="/admin" role="menuitem" :class="item" @click="open = false"><Icon name="admin_panel_settings" :size="20" />{{ T.adminPanel }}</router-link>
        <button type="button" role="menuitem" :class="[item, 'w-full']" @click="openLicense"><Icon name="license" :size="20" />{{ T.licenses }}</button>
        <button type="button" role="menuitem" :class="[item, 'w-full text-error']" @click="logout"><Icon name="logout" :size="20" />{{ T.logout }}</button>
      </div>
    </Transition>
  </Teleport>
  <SettingsDialog v-model="settingsOpen" />
  <LicenseDialog v-model="licenseOpen" />
</template>

<script setup lang="ts">
import { rem } from "../utils/rem.ts";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useCloseLayer } from "../composables/close-layer.ts";
import axios from "axios";
import Icon from "./BaseIcon.vue";
import SettingsDialog from "./SettingsDialog.vue";
import LicenseDialog from "./LicenseDialog.vue";
import { useUserStore } from "../stores/user.ts";
import { mode, setMode, type Mode } from "../theme/theme.ts";
import type { IconName } from "../icons.ts";
import { text } from "../text/index.ts";
const T = text.shell;

// wide: 펼친 레일(이름까지) / compact: 휴대폰 위 막대(작은 동그라미) / 둘 다 아니면 좁은 레일
// labeled: 펼친 세로 막대(작은 그림 + 이름 · 아이디)
const props = withDefaults(defineProps<{ wide?: boolean; compact?: boolean; labeled?: boolean }>(), { wide: false, compact: false, labeled: false });

const user = useUserStore();
const triggerEl = ref<HTMLElement | null>(null);
const open = ref(false);
useCloseLayer(open, () => (open.value = false));
const pos = ref<Record<string, string>>({});
const placeAbove = ref(true);
const settingsOpen = ref(false);
const licenseOpen = ref(false);
const MENU_WIDTH_REM = 17.5; // w-70

const MODE_ITEMS: Array<{ mode: Mode; label: string; icon: IconName }> = [
  { mode: "dark", label: T.modeDark, icon: "dark_mode" },
  { mode: "light", label: T.modeLight, icon: "light_mode" },
  { mode: "system", label: T.modeSystem, icon: "contrast" },
];

const initial = computed(() => user.displayName[0] || "?");
const handle = computed(() => (user.data?.username !== user.displayName ? user.data?.username : null));
const item = "state-layer flex items-center gap-3 h-10 px-3 rounded-full no-underline cursor-pointer text-body font-medium text-on-surface";

function toggle() {
  if (open.value) {
    open.value = false;
    return;
  }
  const r = triggerEl.value?.getBoundingClientRect();
  if (!r) return;
  placeAbove.value = r.top > window.innerHeight / 2;
  const left = Math.round(Math.max(8, Math.min(props.compact && !props.labeled ? r.right - rem(MENU_WIDTH_REM) : r.left, window.innerWidth - rem(MENU_WIDTH_REM) - 8)));
  pos.value = placeAbove.value ? { left: `${left}px`, bottom: `${Math.round(window.innerHeight - r.top + 8)}px` } : { left: `${left}px`, top: `${Math.round(r.bottom + 8)}px` };
  open.value = true;
}

function openSettings() {
  open.value = false;
  settingsOpen.value = true;
}

function openLicense() {
  open.value = false;
  licenseOpen.value = true;
}

async function logout() {
  open.value = false;
  try {
    // 세션이 이미 끝났어도 로그인 화면으로 간다. 세션 끝 대화상자를 열지 않는다
    await axios.post("/auth/logout", undefined, { quietSession: true });
  } finally {
    window.location.assign("/");
  }
}

// 창 크기가 바뀌면 좌표가 어긋난다. 다시 계산하는 대신 닫는다.
const onResize = () => (open.value = false);
onMounted(() => {
  window.addEventListener("resize", onResize);
});
onUnmounted(() => {
  window.removeEventListener("resize", onResize);
});
</script>
