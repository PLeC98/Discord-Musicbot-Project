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
      <div class="text-5xl mb-3">⚠️</div>
      <p>{{ loadError }}</p>
    </div>

    <template v-else>
      <!-- DJ roles -->
      <BaseCard title="🎧 DJ 역할" class="mb-3">
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

      <!-- Bot channel -->
      <BaseCard title="📌 봇 전용 채널" class="mb-3">
        <p class="text-muted text-sm mb-3.5">지정 채널에서는 명령어 없이 링크나 검색어만 입력해도 재생돼요. 컨트롤 패널과 공지 발송도 이 채널을 우선합니다.</p>
        <select v-model="selectedChannel" :disabled="!s.canEdit" class="w-full bg-white/5 border border-white/9 rounded-xl text-fg px-3.5 py-2.5 text-[0.9rem] outline-none font-[inherit] cursor-pointer scheme-dark transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7 disabled:opacity-40 disabled:cursor-not-allowed">
          <option :value="null">지정 안 함</option>
          <option v-for="c in s.channels" :key="c.id" :value="c.id"># {{ c.name }}</option>
        </select>
      </BaseCard>

      <!-- SponsorBlock -->
      <BaseCard title="⏭️ SponsorBlock 자동 스킵" class="mb-3">
        <p class="text-muted text-sm mb-3.5">뮤직비디오의 인트로·최종 화면·음악이 아닌 구간 등을 SponsorBlock 데이터로 자동 건너뜁니다.</p>

        <div v-if="s.sponsorblock && !s.sponsorblock.masterEnabled" class="text-warning text-sm mb-1">봇 전역 설정에서 SponsorBlock이 꺼져 있어 이 서버 설정은 적용되지 않습니다.</div>

        <template v-if="s.sponsorblock">
          <label class="flex items-center gap-2.5 py-1.5 text-sm" :class="s.canEdit ? 'cursor-pointer' : 'opacity-60'">
            <input type="checkbox" class="size-4 accent-accent shrink-0" v-model="sbEnabled" :disabled="!s.canEdit" />
            <span>이 서버에서 자동 스킵 사용</span>
          </label>

          <div class="text-muted text-[0.8rem] mt-2 mb-1.5">건너뛸 구간 종류</div>
          <div class="rounded-xl border border-white/7 p-1.5 flex flex-col gap-0.5" :class="sbEnabled ? '' : 'opacity-40 pointer-events-none'">
            <label v-for="c in s.sponsorblock.available" :key="c.id" class="flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg text-sm transition-[background-color] duration-150" :class="s.canEdit ? 'cursor-pointer hover:bg-white/5' : 'opacity-60'">
              <input type="checkbox" class="size-4 accent-accent shrink-0" :checked="sbCategories.includes(c.id)" :disabled="!s.canEdit" @change="toggleSbCategory(c.id)" />
              <span>{{ c.label }}</span>
            </label>
          </div>
        </template>
      </BaseCard>

      <!-- Save / revert -->
      <div class="flex items-center gap-2.5 flex-wrap">
        <BaseButton variant="primary" :disabled="!s.canEdit || !dirty || saving" @click="save">{{ saving ? "저장 중..." : "저장" }}</BaseButton>
        <BaseButton variant="ghost" :disabled="!s.canEdit || !dirty || saving" @click="revert">되돌리기</BaseButton>
        <span v-if="dirty" class="text-warning text-[0.8rem]">저장되지 않은 변경이 있습니다</span>
      </div>

      <div v-if="result" :class="resultMsg(result.success)">
        {{ result.success ? "✅ 설정이 저장됐습니다" : `❌ 저장 실패: ${result.error}` }}
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import axios from "axios";
import BaseCard from "../components/BaseCard.vue";
import BaseButton from "../components/BaseButton.vue";

const route = useRoute();
const guildId = route.params.guildId;

const loading = ref(true);
const loadError = ref(null);
const s = ref({ guildName: null, canEdit: false, djRoleIds: [], botChannelId: null, roles: [], channels: [], sponsorblock: null });

// 편집 폼 상태 (서버 값과 분리 — 저장 전까지 반영 안 됨)
const selectedRoles = ref([]);
const selectedChannel = ref(null);
const roleFilter = ref("");
const sbEnabled = ref(true);
const sbCategories = ref([]);
const saving = ref(false);
const result = ref(null);

const filteredRoles = computed(() => {
  const q = roleFilter.value.trim().toLowerCase();
  return q ? s.value.roles.filter((r) => r.name.toLowerCase().includes(q)) : s.value.roles;
});

const sbDirty = computed(() => {
  const sb = s.value.sponsorblock;
  if (!sb) return false;
  return sbEnabled.value !== sb.enabled || JSON.stringify([...sbCategories.value].sort()) !== JSON.stringify([...(sb.categories || [])].sort());
});

const dirty = computed(() => selectedChannel.value !== s.value.botChannelId || JSON.stringify([...selectedRoles.value].sort()) !== JSON.stringify([...s.value.djRoleIds].sort()) || sbDirty.value);

function toggleSbCategory(id) {
  const i = sbCategories.value.indexOf(id);
  if (i >= 0) sbCategories.value.splice(i, 1);
  else sbCategories.value.push(id);
}

function resultMsg(ok) {
  const base = "mt-3 px-4 py-2.5 rounded-[10px] text-sm border";
  return ok ? `${base} bg-success/10 text-success border-success/22` : `${base} bg-danger/10 text-danger border-danger/22`;
}

function toggleRole(id) {
  const i = selectedRoles.value.indexOf(id);
  if (i >= 0) selectedRoles.value.splice(i, 1);
  else if (selectedRoles.value.length < 25) selectedRoles.value.push(id); // 디스코드 셀렉트 메뉴 한계와 정합
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
  result.value = null;
}

async function load() {
  try {
    const res = await axios.get(`/api/guilds/${guildId}/settings`);
    s.value = res.data;
    selectedRoles.value = [...res.data.djRoleIds];
    selectedChannel.value = res.data.botChannelId;
    syncSbForm();
  } catch (e) {
    loadError.value = e.response?.data?.error || "설정을 불러오지 못했습니다";
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (saving.value) return;
  saving.value = true;
  result.value = null;
  try {
    await axios.put(`/api/guilds/${guildId}/settings`, {
      djRoleIds: selectedRoles.value,
      botChannelId: selectedChannel.value,
      sponsorblock: { enabled: sbEnabled.value, categories: sbCategories.value },
    });
    result.value = { success: true };
    await load(); // 서버가 확정한 값(삭제 역할 정리 등)으로 동기화
  } catch (e) {
    result.value = { success: false, error: e.response?.data?.error || "요청 실패" };
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>
