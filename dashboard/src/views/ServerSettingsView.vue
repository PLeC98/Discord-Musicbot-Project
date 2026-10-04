<template>
  <div class="max-w-275 mx-auto px-3 py-4.5">
    <div class="mb-4">
      <router-link :to="`/servers/${guildId}`" class="text-muted no-underline text-sm px-2.5 py-1.25 rounded-lg inline-flex items-center gap-1 transition-[color,background-color] duration-200 hover:text-fg hover:bg-white/6">← {{ s.guildName || "재생 화면" }}</router-link>
    </div>

    <h1 class="pl-2 text-2xl font-extrabold mb-1.5 tracking-tight bg-linear-135 from-[#e8eaf6] via-[#c4b5fd] via-55% to-[#a78bfa] bg-clip-text text-transparent">서버 설정</h1>
    <p class="pl-2 text-muted mb-4.5 text-[0.9rem]">
      <strong v-if="s.guildName" class="text-fg-soft">{{ s.guildName }}</strong
      ><template v-else>이</template> 서버에서의 봇 동작을 설정합니다.
    </p>

    <div v-if="loading" class="flex items-center justify-center p-20 text-muted">불러오는 중...</div>

    <div v-else-if="loadError" class="text-center px-5 py-15 text-muted">
      <Icon name="warning" :size="48" class="mb-3 text-warning" />
      <p class="whitespace-pre-line">{{ loadError }}</p>
    </div>

    <template v-else>
      <!-- DJ 역할 -->
      <BaseCard icon="headphones" title="DJ 역할" class="mb-3">
        <p class="text-muted text-sm mb-3.5">지정하면 재생 제어를 역할 보유자와 모더레이터만 사용할 수 있어요. 지정하지 않으면 모든 유저가 제어할 수 있습니다.</p>

        <input v-model="roleFilter" :disabled="!s.canEdit" placeholder="역할 검색..." class="w-full bg-white/5 border border-white/9 rounded-xl text-fg px-3.5 py-2 text-[0.9rem] outline-none mb-2.5 font-[inherit] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7 disabled:opacity-40" />

        <div class="max-h-60 overflow-y-auto rounded-xl border border-white/7 p-1.5 flex flex-col gap-0.5 min-h-60 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-(--sb-track-color) [&::-webkit-scrollbar-track]:rounded-[5px] [&::-webkit-scrollbar-thumb]:bg-(--sb-thumb-color) [&::-webkit-scrollbar-thumb]:rounded-[5px]">
          <label v-for="r in filteredRoles" :key="r.id" class="flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg text-sm transition-[background-color] duration-150" :class="s.canEdit ? 'cursor-pointer hover:bg-white/5' : 'opacity-60'">
            <input type="checkbox" class="size-4 accent-accent shrink-0" :checked="selectedRoles.includes(r.id)" :disabled="!s.canEdit" @change="toggleRole(r.id)" />
            <span class="size-2.5 rounded-full shrink-0" :style="{ backgroundColor: r.color || 'rgba(255,255,255,0.25)' }"></span>
            <span class="overflow-hidden whitespace-nowrap text-ellipsis">{{ r.name }}</span>
          </label>
          <div v-if="filteredRoles.length === 0" class="text-muted text-sm px-2.5 py-2">{{ s.roles.length === 0 ? "이 서버에 지정할 수 있는 역할이 없습니다" : "일치하는 역할이 없습니다" }}</div>
        </div>
        <div class="text-[0.8rem] mt-2" :class="selectedRoles.length >= 25 ? 'text-warning' : 'text-muted'">선택됨: {{ selectedRoles.length }} / 25</div>
      </BaseCard>

      <!-- 봇 전용 채널 -->
      <BaseCard icon="pin" title="봇 전용 채널" class="mb-3">
        <p class="text-muted text-sm mb-3.5">지정 채널에서는 명령어 없이 링크나 검색어만 입력해도 재생돼요. 컨트롤 패널과 공지 발송도 이 채널을 우선합니다.</p>
        <div class="relative">
          <select v-model="selectedChannel" :disabled="!s.canEdit" class="w-full appearance-none bg-white/5 border border-white/9 rounded-xl text-fg pl-3.5 pr-10 py-2.5 text-[0.9rem] outline-none font-[inherit] cursor-pointer scheme-dark transition-[border-color,background-color] duration-200 hover:border-white/15 focus:border-accent/55 focus:bg-white/7 disabled:opacity-40 disabled:cursor-not-allowed">
            <option :value="null" style="background-color: #0e1228; color: #e8eaf6">지정 안 함</option>
            <option v-for="c in s.channels" :key="c.id" :value="c.id" style="background-color: #0e1228; color: #e8eaf6"># {{ c.name }}</option>
          </select>
          <svg class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
        </div>
      </BaseCard>

      <!-- SponsorBlock -->
      <BaseCard icon="skip" title="SponsorBlock 자동 스킵" class="mb-3">
        <p class="text-muted text-sm mb-3.5">뮤직비디오의 인트로·최종 화면·음악이 아닌 구간 등을 SponsorBlock 데이터로 자동 건너뜁니다.</p>

        <div v-if="s.sponsorblock && !s.sponsorblock.masterEnabled" class="text-warning text-sm mb-1">봇 전역 설정에서 SponsorBlock이 꺼져 있어 이 서버 설정은 적용되지 않습니다.</div>

        <template v-if="s.sponsorblock">
          <label class="flex items-center gap-2.5 py-1.5 text-sm" :class="s.canEdit ? 'cursor-pointer' : 'opacity-60'">
            <input type="checkbox" class="size-4 accent-accent shrink-0" v-model="sbEnabled" :disabled="!s.canEdit" />
            <span>이 서버에서 자동 스킵 사용</span>
          </label>

          <div class="flex items-center gap-1.5 mt-2 mb-1.5">
            <span class="text-muted text-[0.8rem]">건너뛸 구간 종류</span>
            <button type="button" @click="sbHelpOpen = !sbHelpOpen" class="text-muted hover:text-fg transition-colors" v-tooltip="sbHelpOpen ? '설명 닫기' : '각 구간 설명 보기'" aria-label="각 구간 설명">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /></svg>
            </button>
          </div>

          <!-- 구간 설명 패널. 설명은 서버가 이름과 함께 준다(rules/sponsor-categories) -->
          <div v-if="sbHelpOpen" class="rounded-xl border border-white/7 bg-white/3 p-2.5 mb-1.5 flex flex-col gap-1.5 text-[0.8rem]">
            <div v-for="c in s.sponsorblock.available" :key="'help' + c.id" class="flex gap-2">
              <span class="text-fg-soft font-medium shrink-0 min-w-24">{{ c.label }}</span>
              <span class="text-muted">{{ c.description }}</span>
            </div>
          </div>

          <div class="rounded-xl border border-white/7 p-1.5 flex flex-col gap-0.5" :class="sbEnabled ? '' : 'opacity-40 pointer-events-none'">
            <label v-for="c in s.sponsorblock.available" :key="c.id" class="flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg text-sm transition-[background-color] duration-150" :class="s.canEdit ? 'cursor-pointer hover:bg-white/5' : 'opacity-60'">
              <input type="checkbox" class="size-4 accent-accent shrink-0" :checked="sbCategories.includes(c.id)" :disabled="!s.canEdit" @change="toggleSbCategory(c.id)" />
              <span>{{ c.label }}</span>
            </label>
          </div>
        </template>
      </BaseCard>

      <!-- 재생목록 한 번에 넣을 곡 수 -->
      <BaseCard v-if="s.playlistAdd" icon="list" title="재생목록 한 번에 넣는 곡 수" class="mb-3">
        <p class="text-muted text-sm mb-3.5">긴 재생목록을 넣으면 이만큼만 먼저 들어가고, 남은 곡은 "더 넣기"로 이어 넣을 수 있어요. 더 넣기 메뉴의 선택지도 이 단위로 나옵니다.</p>

        <div class="flex flex-wrap gap-1.5 mb-3" role="radiogroup" aria-label="곡 수 선택">
          <button type="button" role="radio" :aria-checked="paUseDefault" :disabled="!s.canEdit" @click="paUseDefault = true" :class="chip(paUseDefault)">기본값 · {{ paClamp(s.playlistAdd.default) }}곡</button>
          <button v-for="n in paPresets" :key="n" type="button" role="radio" :aria-checked="!paUseDefault && paCount === n" :disabled="!s.canEdit" @click="pickPreset(n)" :class="chip(!paUseDefault && paCount === n)">{{ n }}곡</button>
        </div>

        <label class="flex items-center gap-2.5 text-sm" :class="s.canEdit ? '' : 'opacity-60'">
          <span class="text-muted">직접 입력</span>
          <input
            type="text"
            inputmode="numeric"
            :min="s.playlistAdd.min"
            :max="s.playlistAdd.max"
            step="1"
            :value="paUseDefault ? '' : paCount"
            :placeholder="String(s.playlistAdd.default)"
            :disabled="!s.canEdit"
            @input="onPaInput"
            class="w-28 bg-white/5 border border-white/9 rounded-xl text-fg px-3 py-1.75 text-[0.9rem] outline-none font-[inherit] tabular-nums transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7 disabled:opacity-40"
            :class="paInvalid ? 'border-danger/60' : ''"
          />
          <span class="text-muted">곡</span>
        </label>
        <div class="text-[0.8rem] mt-2" :class="paInvalid ? 'text-danger' : 'text-muted'">
          <template v-if="paInvalid">{{ s.playlistAdd.min }}~{{ s.playlistAdd.max }}곡 사이의 정수로 정해 주세요.</template>
          <template v-else
            >재생목록을 넣으면 한 번에 <strong class="text-fg-soft">{{ paEffective }}곡</strong>씩 들어가요 · {{ s.playlistAdd.min }}~{{ s.playlistAdd.max }}곡 · 디스코드에서는 <code>/setplaylistlimit</code></template
          >
        </div>
      </BaseCard>

      <!-- 저장/되돌리기는 화면 오른쪽 아래에 떠 있다. 설정이 길어 맨 밑까지 스크롤하지 않아도 되게 -->
      <SaveDock :dirty="dirty && s.canEdit" :saving="saving" :blocked="paInvalid" @save="save" @revert="revert" />

      <div v-if="result" :class="resultMsg(result.success)" class="flex items-center gap-1.5">
        <Icon :name="result.success ? 'check' : 'error'" :size="16" />
        <span class="whitespace-pre-line">{{ result.success ? "설정이 저장됐습니다" : `저장 실패: ${result.error}` }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { problemText } from "../utils/problem.ts";
import { notifyProblem } from "../composables/toasts.ts";
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import axios from "axios";
import BaseCard from "../components/BaseCard.vue";
import SaveDock from "../components/SaveDock.vue";
import Icon from "../components/BaseIcon.vue";
import { valueOf } from "../utils/dom.ts";
import { DJ_ROLE_MAX } from "../../../src/rules/limits.ts";
import type { GuildSettings, Saved } from "../../../src/dashboard/contract/guilds.ts";
import type { SettingsRequest } from "../../../src/dashboard/request-schemas.ts";

/** 받기 전에는 이름 · SponsorBlock · 재생목록 칸이 없다 */
type SettingsSeen = Omit<GuildSettings, "guildName" | "sponsorblock" | "playlistAdd"> & { guildName: string | null; sponsorblock: GuildSettings["sponsorblock"] | null; playlistAdd: GuildSettings["playlistAdd"] | null };

const route = useRoute();
const guildId = String(route.params.guildId);

const loading = ref(true);
const loadError = ref<string | null>(null);
const s = ref<SettingsSeen>({ guildName: null, canEdit: false, djRoleIds: [], botChannelId: null, roles: [], channels: [], sponsorblock: null, playlistAdd: null });

// 편집 폼 상태 (서버 값과 분리. 저장 전까지 반영 안 됨)
const selectedRoles = ref<string[]>([]);
const selectedChannel = ref<string | null>(null);
const roleFilter = ref("");
const sbEnabled = ref(true);
const sbCategories = ref<string[]>([]);
const sbHelpOpen = ref(false);

const saving = ref(false);
const result = ref<{ success: true } | { success: false; error: string } | null>(null);

const filteredRoles = computed(() => {
  const q = roleFilter.value.trim().toLowerCase();
  return q ? s.value.roles.filter((r) => r.name.toLowerCase().includes(q)) : s.value.roles;
});

const sbDirty = computed(() => {
  const sb = s.value.sponsorblock;
  if (!sb) return false;
  return sbEnabled.value !== sb.enabled || JSON.stringify([...sbCategories.value].sort()) !== JSON.stringify([...(sb.categories || [])].sort());
});

// 재생목록 한 번에 넣는 곡 수. 기본값(null) 또는 직접 정한 값
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

// type="number" 를 안 쓴다. 칸 위에서 휠을 굴리면 값이 바뀐다. 대신 숫자만 받는다.
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

function chip(active: boolean) {
  const base = "px-3 py-1.5 rounded-full text-[0.85rem] border transition-[background-color,border-color,color] duration-150 disabled:opacity-40 disabled:cursor-not-allowed";
  return active ? `${base} bg-accent/20 border-accent/55 text-fg` : `${base} bg-white/4 border-white/9 text-muted hover:text-fg hover:border-white/18`;
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

function resultMsg(ok: boolean) {
  const base = "mt-3 px-4 py-2.5 rounded-[10px] text-sm border";
  return ok ? `${base} bg-success/10 text-success border-success/22` : `${base} bg-danger/10 text-danger border-danger/22`;
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

function revert() {
  selectedRoles.value = [...s.value.djRoleIds];
  selectedChannel.value = s.value.botChannelId;
  syncSbForm();
  syncPaForm();
  result.value = null;
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
    loadError.value = problemText(e, "설정을 불러오지 못했습니다");
  } finally {
    loading.value = false;
  }
}

// 저장 뒤 서버가 확정한 값(지운 역할 정리 등)으로 맞춘다. 못 읽어도 저장은 됐으니 화면은 두고 알리기만 한다
async function reload() {
  try {
    apply((await axios.get<GuildSettings>(`/api/guilds/${guildId}/settings`)).data);
  } catch (e) {
    notifyProblem(e, "저장한 설정을 다시 읽지 못했어요.");
  }
}

async function save() {
  if (saving.value) return;
  saving.value = true;
  result.value = null;
  try {
    const body: SettingsRequest = {
      djRoleIds: selectedRoles.value,
      botChannelId: selectedChannel.value,
      sponsorblock: { enabled: sbEnabled.value, categories: sbCategories.value },
      ...(s.value.playlistAdd && { playlistAddMax: paValue.value }),
    };
    await axios.put<Saved>(`/api/guilds/${guildId}/settings`, body);
    result.value = { success: true };
    await reload();
  } catch (e) {
    result.value = { success: false, error: problemText(e, "요청 실패") };
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>
