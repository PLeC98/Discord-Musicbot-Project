<template>
  <!-- 로그인 화면: 리싱한 Hyprland 의 잠금 화면(hyprlock) 결. 봇 정보 탭의 터미널과 같은 재료(활성 창 그라데이션 테두리).
       위에 waybar 섬 셋(작업 공간 알약 모양의 밝기 고르기 · locked · 봇 상태와 짧은 날짜), 가운데 큰 시계 · 고리 두른 봇 그림 · hyprlock 입력칸 모양의 로그인 단추(오른쪽 끝 화살표, Enter 로도),
       아래 가운데에 같은 섬 하나로 소스 링크(AGPL 13조 고지) -->
  <div ref="rootEl" class="relative min-h-dvh flex flex-col overflow-x-hidden">
    <AppWallpaper />

    <!-- waybar: 떠 있는 섬 셋 -->
    <!-- 세 칸 격자(1fr · 가운데 · 1fr): 양옆 섬 폭이 달라도 가운데 섬이 화면 가운데 -->
    <header ref="headerEl" class="relative z-20 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pt-3 text-sm font-mono whitespace-nowrap">
      <!-- 왼쪽: 밝기(어두운 · 밝은 · 시스템)를 작업 공간 알약 모양으로. 고른 것은 긴 알약(안에 아이콘), 나머지는 점. 로그인 전에도 바꾸고 저장해 대시보드도 따른다 -->
      <div :class="[ISLAND, 'justify-self-start px-1.5 gap-0']" role="radiogroup" aria-label="화면 밝기">
        <button v-for="m in MODE_PILLS" :key="m.mode" type="button" role="radio" :aria-checked="mode === m.mode" :aria-label="m.label" v-tooltip="m.label" class="group/ws h-9 px-1 flex items-center cursor-pointer" @click="setMode(m.mode)">
          <span class="h-4 rounded-full flex items-center justify-center transition-[width,background-color] duration-300 spring" :class="mode === m.mode ? 'w-8 bg-primary text-on-primary' : 'w-2.5 h-2.5! bg-on-surface/25 group-hover/ws:bg-on-surface/50'">
            <Icon v-if="mode === m.mode" :name="m.icon" :size="12" fill />
          </span>
        </button>
      </div>
      <div :class="ISLAND" class="hidden md:flex"><Icon name="lock" :size="16" class="text-tertiary" fill />locked</div>
      <div :class="ISLAND" class="col-start-3 justify-self-end">
        <span class="flex items-center gap-1.5" :class="online ? 'text-(--ok-ink)' : 'text-error'"><Icon :name="online ? 'wifi' : 'wifi_off'" :size="16" />{{ online ? "online" : "offline" }}</span>
        <span class="text-on-surface-variant">│</span>
        <!-- 큰 시계를 뺀 낮은 화면은 날짜 대신 시각 -->
        <span class="nums">{{ short ? clock : shortDate }}</span>
      </div>
    </header>

    <!-- hyprlock: 봇 그림 · 이름 · 로그인 칸 묶음이 화면 정가운데(세 줄 격자 1fr · 묶음 · 1fr), 시계는 격자 밖에서 화면 높이 18% 가 중심.
         위 막대 · 아래 섬과 상관없이 화면 전체 기준이라 바깥에 깐다.
         낮은 화면(휴대폰 가로 등, 높이 512 이하)은 자리가 없어 큰 시계를 빼고(위 막대 오른쪽이 날짜 대신 시각), 묶음은 휴대폰 크기, 실패는 대화상자로 -->
    <main class="absolute inset-0 grid grid-rows-[1fr_auto_1fr] justify-items-center px-5 text-center">
      <!-- 시계: 화면 높이 18% 를 중심으로 고정(묶음과의 간격은 화면 높이를 따른다). 위 칸은 비워 둔다. 낮은 화면은 자리가 없어 뺀다.
           그 자리가 위 막대나 묶음과 겹치면(애매하게 낮은 화면) 둘 사이 가운데로 옮기고 줄인다. 반 넘게 줄여야 하면 숨긴다(fit) -->
      <div></div>
      <p v-if="!short" ref="clockEl" :style="clockStyle" :class="fit.clockHidden && 'invisible'" class="absolute inset-x-0 top-[18%] -translate-y-1/2 font-round font-semibold nums leading-none tracking-[-0.04em] text-[4.5rem] md:text-[6.5rem] text-on-surface drop-shadow-[0_2px_12px_rgb(0_0_0/0.25)]">{{ clock }}</p>

      <!-- 그림 · 이름 · 로그인 칸 묶음이 화면 정가운데. 고리는 활성 창 테두리와 같은 45도 그라데이션.
           크기는 폭만이 아니라 높이도 본다: 낮은 화면(휴대폰 가로)은 폭이 넓어도 휴대폰 크기. 정가운데에서 화면 높이 3% 만큼 올린다(눈으로 맞춘 값). 그림 · 이름 · 단추 사이는 같은 간격 -->
      <div ref="groupEl" class="relative w-full flex flex-col items-center translate-y-[-3dvh]">
        <span class="rounded-full p-0.75 bg-[linear-gradient(45deg,var(--md-primary),var(--md-tertiary))]" :class="short ? 'size-22' : 'size-44 md:size-48'">
          <span class="size-full rounded-full overflow-hidden ring-3 ring-surface bg-primary-container text-on-primary-container flex items-center justify-center">
            <img v-if="botAvatar" :src="botAvatar" :alt="botName" class="size-full object-cover" />
            <Icon v-else name="graphic_eq" :size="short ? 44 : 88" :weight="600" />
          </span>
        </span>
        <p class="font-semibold" :class="short ? 'mt-3 text-title-lg' : 'mt-4 text-title-lg md:text-[1.5rem]'">{{ botName || "MusicBot" }}</p>

        <!-- 입력칸 모양의 로그인 단추. 실패면 테두리가 오류 색으로 바뀌고 한 번 흔들린다(hyprlock 의 fail_color · fail_text) -->
        <a href="/auth/login" class="state-layer relative w-full rounded-full pane flex items-center pr-2 no-underline text-on-surface" :class="[short ? 'mt-3 max-w-56 h-11 gap-2.5 pl-4' : 'mt-4 max-w-56 h-11 md:max-w-72 md:h-13 gap-2.5 md:gap-3 pl-4 md:pl-5', error ? 'fail-shake ring-2 ring-error' : 'term-border']">
          <DiscordMark :size="22" class="shrink-0 text-[#5865F2]" :class="short ? 'w-4.5 h-auto' : 'max-md:w-4.5 max-md:h-auto'" />
          <span class="flex-1 text-left" :class="short ? 'text-body' : 'text-body md:text-body-lg'">Discord로 로그인</span>
          <!-- 오른쪽 끝 화살표: 입력칸이 아니라 누르는 단추로 읽히게(손가락 기기에도 보인다) -->
          <span class="shrink-0 rounded-full bg-primary text-on-primary flex items-center justify-center" :class="short ? 'size-8' : 'size-8 md:size-9'"><Icon name="arrow_forward" :size="20" /></span>
        </a>

        <!-- 실패 까닭 · 안내. 묶음 밑에 띄워(absolute) 묶음의 가운데를 흔들지 않는다. 낮은 화면은 밑에 자리가 없어 실패는 대화상자로, 안내는 뺀다.
             아래 섬에 닿으면(애매하게 낮은 화면)도 같다: 자리를 재는 동안에도 크기가 남게 숨기기만 한다(fit) -->
        <div v-if="!short" ref="belowEl" class="absolute top-full inset-x-0 flex flex-col items-center" :class="!fit.belowFits && 'invisible'">
          <p v-if="error" class="mt-3 max-w-72 pane rounded-2xl px-4 py-3 text-body text-error whitespace-pre-line">
            <strong class="font-semibold">{{ errorText.title }}</strong
            >{{ NL }}{{ errorText.body }}{{ NL }}<span class="font-mono text-xs">{{ error }}</span>
          </p>
          <!-- 키보드가 있는 기기에만: Enter 로도 들어간다. 배경 그림 위에서도 읽히게 작은 섬 위에 -->
          <p v-else class="mt-3 pane rounded-full h-7 px-3 flex items-center gap-1 font-mono text-xs text-on-surface-variant pointer-coarse:hidden">press <kbd class="px-1.5 rounded bg-on-surface/10 text-on-surface">Enter</kbd> to login</p>
        </div>
      </div>
    </main>

    <!-- 낮은 화면의 실패: 공용 확인 대화상자. 닫으면 이번에는 다시 띄우지 않는다 -->
    <ConfirmDialog :model-value="(short || !fit.belowFits) && Boolean(error) && !errorClosed" icon="error" :title="errorText.title" :body="`${errorText.body}\n오류 코드: ${error}`" confirm-label="다시 로그인" tone="primary" @update:model-value="(v) => !v && (errorClosed = true)" @confirm="login" />

    <!-- 소스 링크(AGPL 13조 고지): waybar 와 같은 섬 -->
    <footer ref="footerEl" class="relative z-20 mt-auto flex justify-center px-3 pb-3">
      <div :class="ISLAND" class="h-7! px-3! gap-1.5! md:h-8! md:px-4! md:gap-2! text-[0.6875rem] md:text-xs font-mono whitespace-nowrap">
        <Icon name="code" :size="14" class="text-tertiary max-md:text-[0.75rem]!" />
        <template v-if="modified"> <a :href="sourceRepo" target="_blank" rel="noopener" :class="LINK">Modified Source</a><span class="text-on-surface-variant">│</span><a :href="projectRepo" target="_blank" rel="noopener" :class="LINK">Original Source</a> </template>
        <a v-else :href="sourceRepo" target="_blank" rel="noopener" :class="LINK">Source Code</a>
        <span class="text-on-surface-variant">│</span>
        <span class="text-on-surface-variant">AGPL-3.0</span>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { onKeyStroke, useResizeObserver } from "@vueuse/core";
