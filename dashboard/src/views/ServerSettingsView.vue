<template>
  <div class="md:pt-(--gap-out)">
    <!-- 돌아가기는 위 막대 왼쪽 끝으로(서버 이름 - 서버 설정은 위 막대 가운데). 휴대폰은 화살표만 -->
    <!-- 자동 저장 표시: 위 막대 오른쪽(서버 화면의 설정 버튼 위치) -->
    <Teleport to="#topbar-end" defer>
      <SaveIndicator :state="saveState" />
    </Teleport>
    <Teleport to="#topbar-start" defer>
      <router-link :to="`/servers/${guildId}`" :class="TOPBAR_TEXT_BTN" :aria-label="T.backToPlayer"
        ><Icon name="arrow_back" /><span class="hidden md:inline text-sm font-semibold truncate">{{ T.back }}</span></router-link
      >
    </Teleport>

    <div v-if="loading" class="flex items-center justify-center p-20"><Icon name="progress_activity" :size="40" class="animate-spin text-primary" /></div>

    <!-- 서버가 없거나 멤버가 아니면 다시 해도 같다: 서버 목록으로. 그 밖은 다시 시도 -->
    <PageError v-else-if="loadError" :icon="loadGone ? 'block' : 'cloud_off'" :text="loadError" class="min-h-96">
      <BaseButton v-if="loadGone" variant="secondary" @click="router.push('/servers')"><Icon name="dns" :size="20" />{{ text.common.toServerList }}</BaseButton>
      <BaseButton v-else variant="secondary" @click="retryLoad"><Icon name="refresh" :size="20" />{{ text.shell.retry }}</BaseButton>
    </PageError>

    <template v-else>
      <!-- 카드는 폭을 다 쓰고 바탕화면이 넓어질수록 단이 는다(카드 한 장 360 쯤: 768~ 두 단, 1152~ 세 단). 높이를 맞춘 격자가 아니라 단마다 위에서부터 채운다(카드 높이가 제각각이라 빈칸이 생기지 않게) -->
      <div class="columns-1 @3xl/desk:columns-2 @6xl/desk:columns-3 gap-(--gap-in) *:break-inside-avoid">
        <!-- 봇 전용 채널 -->
        <BaseCard icon="keep" :title="T.channel.title" class="mb-(--gap-in)">
          <p class="text-on-surface-variant text-sm mb-3">{{ T.channel.desc }}</p>
          <SingleSelect :model-value="selectedChannel ?? ''" :options="channelOptions" :empty-label="T.channel.none" :disabled="!s.canEdit" @update:model-value="selectedChannel = $event === '' ? null : String($event)" />
        </BaseCard>

        <!-- DJ 역할 -->
        <BaseCard icon="headphones" :title="T.dj.title" class="mb-(--gap-in)">
          <p class="text-on-surface-variant text-sm mb-3">{{ T.dj.desc }}</p>

          <input :value="roleFilter" @input="roleFilter = valueOf($event)" :disabled="!s.canEdit" :placeholder="text.fields.searchAmong(s.roles.length)" :class="[FIELD, 'w-full mb-2 disabled:opacity-38']" />

          <!-- 스크롤바 트랙은 테두리 안쪽 모서리(12 - 1)에 맞춰 위아래 11 - 5 = 6 을 비우고, 넘치면 오른쪽 여백을 6 - 3 = 3 으로(useOverflowing) -->
          <div ref="roleListEl" class="h-66.5 overflow-y-auto rounded-(--r-inner) border border-outline-variant/50 flex flex-col [&::-webkit-scrollbar-track]:my-1.5" :class="roleListOverflowing ? 'py-1 pl-1 pr-px' : 'p-1'">
            <label v-for="r in filteredRoles" :key="r.id" class="shrink-0 flex items-center gap-2 h-10 px-3 rounded-(--r-row) text-sm" :class="s.canEdit ? 'state-layer cursor-pointer' : 'opacity-60'">
              <input type="checkbox" class="size-4 accent-primary shrink-0" :checked="selectedRoles.includes(r.id)" :disabled="!s.canEdit" @change="toggleRole(r.id)" />
              <span class="size-2 rounded-full shrink-0" :style="{ backgroundColor: r.color || 'var(--md-outline)' }"></span>
              <span class="overflow-hidden whitespace-nowrap text-ellipsis">{{ r.name }}</span>
            </label>
            <div v-if="filteredRoles.length === 0" class="text-on-surface-variant text-sm px-3 py-3">{{ s.roles.length === 0 ? T.dj.noRoles : T.dj.noMatch }}</div>
          </div>
          <div class="text-xs mt-1" :class="selectedRoles.length >= 25 ? 'text-(--warn-ink)' : 'text-on-surface-variant'">{{ T.dj.picked(selectedRoles.length, 25) }}</div>
        </BaseCard>

        <!-- SponsorBlock -->
        <BaseCard icon="skip_next" :title="T.sponsor.title" class="mb-(--gap-in)">
          <p class="text-on-surface-variant text-sm mb-3">{{ T.sponsor.desc }}</p>

          <NoticeBox v-if="s.sponsorblock && !s.sponsorblock.masterEnabled" variant="note" tone="notice" icon="warning" class="mt-0! mb-2">{{ T.sponsor.masterOff }}</NoticeBox>

          <template v-if="s.sponsorblock">
            <label class="flex items-center justify-between gap-3 py-2 text-sm" :class="s.canEdit ? 'cursor-pointer' : ''">
              <span>{{ T.sponsor.enable }}</span>
              <BaseSwitch v-model="sbEnabled" :disabled="!s.canEdit" />
            </label>

            <SponsorCategories class="mt-3" :label="T.sponsor.categories" :selected="sbCategories" :editable="s.canEdit" :dimmed="!sbEnabled" @toggle="toggleSbCategory" />
          </template>
        </BaseCard>

        <!-- 재생목록 한 번에 넣을 곡 수 -->
        <BaseCard v-if="s.playlistAdd" icon="queue_music" :title="T.playlistAdd.title" class="mb-(--gap-in)">
          <p class="text-on-surface-variant text-sm mb-3">{{ T.playlistAdd.desc }}</p>

          <!-- 이어 붙은 버튼 그룹(M3E): 선택한 버튼은 완전히 둥글게 · 체크. 카드가 좁으면(384 미만, 작은 휴대폰) 버튼 안 여백 · 체크 간격을 줄여 카드 안에 들게 -->
          <div class="flex gap-0.5 mb-3" role="radiogroup" :aria-label="T.playlistAdd.choose">
            <button type="button" role="radio" :aria-checked="paUseDefault" :disabled="!s.canEdit" @click="paUseDefault = true" :class="[segment(paUseDefault, 0, paPresets.length + 1), SEG_TIGHT]">
              <Icon v-if="paUseDefault" name="check" :size="18" /><span class="hidden @[18rem]/card:inline">{{ T.playlistAdd.defaultLong }}</span
              ><span class="@[18rem]/card:hidden">{{ T.playlistAdd.defaultShort }}</span
              >{{ T.playlistAdd.songs(paClamp(s.playlistAdd.default)) }}
            </button>
            <button v-for="(n, i) in paPresets" :key="n" type="button" role="radio" :aria-checked="!paUseDefault && paCount === n" :disabled="!s.canEdit" @click="pickPreset(n)" :class="[segment(!paUseDefault && paCount === n, i + 1, paPresets.length + 1), SEG_TIGHT]"><Icon v-if="!paUseDefault && paCount === n" name="check" :size="18" />{{ T.playlistAdd.songs(n) }}</button>
          </div>

          <label class="flex items-center gap-2 text-sm" :class="s.canEdit ? '' : 'opacity-60'">
            <span class="text-on-surface-variant">{{ T.playlistAdd.custom }}</span>
            <input type="text" inputmode="numeric" :min="s.playlistAdd.min" :max="s.playlistAdd.max" step="1" :value="paUseDefault ? '' : paCount" :placeholder="String(s.playlistAdd.default)" :disabled="!s.canEdit" @input="onPaInput" @focus="typing = true" @blur="typing = false" @keydown.enter="($event.target as HTMLInputElement).blur()" :class="[FIELD, 'w-28 tabular-nums disabled:opacity-38', paInvalid && 'border-error! focus:border-error!']" />
            <span class="text-on-surface-variant">{{ T.playlistAdd.unit }}</span>
          </label>
          <div class="text-xs mt-1" :class="paInvalid ? 'text-error' : 'text-on-surface-variant'">
            <template v-if="paInvalid">{{ T.playlistAdd.invalid(s.playlistAdd.min, s.playlistAdd.max) }}</template>
            <template v-else
              >{{ T.playlistAdd.effectiveBefore }}<strong class="font-semibold text-on-surface">{{ T.playlistAdd.songs(paEffective) }}</strong
              >{{ T.playlistAdd.effectiveAfter(s.playlistAdd.min, s.playlistAdd.max) }}<code>/setplaylistlimit</code></template
            >
          </div>
        </BaseCard>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { problemText } from "../utils/problem.ts";
