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
      <!-- 카드는 폭을 다 쓰고 바탕화면이 넓어질수록 열이 는다(카드 한 장 360px 쯤: 768px~ 2열, 1152px~ 3열). 높이를 맞춘 격자가 아니라 열마다 위에서부터 채운다(카드 높이가 제각각이라 빈칸이 생기지 않게) -->
      <div class="columns-1 @3xl/desk:columns-2 @6xl/desk:columns-3 gap-(--gap-in) *:break-inside-avoid">
        <!-- 상주 모드(디스코드 /247, DJ 부터). 바꿀 수 없으면 스위치 줄 자리에 같은 높이의 안내 상자: 까닭(봇 문장표)과 잠근 스위치(지금 상태는 툴팁) -->
        <BaseCard v-if="s.stay" icon="local_convenience_store" :title="T.stay.title" class="mb-(--gap-in)">
          <p class="text-on-surface-variant text-sm mb-3">{{ T.stay.desc }}</p>
          <label v-if="!s.stay.refusal" class="flex items-center justify-between gap-3 py-2 text-sm cursor-pointer">
            <!-- 채널 이름이 길면 이름만 줄인다 -->
            <span v-if="s.stay.channel" class="min-w-0 flex"
              ><span class="shrink-0 whitespace-pre">{{ T.stay.enabledIn.before }}</span
              ><span class="truncate">{{ s.stay.channel.name }}</span
              ><span class="shrink-0">{{ T.stay.enabledIn.after }}</span></span
            >
            <span v-else>{{ s.stay.on ? T.stay.enabled : T.stay.enable }}</span>
            <BaseSwitch :model-value="stayShown" :disabled="stayBusy" @update:model-value="toggleStay" />
          </label>
          <NoticeBox v-else variant="gate" :icon="REFUSAL_ICON[s.stay.refusal] ?? 'block'" icon-class="text-on-surface-variant" class="min-h-0! py-2!">
            <span class="flex-1 min-w-0">{{ noticeText(s.stay.refusal).title }}</span>
            <!-- 꺼진 입력은 마우스 이벤트를 받지 않아 덮개가 툴팁을 받는다 -->
            <span v-tooltip="T.stay.locked(stayShown)" class="relative inline-flex shrink-0"><BaseSwitch :model-value="stayShown" disabled /><span class="absolute inset-0 z-20"></span></span>
          </NoticeBox>
        </BaseCard>

        <!-- 볼륨 정규화(디스코드 /normalize, DJ 부터). 봇이 음성 채널 밖이어도 바꿀 수 있다. 바꿀 수 없으면 상주 모드 카드와 같은 안내 상자 -->
        <BaseCard v-if="s.normalize" icon="graphic_eq" :title="T.normalize.title" class="mb-(--gap-in)">
          <p class="text-on-surface-variant text-sm mb-3">{{ T.normalize.desc }}</p>
          <label v-if="!s.normalize.refusal" class="flex items-center justify-between gap-3 py-2 text-sm cursor-pointer">
            <span>{{ normalizeShown ? T.normalize.enabled : T.normalize.enable }}</span>
            <BaseSwitch :model-value="normalizeShown" :disabled="normalizeBusy" @update:model-value="toggleNormalize" />
          </label>
          <NoticeBox v-else variant="gate" :icon="REFUSAL_ICON[s.normalize.refusal] ?? 'block'" icon-class="text-on-surface-variant" class="min-h-0! py-2!">
            <span class="flex-1 min-w-0">{{ noticeText(s.normalize.refusal).title }}</span>
            <span v-tooltip="T.normalize.locked(normalizeShown)" class="relative inline-flex shrink-0"><BaseSwitch :model-value="normalizeShown" disabled /><span class="absolute inset-0 z-20"></span></span>
          </NoticeBox>
        </BaseCard>

        <!-- 봇 전용 채널 -->
        <BaseCard v-if="s.channel" icon="keep" :title="T.channel.title" class="mb-(--gap-in)">
          <p class="text-on-surface-variant text-sm mb-3">{{ T.channel.desc }}</p>
          <SingleSelect :model-value="selectedChannel ?? ''" :options="channelOptions" :empty-label="T.channel.none" @update:model-value="selectedChannel = $event === '' ? null : String($event)" />
        </BaseCard>

        <!-- DJ 역할 -->
        <BaseCard v-if="s.dj" icon="headphones" :title="T.dj.title" class="mb-(--gap-in)">
          <p class="text-on-surface-variant text-sm mb-3">{{ T.dj.desc }}</p>

          <SearchInput v-model="roleFilter" :placeholder="text.fields.searchAmong(s.dj.roles.length)" :input-class="[FIELD, 'w-full disabled:opacity-38']" class="mb-2" />

          <!-- 스크롤바 트랙은 테두리 안쪽 모서리(12px - 1px)에 맞춰 위아래 11 - 5 = 6px 을 비우고, 넘치면 오른쪽 여백을 6 - 3 = 3px 로(useOverflowing) -->
          <div ref="roleListEl" class="h-66.5 overflow-y-auto rounded-(--r-inner) border border-outline-variant/50 flex flex-col [&::-webkit-scrollbar-track]:my-1.5" :class="roleListOverflowing ? 'py-1 pl-1 pr-px' : 'p-1'">
            <label v-for="r in filteredRoles" :key="r.id" class="state-layer cursor-pointer shrink-0 flex items-center gap-2 h-10 px-3 rounded-(--r-row) text-sm">
              <input type="checkbox" class="size-4 accent-primary shrink-0" :checked="selectedRoles.includes(r.id)" @change="toggleRole(r.id)" />
              <span class="size-2 rounded-full shrink-0" :style="{ backgroundColor: r.color || 'var(--md-outline)' }"></span>
              <span class="overflow-hidden whitespace-nowrap text-ellipsis">{{ r.name }}</span>
            </label>
            <div v-if="filteredRoles.length === 0" class="text-on-surface-variant text-sm px-3 py-3">{{ s.dj.roles.length === 0 ? T.dj.noRoles : T.dj.noMatch }}</div>
          </div>
          <div class="text-xs mt-1" :class="selectedRoles.length >= 25 ? 'text-(--warn-ink)' : 'text-on-surface-variant'">{{ T.dj.picked(selectedRoles.length, 25) }}</div>
        </BaseCard>

        <!-- SponsorBlock -->
        <BaseCard v-if="s.sponsorblock" icon="sponsorblock" :title="T.sponsor.title" class="mb-(--gap-in)">
          <p class="text-on-surface-variant text-sm mb-3">{{ T.sponsor.desc }}</p>

          <NoticeBox v-if="s.sponsorblock && !s.sponsorblock.masterEnabled" variant="note" tone="notice" icon="warning" class="mt-0! mb-2">{{ T.sponsor.masterOff }}</NoticeBox>

          <template v-if="s.sponsorblock">
            <label class="flex items-center justify-between gap-3 py-2 text-sm cursor-pointer">
              <span>{{ T.sponsor.enable }}</span>
              <BaseSwitch v-model="sbEnabled" />
            </label>

            <SponsorCategories class="mt-3" :label="T.sponsor.categories" :selected="sbCategories" editable :dimmed="!sbEnabled" @toggle="toggleSbCategory" />
          </template>
        </BaseCard>

        <!-- 재생목록 한 번에 넣을 곡 수 -->
        <BaseCard v-if="s.playlistAdd" icon="queue_music" :title="T.playlistAdd.title" class="mb-(--gap-in)">
          <p class="text-on-surface-variant text-sm mb-3">{{ T.playlistAdd.desc }}</p>

          <!-- 이어 붙은 버튼 그룹(M3E): 선택한 버튼은 완전히 둥글게, 체크. 카드가 좁으면(384px 미만, 작은 휴대폰) 버튼 안 여백, 체크 간격을 줄여 카드 안에 들게 -->
          <div class="flex gap-0.5 mb-3" role="radiogroup" :aria-label="T.playlistAdd.choose">
            <button type="button" role="radio" :aria-checked="paUseDefault" @click="paUseDefault = true" :class="[segment(paUseDefault, 0, paPresets.length + 1), SEG_TIGHT]">
              <Icon v-if="paUseDefault" name="check" :size="18" /><span class="hidden @[18rem]/card:inline">{{ T.playlistAdd.defaultLong }}</span
              ><span class="@[18rem]/card:hidden">{{ T.playlistAdd.defaultShort }}</span
              >{{ T.playlistAdd.songs(paClamp(s.playlistAdd.default)) }}
            </button>
            <button v-for="(n, i) in paPresets" :key="n" type="button" role="radio" :aria-checked="!paUseDefault && paCount === n" @click="pickPreset(n)" :class="[segment(!paUseDefault && paCount === n, i + 1, paPresets.length + 1), SEG_TIGHT]"><Icon v-if="!paUseDefault && paCount === n" name="check" :size="18" />{{ T.playlistAdd.songs(n) }}</button>
          </div>

          <label class="flex items-center gap-2 text-sm">
            <span class="text-on-surface-variant">{{ T.playlistAdd.custom }}</span>
            <input type="text" inputmode="numeric" :min="s.playlistAdd.min" :max="s.playlistAdd.max" step="1" :value="paUseDefault ? '' : paCount" :placeholder="String(s.playlistAdd.default)" @input="onPaInput" @focus="typing = true" @blur="typing = false" @keydown.enter="($event.target as HTMLInputElement).blur()" :class="[FIELD, 'w-28 tabular-nums disabled:opacity-38', paInvalid && 'border-error! focus:border-error!']" />
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

        <!-- 연령 제한 콘텐츠를 틀 곳. 봇 운영자가 연령 제한 콘텐츠를 꺼 두었으면 카드가 없다 -->
        <BaseCard v-if="s.agePlace" icon="no_adult_content" :title="T.agePlace.title" class="mb-(--gap-in)">
          <p class="text-on-surface-variant text-sm mb-3">{{ T.agePlace.desc }}</p>
          <div class="flex gap-0.5" role="radiogroup" :aria-label="T.agePlace.choose">
            <button v-for="(place, i) in AGE_PLACES" :key="place" type="button" role="radio" :aria-checked="agePlace === place" @click="agePlace = place" :class="[segment(agePlace === place, i, AGE_PLACES.length), SEG_TIGHT]"><Icon v-if="agePlace === place" name="check" :size="18" />{{ T.agePlace[place] }}</button>
          </div>
          <NoticeBox v-if="agePlace === 'all'" variant="note" tone="notice" icon="warning">{{ T.agePlace.allWarning }}</NoticeBox>
        </BaseCard>

        <!-- 봇 내보내기(디스코드에서 봇을 추방할 수 있는 사람). 되돌릴 수 없어 확인을 받는다 -->
        <BaseCard v-if="s.cards.includes('leave')" icon="logout" :title="T.leave.title" class="mb-(--gap-in)">
          <p class="text-on-surface-variant text-sm mb-3">{{ T.leave.desc }}</p>
          <BaseButton variant="danger" :disabled="leaving" @click="leaveAsking = true"><Icon name="logout" :size="20" />{{ T.leave.button }}</BaseButton>
        </BaseCard>
      </div>
    </template>
    <ConfirmDialog v-model="leaveAsking" icon="logout" :title="T.leave.confirmTitle(s.guildName ?? '')" :body="T.leave.confirmBody" :confirm-label="T.leave.button" :busy="leaving" @confirm="leaveGuild" />
    <!-- 저장하지 못한 고친 값을 두고 떠날 때(운영자 패널과 같은 확인) -->
    <ConfirmDialog :model-value="unsavedOpen" icon="edit_off" :title="text.admin.leaveConfirm.title" :body="text.admin.leaveConfirm.body" :confirm-label="text.admin.leaveConfirm.confirm" @update:model-value="(v) => !v && answerUnsaved(false)" @confirm="answerUnsaved(true)" />
  </div>