import axios from "axios";
import { useUserStore } from "../stores/user.ts";
import AppWallpaper from "../components/AppWallpaper.vue";
import Icon from "../components/BaseIcon.vue";
import DiscordMark from "../components/DiscordMark.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import { mode, releasePageArt, setMode, setPageArt, type Mode } from "../theme/theme.ts";
import { useMediaQuery } from "@vueuse/core";
import { SHORT_QUERY } from "../utils/breakpoints.ts";
import { isModifiedSource } from "../utils/licenses.ts";
import type { BotInfo, LoginError } from "../../../src/dashboard/contract/identity.ts";
import type { IconName } from "../icons.ts";

const NL = "\n";
const ISLAND = "pane rounded-full h-9 px-4 flex items-center gap-2 text-on-surface";
const LINK = "text-on-surface no-underline hover:underline";

const route = useRoute();
const router = useRouter();
const user = useUserStore();

// 못 받으면 비운다(속성을 달지 않는다)
const botAvatar = ref<string>();
const botName = ref("");
const sourceRepo = ref<string>();
const projectRepo = ref<string>();
// 고친 소스를 따로 공개했으면 수정본 · 원본 둘 다(라이선스 대화상자와 같은 기준)
const modified = computed(() => isModifiedSource(sourceRepo.value, projectRepo.value));
// 봇에 닿는지(봇 정보를 받았으면 online)
const online = ref(true);