import { notifyProblem } from "../composables/toasts.ts";
import { TOPBAR_TEXT_BTN } from "../utils/topbar.ts";
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import axios from "axios";
import BaseCard from "../components/BaseCard.vue";
import BaseButton from "../components/BaseButton.vue";
import NoticeBox from "../components/NoticeBox.vue";
import PageError from "../components/PageError.vue";
import SaveIndicator, { type SaveState } from "../components/SaveIndicator.vue";
import { FIELD } from "../utils/field.ts";
import { problemCodeOf, replyOf } from "../utils/request.ts";
import SingleSelect from "../components/SingleSelect.vue";
import BaseSwitch from "../components/BaseSwitch.vue";
import SponsorCategories from "../components/SponsorCategories.vue";
import { useGuildsStore } from "../stores/guilds.ts";
import { HOLD, NO_ART, releasePageArt, setPageArt } from "../theme/theme.ts";
import Icon from "../components/BaseIcon.vue";
import { segment } from "../utils/segment.ts";
import { valueOf } from "../utils/dom.ts";
import { koMatch } from "../../../src/rules/ko-search.ts";
import { useOverflowing } from "../composables/overflowing.ts";
import { DJ_ROLE_MAX } from "../../../src/rules/limits.ts";
import type { GuildSettings, Saved } from "../../../src/dashboard/contract/guilds.ts";
import type { SettingsRequest } from "../../../src/dashboard/request-schemas.ts";
import { text } from "../text/index.ts";
const T = text.serverSettings;