</template>

<script setup lang="ts">
import { noticeText, problemText } from "../utils/problem.ts";
import { notify, notifyProblem } from "../composables/toasts.ts";
import { TOPBAR_TEXT_BTN } from "../utils/topbar.ts";
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import axios from "axios";
import BaseCard from "../components/BaseCard.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import BaseButton from "../components/BaseButton.vue";
import NoticeBox from "../components/NoticeBox.vue";
import PageError from "../components/PageError.vue";
import SaveIndicator, { type SaveState } from "../components/SaveIndicator.vue";
import { FIELD } from "../utils/field.ts";
import { problemCodeOf, replyOf } from "../utils/request.ts";
import SingleSelect from "../components/SingleSelect.vue";
import SearchInput from "../components/SearchInput.vue";
import BaseSwitch from "../components/BaseSwitch.vue";
import SponsorCategories from "../components/SponsorCategories.vue";
import { onGuildNudge, useGuildsStore } from "../stores/guilds.ts";
import { HOLD, NO_ART, releasePageArt, setPageArt } from "../theme/theme.ts";
import Icon from "../components/BaseIcon.vue";
import { segment } from "../utils/segment.ts";
import { valueOf } from "../utils/dom.ts";
import { koMatch } from "../../../src/rules/ko-search.ts";
import { useOverflowing } from "../composables/overflowing.ts";
import { DJ_ROLE_MAX } from "../../../src/rules/limits.ts";
import { AGE_PLACES, type AgePlace } from "../../../src/rules/age-place.ts";
import type { GuildSettings, NormalizeCard, Saved, SettingsSaved, StayCard } from "../../../src/dashboard/contract/guilds.ts";
import type { Code } from "../../../src/rules/problems.ts";
import type { IconName } from "../icons.ts";
import { valueAt, type SettingsKey, type SettingsValues } from "../../../src/rules/guild-settings-values.ts";
import { createSettingsSaver } from "../utils/settings-draft.ts";
import { text } from "../text/index.ts";
const T = text.serverSettings;