// 로그인 콜백(src/dashboard/routes/auth.ts)이 돌려보낸 까닭
const LOGIN_ERRORS: Record<LoginError, { title: string; body: string }> = {
  denied: { title: "로그인을 취소했어요.", body: "디스코드 권한 승인 과정이 취소됐어요. 대시보드 사용에는 계정의 일부 정보가 필요해요. 다시 시도해 주세요." },
  no_code: { title: "로그인하지 못했어요!", body: "디스코드에서 로그인 결과를 받지 못했어요. 다시 시도해 주세요." },
  auth_failed: { title: "로그인하지 못했어요!", body: "디스코드 인증을 마치지 못했어요. 다시 시도해 보고, 계속되면 봇 운영자에게 알려 주세요." },
};
const error = computed(() => (typeof route.query.error === "string" ? route.query.error : ""));
const errorText = computed(() => LOGIN_ERRORS[error.value as LoginError] ?? { title: "로그인하지 못했어요!", body: "알 수 없는 오류가 발생했어요. 다시 시도해 보고, 계속되면 봇 운영자에게 알려 주세요." });

// 시계: 분이 바뀔 때만 다시 그린다
const now = ref(new Date());
let timer = 0;
function tick() {
  now.value = new Date();
  timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
}
onUnmounted(() => clearTimeout(timer));
const two = (n: number) => String(n).padStart(2, "0");
const clock = computed(() => `${two(now.value.getHours())}:${two(now.value.getMinutes())}`);
// 낮은 화면(휴대폰 가로 등): 시계를 빼고 휴대폰 크기, 실패는 대화상자
const short = useMediaQuery(SHORT_QUERY);

// 위 막대 왼쪽의 밝기 알약(작업 공간 차례처럼)
const MODE_PILLS: Array<{ mode: Mode; label: string; icon: IconName }> = [
  { mode: "dark", label: "어두운 화면", icon: "dark_mode" },
  { mode: "light", label: "밝은 화면", icon: "light_mode" },
  { mode: "system", label: "시스템 설정 따르기", icon: "contrast" },
];