/** 불러오기 전에는 이름 · SponsorBlock · 재생목록 필드가 없다 */
type SettingsSeen = Omit<GuildSettings, "guildName" | "sponsorblock" | "playlistAdd"> & { guildName: string | null; sponsorblock: GuildSettings["sponsorblock"] | null; playlistAdd: GuildSettings["playlistAdd"] | null };

// 좁은 카드에서 곡 수 입력란을 촘촘하게(SE 375 에서 카드 밖으로 넘쳤다)
const SEG_TIGHT = "@max-sm/card:px-2 @max-sm/card:gap-1";
const route = useRoute();
const router = useRouter();
const guildId = String(route.params.guildId);

const loading = ref(true);
const loadError = ref<string | null>(null);
// 읽기 실패가 서버가 없거나 멤버가 아니어서다(다시 해도 같다)
const loadGone = ref(false);
const GONE = ["guild-not-found", "no-guild-access"];
const s = ref<SettingsSeen>({ guildName: null, canEdit: false, djRoleIds: [], botChannelId: null, roles: [], channels: [], sponsorblock: null, playlistAdd: null });

// 편집 폼 상태 (서버 값과 분리. 저장 전까지 반영 안 됨)
const selectedRoles = ref<string[]>([]);
const selectedChannel = ref<string | null>(null);
const channelOptions = computed(() => s.value.channels.map((c) => ({ value: c.id, label: `# ${c.name}` })));
const roleFilter = ref("");
const sbEnabled = ref(true);
const sbCategories = ref<string[]>([]);
const roleListEl = ref<HTMLElement | null>(null);
const roleListOverflowing = useOverflowing(roleListEl);

