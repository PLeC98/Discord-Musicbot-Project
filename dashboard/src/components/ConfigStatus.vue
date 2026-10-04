<!--
  상태 문구 편집기 (운영자 패널).

  이 설정은 파일(config/status.yaml)로도 고칠 수 있다. 대시보드는 선택 기능이다.
  그래서 저장은 파일을 통째로 덮지 않고 바뀐 자리만 고치며, 손으로 적은 주석은 그대로 남는다.
-->
<template>
  <div>
    <BaseCard icon="robot" title="상태 문구 전역 설정" class="mb-3">
      <p class="text-muted text-[0.82rem] mt-1 mb-3">디스코드 프로필에 뜨는 문구입니다. 아래 기간·시간대 문구 중 적용할 것이 없을 때 이 문구들을 번갈아 씁니다.</p>

      <label class="block mb-4 w-full">
        <span :class="labelCls">문구 변경 주기(초)</span>
        <NumberInput v-model="draft.interval" :class="inputCls" />
      </label>

      <MessageList v-model="messages" @add="messages.push(newMessage())" />
    </BaseCard>

    <BaseCard>
      <div class="flex items-start gap-3 mb-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.09em] text-[rgba(196,181,253,0.65)] mb-2">
            <Icon name="gear" :size="15" />
            <span>기간 · 시간대 문구 ({{ special.length }})</span>
          </div>
          <p class="text-muted text-[0.82rem]">위에서부터 우선적으로 적용되며, 조건을 둘 이상 적으면 전부 일치해야 출력됩니다.</p>
        </div>
        <button :class="addBtn" v-tooltip="'항목 추가'" @click="addSpecial"><Icon name="add" :size="18" /></button>
      </div>

      <div
        v-for="(entry, i) in special"
        :key="entry.key"
        class="border border-white/8 rounded-xl p-3 mb-2.5 bg-white/3 transition-[border-color,opacity] duration-150"
        :class="{
          'opacity-35': draggedIndex === i,
          'border-t-2 border-t-accent': dragOverIndex === i && draggedIndex !== i,
          'border-b-2 border-b-accent': dragOverIndex === special.length && i === special.length - 1,
        }"
        :draggable="dragReady"
        @dragstart="onDragStart($event, i)"
        @dragover="onDragOver($event, i)"
        @drop="onDrop"
        @dragend="onDragEnd"
      >
        <!-- 아래 여백은 펼쳐졌을 때만 필요하다. 여기에 두면 접었을 때 아래쪽만 넓어진다 -->
        <div class="flex items-center gap-2">
          <span class="text-muted cursor-grab active:cursor-grabbing opacity-35 hover:opacity-75 shrink-0 flex items-center px-0.5 transition-opacity duration-150 select-none" v-tooltip="'드래그하여 순서 변경'" @mousedown="armDrag">
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
              <circle cx="2" cy="3" r="1.5" />
              <circle cx="2" cy="8" r="1.5" />
              <circle cx="2" cy="13" r="1.5" />
              <circle cx="8" cy="3" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="8" cy="13" r="1.5" />
            </svg>
          </span>
          <button :class="foldBtn" v-tooltip="isFolded(specialFoldId(i)) ? '펼치기' : '접기'" @click="toggleFold(specialFoldId(i))">
            <svg width="11" height="7" viewBox="0 0 9 6" fill="currentColor" class="transition-transform duration-150" :class="{ '-rotate-90': isFolded(specialFoldId(i)) }"><path d="M0 0h9L4.5 6z" /></svg>
          </button>
          <input v-model="entry.name" placeholder="항목 이름 (크리스마스)" :class="[inputCls, 'flex-1']" />
          <!-- 접어 두면 조건과 문구가 안 보인다. 몇 개인지는 접힌 채로도 알려 준다 -->
          <span v-if="isFolded(specialFoldId(i))" class="text-[0.78rem] shrink-0" :class="entry.messages.length ? 'text-muted' : 'text-[#f87171]'">문구 {{ entry.messages.length }}개</span>
          <button :class="removeBtn" v-tooltip="'이 항목 삭제'" @click="removeSpecial(i)"><Icon name="trash" :size="15" /></button>
        </div>

        <div v-show="!isFolded(specialFoldId(i))" class="mt-2">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
            <label v-for="cond in CONDITIONS" :key="cond.key" class="block">
              <span :class="labelCls">{{ cond.label }}</span>
              <input v-model="entry[cond.key]" :placeholder="cond.placeholder" :class="[inputCls, 'font-mono text-[0.82rem]']" />
            </label>
          </div>

          <MessageList v-model="entry.messages" @add="entry.messages.push(newMessage())" />
        </div>
      </div>

      <div v-if="problems.length" class="mt-3 text-[0.82rem] text-[#f87171]">
        <div v-for="p in problems" :key="p" class="whitespace-pre-line">· {{ p }}</div>
      </div>

      <p v-if="savedAt" class="mt-3 text-muted text-[0.8rem]">저장됨. 다음 회전부터 반영됩니다</p>
      <p v-if="loadError" class="mt-3 text-[0.82rem] text-[#f87171] whitespace-pre-line">{{ loadError }}</p>
    </BaseCard>

    <SaveDock :dirty="dirty" :saving="saving" :blocked="problems.length > 0" @save="save" @revert="revert" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import BaseCard from "./BaseCard.vue";