// 위 막대 오른쪽의 짧은 날짜("Fri 10/09"). 날짜는 여기에만 둔다
const shortDate = computed(() => `${now.value.toLocaleDateString("en-US", { weekday: "short" })} ${two(now.value.getMonth() + 1)}/${two(now.value.getDate())}`);

// 애매하게 낮은 화면(낮은 화면 기준보다는 높지만 시계 · 묶음 · 밑 안내 · 아래 섬이 다 들어가지 않는 높이)에서 겹치지 않게.
// 넉넉하면 처음 자리 그대로. 시계는 위 막대와 묶음 사이에 들어가게 옮기고 줄이며(반 넘게 줄여야 하면 숨긴다),
// 밑 안내가 아래 섬에 닿으면 실패는 대화상자로, Enter 안내는 숨긴다. 화면 · 묶음 크기가 바뀔 때마다 다시 잰다
const rootEl = ref<HTMLElement | null>(null);
const headerEl = ref<HTMLElement | null>(null);
const clockEl = ref<HTMLElement | null>(null);
const groupEl = ref<HTMLElement | null>(null);
const belowEl = ref<HTMLElement | null>(null);
const footerEl = ref<HTMLElement | null>(null);
const GAP = 16;
const MIN_CLOCK = 0.55;
const fit = reactive({ shift: 0, scale: 1, clockHidden: false, belowFits: true });
const clockStyle = computed(() => (fit.shift || fit.scale !== 1 ? { transform: `translateY(${fit.shift}px) scale(${fit.scale})` } : undefined));
function layout() {
  const root = rootEl.value,
    header = headerEl.value,
    group = groupEl.value,
    footer = footerEl.value;
  if (!root || !header || !group || !footer) return;
  const top = root.getBoundingClientRect().top;
  const g = group.getBoundingClientRect();
  const groupTop = g.top - top;
  const footerTop = footer.getBoundingClientRect().top - top;
  const clock = clockEl.value;
  if (clock) {
    const height = clock.offsetHeight;
    const center = root.clientHeight * 0.18;
    const lo = header.getBoundingClientRect().bottom - top + GAP;
    const hi = groupTop - GAP;
    if (center - height / 2 >= lo && center + height / 2 <= hi) Object.assign(fit, { shift: 0, scale: 1, clockHidden: false });
    else {
      const scale = Math.min(1, (hi - lo) / height);
      Object.assign(fit, { shift: (lo + hi) / 2 - center, scale: Math.max(scale, MIN_CLOCK), clockHidden: scale < MIN_CLOCK });
    }
  }
  const below = belowEl.value;
  fit.belowFits = !below || g.bottom - top + below.offsetHeight <= footerTop - GAP / 2;
}
useResizeObserver(rootEl, layout);
useResizeObserver(groupEl, layout);
watch([short, error], () => nextTick(layout));

const PAGE_ART = Symbol("login");
onUnmounted(() => releasePageArt(PAGE_ART));

// 잠금 화면처럼 Enter 로 들어간다
const login = () => (window.location.href = "/auth/login");
onKeyStroke("Enter", login);
// 낮은 화면의 실패 대화상자를 닫았다
const errorClosed = ref(false);

onMounted(async () => {
  // 틀 없이 연 미리 보기(meta.bare)는 로그인했어도 둔다
  if (user.isLoggedIn && !route.meta.bare) {
    await router.replace("/dashboard");
    return;
  }
  tick();
  try {
    const res = await axios.get<BotInfo>("/api/bot");
    botAvatar.value = res.data.avatarUrl ?? undefined;
    // 로그인 전에는 들을 곡이 없다: 봇 그림을 배경(쓰임 avatar: 원본 해상도, 옅은 흐림 · 밝기 띠)과 색으로 깐다
    if (botAvatar.value) setPageArt(PAGE_ART, botAvatar.value, "avatar");
    botName.value = res.data.name ?? "";
    sourceRepo.value = res.data.sourceRepo;
    projectRepo.value = res.data.projectRepo;
  } catch {
    // 봇 그림 · 이름은 꾸밈이다. 못 받으면 기본 그림으로 두고 위 막대에 offline 을 띄운다
    online.value = false;
  }
});
</script>

<style scoped>
/* 실패 때 한 번 흔들린다(hyprlock 의 입력칸 흔들림) */
.fail-shake {
  animation: fail-shake 400ms var(--ease-smooth, ease) 1;
}
@keyframes fail-shake {
  20% {
    translate: -8px 0;
  }
  40% {
    translate: 7px 0;
  }
  60% {
    translate: -5px 0;
  }
  80% {
    translate: 3px 0;
  }
}
</style>