const saving = ref(false);

const filteredRoles = computed(() => {
  return roleFilter.value.trim() ? s.value.roles.filter((r) => koMatch(r.name, roleFilter.value)) : s.value.roles;
});

const sbDirty = computed(() => {
  const sb = s.value.sponsorblock;
  if (!sb) return false;
  return sbEnabled.value !== sb.enabled || JSON.stringify([...sbCategories.value].sort()) !== JSON.stringify([...(sb.categories || [])].sort());
});

// 한 번에 넣을 재생목록 곡 수. 기본값(null) 또는 직접 지정한 값
const paUseDefault = ref(true);
const paCount = ref<number | null>(null);
const paPresets = computed(() => {
  const pa = s.value.playlistAdd;
  return pa ? [25, 50, 100, 200].filter((n) => n >= pa.min && n <= pa.max && n !== pa.default) : [];
});
const paValue = computed(() => (paUseDefault.value ? null : paCount.value));
const paInvalid = computed(() => {
  const pa = s.value.playlistAdd;
  if (!pa || paUseDefault.value) return false;
  const n = paCount.value;
  return !(n !== null && Number.isInteger(n) && n >= pa.min && n <= pa.max);
});
// 대기열 상한이 기본값보다 작으면 서버도 상한으로 자른다. 보이는 값을 맞춘다
function paClamp(n: number) {
  const pa = s.value.playlistAdd;
  return pa ? Math.min(pa.max, Math.max(pa.min, n)) : n;
}
const paEffective = computed(() => paClamp(paValue.value ?? s.value.playlistAdd?.default ?? 0));
const paDirty = computed(() => Boolean(s.value.playlistAdd) && paValue.value !== s.value.playlistAdd?.value);

function pickPreset(n: number) {
  paUseDefault.value = false;
  paCount.value = n;
}

// type="number" 를 안 쓴다. 입력란 위에서 휠을 굴리면 값이 바뀐다. 대신 숫자만 받는다.
function onPaInput(e: Event) {
  const input = e.target as HTMLInputElement;
  const raw = valueOf(e).replace(/[^0-9]/g, "");
  if (input.value !== raw) input.value = raw;
  if (raw === "") {
    paUseDefault.value = true;
    paCount.value = null;
    return;
  }
  paUseDefault.value = false;
  paCount.value = Number(raw);
}

function syncPaForm() {
  const v = s.value.playlistAdd?.value ?? null;
  paUseDefault.value = v === null;
  paCount.value = v;
}

const dirty = computed(() => selectedChannel.value !== s.value.botChannelId || JSON.stringify([...selectedRoles.value].sort()) !== JSON.stringify([...s.value.djRoleIds].sort()) || sbDirty.value || paDirty.value);

function toggleSbCategory(id: string) {
  const i = sbCategories.value.indexOf(id);
  if (i >= 0) sbCategories.value.splice(i, 1);
  else sbCategories.value.push(id);
}

function toggleRole(id: string) {
  const i = selectedRoles.value.indexOf(id);
  if (i >= 0) selectedRoles.value.splice(i, 1);
  else if (selectedRoles.value.length < DJ_ROLE_MAX) selectedRoles.value.push(id);
}

function syncSbForm() {
  const sb = s.value.sponsorblock;
  sbEnabled.value = sb ? sb.enabled : true;
  sbCategories.value = sb ? [...(sb.categories || [])] : [];
}

function apply(data: GuildSettings) {
  s.value = data;
  selectedRoles.value = [...data.djRoleIds];
  selectedChannel.value = data.botChannelId;
  syncSbForm();
  syncPaForm();
}

async function load() {
  try {
    apply((await axios.get<GuildSettings>(`/api/guilds/${guildId}/settings`)).data);
  } catch (e) {
    loadError.value = problemText(e, T.loadFailed);
    loadGone.value = GONE.includes(problemCodeOf(replyOf(e)) ?? "");
  } finally {
    loading.value = false;
  }
}

function retryLoad() {
  loading.value = true;
  loadError.value = null;
  void load();
}