import Icon from "./BaseIcon.vue";
import SaveDock from "./SaveDock.vue";
import MessageList from "./StatusMessageList.vue";
import NumberInput from "./NumberInput.vue";
import { isFolded, toggleFold, specialFoldId, reorderSpecials } from "../composables/config-folds.ts";
import { configFileIo, useConfigFile } from "../composables/config-file.ts";
import { useDragReorder } from "../composables/drag-reorder.ts";
import { CONDITIONS, newMessage, newSpecial, toMessages, fromMessages, toSpecial, fromSpecial, type MessageRow, type SpecialRow, type MessageData, type SpecialData } from "../utils/status-rows.ts";
import { MAX_TEXT } from "../../../src/config/schema/status.ts";

const inputCls = "w-full bg-white/5 border border-white/9 rounded-xl text-fg px-3.5 py-2 text-[0.9rem] outline-none font-[inherit] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7";
const labelCls = "block text-[0.8rem] text-muted mb-1.5";
const removeBtn = "h-[38px] w-[38px] rounded-xl border border-white/9 text-muted cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color,border-color] duration-150 hover:bg-danger/15 hover:text-danger hover:border-danger/30";
const addBtn = "size-9 rounded-xl border border-white/9 bg-white/5 text-fg-soft cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color] duration-150 hover:bg-white/10";
const foldBtn = "size-7 rounded-lg text-muted cursor-pointer flex items-center justify-center shrink-0 transition-colors duration-150 hover:text-fg hover:bg-white/8";

const draft = ref<{ interval: number | null }>({ interval: 60 });
const messages = ref<MessageRow[]>([]);
const special = ref<SpecialRow[]>([]);

const payload = computed(() => ({ interval: draft.value.interval, messages: fromMessages(messages.value), special: fromSpecial(special.value) }));

function apply(data: Record<string, unknown>) {
  draft.value = { interval: (data.interval as number | null | undefined) ?? 60 };
  messages.value = toMessages(data.messages as MessageData[] | undefined);
  special.value = toSpecial(data.special as Record<string, SpecialData> | undefined);
}

const { dirty, saving, savedAt, loadError, serverProblems, fetch, save, revert } = useConfigFile({ tab: "presence", payload: () => payload.value, apply, ...configFileIo("status") });

// 서버도 같은 것을 검사하지만, 저장 버튼을 누르기 전에 알려 주는 편이 낫다.
const RANGE = { date: /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, lunar: /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, time: /^([01][0-9]|2[0-3]):[0-5][0-9]$/ };

function messageProblems(list: MessageRow[], where: string) {
  const found: string[] = [];
  if (!list.length) found.push(`${where}: 문구가 하나는 있어야 합니다.`);
  for (const m of list) {
    if (!m.text.trim()) found.push(`${where}: 빈 문구가 있습니다.`);
    else if (m.text.length > MAX_TEXT) found.push(`${where}: 문구가 ${MAX_TEXT}자를 넘습니다.`);
  }
  return found;
}

const problems = computed(() => {
  const found: string[] = [];
  if (!(Number(draft.value.interval) >= 10)) found.push("간격은 10초 이상이어야 합니다.");
  found.push(...messageProblems(messages.value, "평소 문구"));

  const names = special.value.map((e) => e.name.trim());
  if (names.some((n) => !n)) found.push("이름이 빈 항목이 있습니다.");
  if (new Set(names).size !== names.length) found.push("이름이 겹칩니다.");

  for (const entry of special.value) {
    const name = entry.name.trim() || "이름 없는 항목";
    if (["true", "false", "null"].includes(name)) found.push(`"${name}"는 이름으로 쓸 수 없습니다.`);
    if (/^(0|[1-9][0-9]*)$/.test(name)) found.push(`"${name}": 숫자만으로 된 이름은 차례가 어긋납니다.`);

    const filled = CONDITIONS.filter((c) => entry[c.key]?.trim());
    if (!filled.length) found.push(`${name}: 양력·음력·시간대 중 하나는 적어야 합니다.`);

    for (const cond of filled) {
      const parts = entry[cond.key].split("~").map((p) => p.trim());
      if (parts.length !== 2 || parts.some((p) => !RANGE[cond.key].test(p))) found.push(`${name}의 ${cond.label}: "${cond.placeholder}"처럼 두 자리로 적어야 합니다.`);
    }

    found.push(...messageProblems(entry.messages, name));
  }

  return [...found, ...serverProblems.value];
});

// ── 순서 바꾸기. 접어 둔 기억도 그 항목을 따라간다 ─────────────────────────
const { draggedIndex, dragOverIndex, dragReady, armDrag, onDragStart, onDragOver, onDrop, onDragEnd } = useDragReorder(special, reorderSpecials);

function addSpecial() {
  special.value.push(newSpecial());
}

// 접힘은 자리로 기억한다. 지우면 그 아래의 기억이 한 칸씩 당겨진다
function removeSpecial(i: number) {
  reorderSpecials(special.value.map((_, at) => at).filter((at) => at !== i));
  special.value.splice(i, 1);
}

onMounted(fetch);
</script>