/** 불러오기 전에는 이름이 없고 카드도 없다. 카드의 값은 보이는 카드만 온다 */
type SettingsSeen = Omit<GuildSettings, "guildName"> & { guildName: string | null };

// 좁은 카드에서 곡 수 입력란을 촘촘하게(아니면 iPhone SE 375px 에서 카드 밖으로 넘친다)
const SEG_TIGHT = "@max-sm/card:px-2 @max-sm/card:gap-1";
const route = useRoute();
const router = useRouter();
const guildId = String(route.params.guildId);

const loading = ref(true);
const loadError = ref<string | null>(null);
// 읽기 실패가 서버가 없거나 멤버가 아니어서다(다시 해도 같다)
const loadGone = ref(false);
const GONE = ["guild-not-found", "no-guild-access"];
const s = ref<SettingsSeen>({ guildName: null, cards: [] });

// 편집 폼 상태 (서버 값과 분리. 저장 전까지 반영 안 됨)
const selectedRoles = ref<string[]>([]);
const selectedChannel = ref<string | null>(null);
const channelOptions = computed(() => (s.value.channel?.channels ?? []).map((c) => ({ value: c.id, label: `# ${c.name}` })));
const roleFilter = ref("");
const sbEnabled = ref(true);
const sbCategories = ref<string[]>([]);
// 연령 제한 콘텐츠를 틀 곳. 카드가 없으면(운영자가 꺼 두었다) 보내지 않는다
const agePlace = ref<AgePlace>("channel");
const roleListEl = ref<HTMLElement | null>(null);
const roleListOverflowing = useOverflowing(roleListEl);