// ── 자동 저장 ──
// 선택하면 0.4초 뒤 저장한다. 곡 수 직접 입력은 입력하는 동안(typing) 저장하지 않고 입력란을 벗어나거나 Enter 에 저장한다. 범위를 벗어나면 저장하지 않는다(입력란 아래 안내).
// 저장 중에 또 바뀌면 끝난 뒤 한 번 더. 저장한 값은 그대로 기준(s)으로 삼는다(다시 읽으면 그사이 고친 것을 덮는다). 실패는 표시 · 알림으로 알리고 고친 값은 둔다
const typing = ref(false);
const saveState = ref<SaveState>("idle");
let saveTimer = 0;
let doneTimer = 0;
let again = false;

function schedule() {
  clearTimeout(saveTimer);
  if (!s.value.canEdit || !dirty.value || typing.value || paInvalid.value) return;
  saveTimer = window.setTimeout(() => void save(), 400);
}
watch([selectedChannel, selectedRoles, sbEnabled, sbCategories, paValue], schedule, { deep: true });
watch(typing, (now) => !now && schedule());

async function save() {
  clearTimeout(saveTimer);
  if (saving.value) return void (again = true);
  saving.value = true;
  clearTimeout(doneTimer);
  saveState.value = "saving";
  // 보낸 그대로를 붙잡아 둔다(저장 중에 또 고친 것은 기준에 넣지 않아 다음 저장이 보낸다)
  const sent = { roles: [...selectedRoles.value], channel: selectedChannel.value, sbOn: sbEnabled.value, sbCats: [...sbCategories.value], pa: paValue.value };
  const body: SettingsRequest = {
    djRoleIds: sent.roles,
    botChannelId: sent.channel,
    sponsorblock: { enabled: sent.sbOn, categories: sent.sbCats },
    ...(s.value.playlistAdd && { playlistAddMax: sent.pa }),
  };
  try {
    const began = Date.now();
    await axios.put<Saved>(`/api/guilds/${guildId}/settings`, body);
    // 너무 빨리 끝나면 링이 깜빡이고 만다. 도는 모습을 0.6초는 보인다
    await new Promise((r) => setTimeout(r, Math.max(0, 600 - (Date.now() - began))));
    const sb = s.value.sponsorblock;
    const pa = s.value.playlistAdd;
    s.value = { ...s.value, djRoleIds: sent.roles, botChannelId: sent.channel, sponsorblock: sb && { ...sb, enabled: sent.sbOn, categories: sent.sbCats }, playlistAdd: pa && { ...pa, value: sent.pa } };
    saveState.value = "done";
  } catch (e) {
    saveState.value = "error";
    notifyProblem(e, T.saveFailed);
  } finally {
    saving.value = false;
    doneTimer = window.setTimeout(() => (saveState.value = "idle"), 1600);
    if (again) {
      again = false;
      schedule();
    }
  }
}

onMounted(load);

// 떠날 때 저장할 것이 남았으면(기다리는 중 · 입력 중) 마치고 떠난다. 범위를 벗어난 입력은 버린다
onBeforeRouteLeave(async () => {
  typing.value = false;
  if (s.value.canEdit && dirty.value && !paInvalid.value) await save();
});
onUnmounted(() => {
  clearTimeout(saveTimer);
  clearTimeout(doneTimer);
});

// 화면 색 · 배경화면은 이 서버의 지금 곡에서(서버 화면과 같은 곡 그림이라 재생 화면에서 들어오면 색이 그대로다).
// 서버 목록의 지금 곡이라 곡이 바뀌면 따라간다. 목록을 처음 불러오는 동안은 지금 색을 붙잡는다(주소로 바로 들어온 때)
const guilds = useGuildsStore();
const artOwner = Symbol("settings");
watch(
  () => (guilds.loading ? HOLD : (guilds.guilds.find((g) => g.id === guildId)?.nowPlaying?.thumbnail ?? NO_ART)),
  (url) => setPageArt(artOwner, url),
  { immediate: true },
);
onUnmounted(() => releasePageArt(artOwner));
</script>