const filteredRoles = computed(() => {
  const roles = s.value.dj?.roles ?? [];
  return roleFilter.value.trim() ? roles.filter((r) => koMatch(r.name, roleFilter.value)) : roles;
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

// ── 상주 모드 ──
// 켜고 끄기는 저장(PATCH)이 아니라 바로 보낸다(/247 과 같은 처리). 보내는 동안은 바꾼 상태를 보여 주고, 실패하면 되돌린다. 요청은 저장과 같은 큐에 넣는다

/** 바꿀 수 없는 까닭의 아이콘(곡 추가 칸과 같은 짝). 그 밖은 막힘 */
const REFUSAL_ICON: Partial<Record<Code, IconName>> = { "must-be-in-voice": "headset_off", "must-be-in-same-voice": "headphones" };
const stayBusy = ref(false);
const stayWant = ref<boolean | null>(null);
const stayShown = computed(() => stayWant.value ?? Boolean(s.value.stay?.on));

function toggleStay(on: boolean) {
  if (stayBusy.value) return;
  stayBusy.value = true;
  stayWant.value = on;
  void saver.run(async () => {
    try {
      s.value = { ...s.value, stay: (await axios.post<StayCard>(`/api/guilds/${guildId}/settings/stay`, { on })).data };
    } catch (e) {
      notifyProblem(e, T.stay.failed);
    } finally {
      stayWant.value = null;
      stayBusy.value = false;
    }
  });
}

// ── 볼륨 정규화 ──
// 상주 모드처럼 저장(PATCH)이 아니라 바로 보낸다(/normalize 와 같은 처리)
const normalizeBusy = ref(false);
const normalizeWant = ref<boolean | null>(null);
const normalizeShown = computed(() => normalizeWant.value ?? Boolean(s.value.normalize?.on));

function toggleNormalize(on: boolean) {
  if (normalizeBusy.value) return;
  normalizeBusy.value = true;
  normalizeWant.value = on;
  void saver.run(async () => {
    try {
      s.value = { ...s.value, normalize: (await axios.post<NormalizeCard>(`/api/guilds/${guildId}/settings/normalize`, { on })).data };
    } catch (e) {
      notifyProblem(e, T.normalize.failed);
    } finally {
      normalizeWant.value = null;
      normalizeBusy.value = false;
    }
  });
}

// 다른 곳(디스코드 명령, 다른 탭, 음성 채널 출입)에서 바뀌었다는 신호. 모아서 다시 읽는다(고치던 값은 둔다)
let nudgeTimer = 0;
const offNudge = onGuildNudge((changed) => {
  if (changed && changed !== guildId) return;
  clearTimeout(nudgeTimer);
  nudgeTimer = window.setTimeout(() => saver.nudged(), 600);
});

// ── 봇 내보내기 ──
// 나가면 이 서버의 설정, 재생 화면을 다시 읽을 수 없다(봇이 없다). 서버 목록으로 간다
const leaveAsking = ref(false);
const leaving = ref(false);
let leftGuild = false;
async function leaveGuild() {
  if (leaving.value) return;
  leaving.value = true;
  const name = s.value.guildName ?? "";
  try {
    await axios.post<Saved>(`/api/guilds/${guildId}/settings/leave`);
    // 서버가 없어졌다. 남은 저장, 떠날 때 확인을 하지 않는다
    leftGuild = true;
    saver.stop();
    leaveAsking.value = false;
    notify({ title: T.leave.done(name), severity: "success" });
    void router.push("/servers");
  } catch (e) {
    notifyProblem(e, T.leave.failed);
  } finally {
    leaving.value = false;
  }
}

async function load() {
  try {
    saver.load((await axios.get<GuildSettings>(`/api/guilds/${guildId}/settings`)).data);
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
// 고치면 0.4초 뒤 저장한다. 언제 무엇을 보낼지, 응답과 다시 읽은 값을 어떻게 반영할지는 utils/settings-draft 의 저장 컨트롤러가 정한다.
// 곡 수를 직접 입력하는 동안(typing)이나 값이 범위를 벗어난 동안에는 그 카드만 저장하지 않는다(입력란 아래 안내). 실패 표시는 다음에 저장될 때까지 둔다
const typing = ref(false);
const saveState = ref<SaveState>("idle");
let doneTimer = 0;

// 화면 입력의 지금 값(보이는 카드만)
function readValues(): SettingsValues {
  const v = s.value;
  return {
    ...(v.channel && { botChannelId: selectedChannel.value }),
    ...(v.dj && { djRoleIds: [...selectedRoles.value] }),
    ...(v.sponsorblock && { sponsorblock: { enabled: sbEnabled.value, categories: [...sbCategories.value] } }),
    ...(v.playlistAdd && { playlistAddMax: paValue.value }),
    ...(v.agePlace !== undefined && { agePlace: agePlace.value }),
  };
}

// 키마다 그 입력만 고쳐 쓴다(다른 키의 고친 값을 덮지 않게). 구간이 null(운영자 기본을 따름)이면 기본 구간을 보여 준다
const WRITE: Record<SettingsKey, (value: unknown) => void> = {
  botChannelId: (value) => (selectedChannel.value = (value as string | null | undefined) ?? null),
  djRoleIds: (value) => (selectedRoles.value = [...((value as string[] | undefined) ?? [])]),
  "sponsorblock.enabled": (value) => (sbEnabled.value = (value as boolean | undefined) ?? true),
  "sponsorblock.categories": (value) => (sbCategories.value = [...((value as string[] | null | undefined) ?? s.value.sponsorblock?.defaultCategories ?? [])]),
  playlistAddMax(value) {
    const count = (value as number | null | undefined) ?? null;
    paUseDefault.value = count === null;
    paCount.value = count;
  },
  agePlace: (value) => (agePlace.value = (value as AgePlace | undefined) ?? "channel"),
};
function writeValues(values: SettingsValues, keys: readonly SettingsKey[]) {
  for (const key of keys) WRITE[key](valueAt(values, key));
}

const saver = createSettingsSaver({
  async send(patch) {
    const began = Date.now();
    const { data } = await axios.patch<SettingsSaved>(`/api/guilds/${guildId}/settings`, patch);
    // 너무 빨리 끝나면 링이 깜빡이고 만다. 도는 모습을 0.6초는 보인다
    await new Promise((r) => setTimeout(r, Math.max(0, 600 - (Date.now() - began))));
    return data;
  },
  fetch: async () => (await axios.get<GuildSettings>(`/api/guilds/${guildId}/settings`)).data,
  read: readValues,
  write: writeValues,
  hold: () => (typing.value || paInvalid.value ? ["playlistAddMax"] : []),
  // 켜고 끄는 중인 카드는 바꾼 상태를 보여 주고 있으니 덮어쓰지 않는다
  settings: (data) => (s.value = { ...data, stay: stayBusy.value ? s.value.stay : data.stay, normalize: normalizeBusy.value ? s.value.normalize : data.normalize }),
  saving() {
    clearTimeout(doneTimer);
    saveState.value = "saving";
  },
  saved() {
    saveState.value = "done";
    doneTimer = window.setTimeout(() => (saveState.value = "idle"), 1600);
  },
  failed(error, failure) {
    saveState.value = failure.kind === "other" ? "error" : "idle";
    // 권한이 바뀌었으면 설정을 다시 읽어 카드를 맞춘다(따로 알리지 않는다)
    if (failure.kind !== "permission") notifyProblem(error, T.saveFailed);
  },
  lost(error) {
    loadError.value = problemText(error, T.loadFailed);
    loadGone.value = true;
  },
});
watch([selectedChannel, selectedRoles, sbEnabled, sbCategories, paValue, agePlace], () => saver.edited(), { deep: true });
watch(typing, (now) => !now && saver.edited());

// 떠날 때는 남은 저장을 먼저 끝낸다(입력 중이던 값, 실패했던 것도 한 번 더 보낸다). 그래도 저장하지 못한 고친 값이 있으면 묻는다.
// 봇을 내보냈거나 이 화면을 더 볼 수 없으면 저장할 곳이 없다
const unsavedOpen = ref(false);
let unsavedAnswer: ((go: boolean) => void) | null = null;
onBeforeRouteLeave(async () => {
  if (leftGuild || loadError.value) return true;
  typing.value = false;
  if (!(await saver.flush()).length) return true;
  unsavedOpen.value = true;
  return new Promise<boolean>((resolve) => (unsavedAnswer = resolve));
});
/** 확인 대화상자의 답(떠나기, 취소, 바깥 누르기) */
function answerUnsaved(go: boolean) {
  unsavedOpen.value = false;
  unsavedAnswer?.(go);
  unsavedAnswer = null;
}
// 창 닫기, 새로고침은 브라우저가 묻는다
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!saver.unsaved().length) return;
  e.preventDefault();
  e.returnValue = "";
}

onMounted(() => {
  window.addEventListener("beforeunload", onBeforeUnload);
  void load();
});
onUnmounted(() => {
  window.removeEventListener("beforeunload", onBeforeUnload);
  saver.stop();
  clearTimeout(doneTimer);
  clearTimeout(nudgeTimer);
  offNudge();
});

// 화면 색, 배경화면은 이 서버의 지금 곡에서(서버 화면과 같은 앨범아트라 재생 화면에서 들어오면 색이 그대로다).
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
