<!--
  상태 문구 편집기 (운영자 패널).

  설정은 settings.db 의 "status" 문서다. 저장 번호로 두 탭이 서로 덮지 않게 한다(composables/config-file).
-->
<template>
  <!-- 목록(첫 줄 "기본 문구", 그 아래 기간 · 시간대 문구. 위에 있는 것이 먼저 맞는다) · 고른 것의 편집(M3 목록 · 상세, composables/list-detail).
       고른 것은 주소 ?presence=이름(기본 문구는 @defaults) -->
  <div class="flex flex-col gap-(--gap-in)">
    <div ref="paneEl" :class="paneClass">
      <BaseCard v-if="showList" icon="headphones" :title="T.title" :class="listCardClass">
        <template #actions>
          <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="T.addSpecial" v-tooltip="text.common.add" @click="addSpecial"><Icon name="add" :size="20" /></button>
        </template>
        <p class="mb-3 text-sm text-on-surface-variant">{{ T.desc }}</p>
        <!-- 어느 줄의 것도 아닌 문제(저장할 때 서버가 짚은 것 등) · 읽기 실패. 줄마다의 문제는 그 줄의 오류 아이콘과 편집 칸 맨 위에 -->
        <NoticeBox v-if="listProblems.length" variant="note" tone="error" icon="error" class="mt-0! mb-3">{{ listProblems.join("\n") }}</NoticeBox>
        <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0! mb-3">{{ loadError }}</NoticeBox>
        <div ref="listEl" class="min-h-0 overflow-y-auto -mx-2 px-2" :style="listFade">
          <!-- 첫 줄: 기본 문구(변경 주기 · 평소 문구). 손잡이 자리는 비워 아래 줄과 아이콘을 맞춘다 -->
          <div role="button" tabindex="0" :class="[LIST_ROW, globalOn && SELECT_ROW_ON]" :aria-current="globalOn ? 'true' : undefined" @click="openGlobal" @keydown.enter="openGlobal">
            <span class="size-5 shrink-0" />
            <Icon name="chat" :size="24" class="shrink-0" :class="!globalOn && 'text-on-surface-variant'" />
            <span class="min-w-0 flex-1 truncate">{{ T.defaults }}</span>
            <Icon v-if="globalProblems.length" name="error" :size="20" fill class="shrink-0" :class="!globalOn && 'text-error'" v-tooltip="globalProblems.join('\n')" />
            <span class="shrink-0 text-xs nums" :class="!globalOn && 'text-on-surface-variant'">{{ T.messageCount(messages.length) }}</span>
            <Icon name="chevron_right" :size="20" class="shrink-0 -mr-1" :class="!globalOn && 'text-on-surface-variant'" />
          </div>
          <div class="h-px my-1 mx-3 bg-outline-variant/40" />
          <div v-for="(entry, i) in special" :key="entry.key" role="button" tabindex="0" :class="[LIST_ROW, isOn(i) && SELECT_ROW_ON]" :aria-current="isOn(i) ? 'true' : undefined" data-reorder @click="select(i)" @keydown.enter="select(i)">
            <span class="shrink-0 flex touch-none cursor-grab active:cursor-grabbing" :class="isOn(i) ? '' : 'text-outline'" v-tooltip="T.dragToReorder" @pointerdown="startDrag($event, i)" @click.stop><Icon name="drag_indicator" :size="20" /></span>
            <!-- 조건 종류(양력 · 음력 · 시간대, 여럿이면 앞의 것). 올리면 적힌 조건 -->
            <Icon :name="conditionIcon(entry)" :size="24" class="shrink-0" :class="!isOn(i) && 'text-on-surface-variant'" v-tooltip="conditionText(entry) || T.noCondition" />
            <span class="min-w-0 flex-1 truncate" :class="!entry.name.trim() && !isOn(i) && 'text-on-surface-variant'">{{ entry.name.trim() || T.noName }}</span>
            <Icon v-if="rowProblem(entry)" name="error" :size="20" fill class="shrink-0" :class="!isOn(i) && 'text-error'" v-tooltip="rowProblem(entry)" />
            <span class="shrink-0 text-xs nums" :class="!isOn(i) && 'text-on-surface-variant'">{{ T.messageCount(entry.messages.length) }}</span>
            <Icon name="chevron_right" :size="20" class="shrink-0 -mr-1" :class="!isOn(i) && 'text-on-surface-variant'" />
          </div>
          <p v-if="loaded && !special.length" class="px-3 py-3 text-sm text-on-surface-variant">{{ T.empty }}</p>
        </div>
      </BaseCard>

      <!-- 기본 문구 편집 -->
      <BaseCard v-if="showGlobal">
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-3 min-h-10">
            <span class="size-10 shrink-0 rounded-(--r-inner) bg-surface-container-highest flex items-center justify-center text-on-surface-variant"><Icon name="chat" :size="24" /></span>
            <h3 class="flex-1 min-w-0 truncate text-base font-semibold text-on-surface">{{ T.defaults }}</h3>
          </div>
          <NoticeBox v-if="globalProblems.length" variant="note" tone="error" icon="error" class="mt-0!">{{ globalProblems.join("\n") }}</NoticeBox>
          <p class="text-sm text-on-surface-variant">{{ T.defaultsDesc }}</p>
          <label class="block w-full @lg/card:w-60">
            <span :class="FIELD_LABEL">{{ T.interval }}</span>
            <NumberInput v-model="draft.interval" :placeholder="T.ifEmpty(INTERVAL_DEFAULT)" :class="[FIELD, 'w-full']" />
          </label>
          <section class="flex flex-col gap-2">
            <h3 class="text-sm font-semibold text-on-surface">{{ T.messages }}</h3>
            <PresenceMessageList v-model="messages" @add="messages.push(newMessage())" />
          </section>
        </div>
      </BaseCard>

      <!-- 기간 · 시간대 문구 편집 -->
      <BaseCard v-if="selected">
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-3">
            <input :value="selected.name" :placeholder="T.namePlaceholder" :class="[FIELD, 'min-w-0 flex-1']" @input="selected.name = valueOf($event)" />
            <button type="button" :class="[ICON_BTN, 'size-8', 'hover:text-error']" :aria-label="T.removeSpecial" v-tooltip="T.removeSpecial" @click="removeSpecial(selectedIndex)"><Icon name="delete" :size="20" /></button>
          </div>
          <NoticeBox v-if="rowProblems(selected).length" variant="note" tone="error" icon="error" class="mt-0!">{{ rowProblems(selected).join("\n") }}</NoticeBox>

          <section class="flex flex-col gap-2">
            <div>
              <h3 class="text-sm font-semibold text-on-surface">{{ T.conditions }}</h3>
              <p class="mt-1 text-xs text-on-surface-variant">{{ T.conditionsDesc }}</p>
            </div>
            <div class="grid grid-cols-1 @lg/card:grid-cols-3 gap-3">
              <label v-for="cond in CONDITIONS" :key="cond.key" class="block">
                <span :class="FIELD_LABEL">{{ cond.label }}</span>
                <input :value="selected[cond.key]" :placeholder="cond.placeholder" :class="[FIELD, 'w-full nums']" @input="selected[cond.key] = valueOf($event)" />
              </label>
            </div>
          </section>

          <section class="flex flex-col gap-2 pt-3 border-t border-outline-variant/40">
            <h3 class="text-sm font-semibold text-on-surface">{{ T.messages }}</h3>
            <PresenceMessageList :key="selected.key" v-model="selected.messages" @add="selected.messages.push(newMessage())" />
          </section>
        </div>
      </BaseCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import { valueOf } from "../utils/dom.ts";
import { ref, computed, onMounted } from "vue";
import BaseCard from "./BaseCard.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import PresenceMessageList from "./PresenceMessageList.vue";
import NumberInput from "./NumberInput.vue";
import { FIELD, FIELD_LABEL } from "../utils/field.ts";
import { SELECT_ROW_ON } from "../utils/select-row.ts";
import { useScrollFade } from "../composables/scroll-fade.ts";
import { configFileIo, useConfigFile } from "../composables/config-file.ts";
import { useSaveTarget } from "../composables/save-targets.ts";
import { useDragReorder } from "../composables/drag-reorder.ts";
import { useListDetail, LIST_ROW } from "../composables/list-detail.ts";
import { CONDITIONS, newMessage, newSpecial, toMessages, fromMessages, toSpecial, fromSpecial, type MessageRow, type SpecialRow, type MessageData, type SpecialData } from "../utils/presence-rows.ts";
import { INTERVAL_DEFAULT, statusProblems } from "../../../src/config/schema/status.ts";
import { text } from "../text/index.ts";
const T = text.presence;

const draft = ref<{ interval: number | null }>({ interval: INTERVAL_DEFAULT });
const messages = ref<MessageRow[]>([]);
const special = ref<SpecialRow[]>([]);

const payload = computed(() => ({ interval: draft.value.interval, messages: fromMessages(messages.value), special: fromSpecial(special.value) }));

function apply(data: Record<string, unknown>) {
  // 파일에 없으면 봇이 쓰는 기본값을 보인다(손대지 않고 저장해도 동작이 바뀌지 않게)
  draft.value = { interval: (data.interval as number | null | undefined) ?? INTERVAL_DEFAULT };
  messages.value = toMessages(data.messages as MessageData[] | undefined);
  special.value = toSpecial(data.special as Record<string, SpecialData> | undefined);
}

const { loaded, dirty, saving, loadError, serverProblems, fetch, save, revert } = useConfigFile({ tab: "presence", savedNote: T.savedNote, payload: () => payload.value, apply, ...configFileIo("status") });

// 저장할 때 서버가 보는 검사 그대로(schema/status). 저장 버튼을 누르기 전에 알려 준다
const problems = computed(() => (loaded.value ? [...statusProblems(payload.value), ...serverProblems.value] : []));
// 운영자 패널의 저장 막대에 올린다(검사에 걸린 값이 있으면 막대가 저장을 막는다)
useSaveTarget({ tab: "presence", dirty, saving, blocked: computed(() => problems.value.length > 0), save: () => save(), revert });

// ── 목록 · 상세(composables/list-detail). 주소는 ?presence= ────────────────────
const paneEl = ref<HTMLElement | null>(null);
const { listCardClass, paneClass, selectedIndex, selected, showGlobal, showList, isOn, globalOn, select, openGlobal, afterRemove } = useListDetail({ param: "presence", rows: special, paneEl });
const listEl = ref<HTMLElement | null>(null);
// 더 있는 쪽 끝 반 줄(24)을 흐리게
const listFade = useScrollFade(listEl, () => true, 24);

// ── 순서 바꾸기 ─────────────────────────
const { startDrag } = useDragReorder(special);

// 조건 종류의 아이콘: 양력 · 음력 · 시간대(여럿이면 이 차례로 앞의 것)
const CONDITION_ICON = { date: "calendar_month", lunar: "bedtime", time: "schedule" } as const;
function conditionIcon(entry: SpecialRow) {
  const first = CONDITIONS.find((c) => entry[c.key].trim());
  return first ? CONDITION_ICON[first.key] : "event_busy";
}
const conditionText = (entry: SpecialRow) =>
  CONDITIONS.filter((c) => entry[c.key].trim())
    .map((c) => `${c.label} ${entry[c.key].trim()}`)
    .join("\n");

// 줄마다의 문제: 이름이 비었거나 겹침 + 서버 검사(schema/status)를 그 항목 하나에만 돌린 것. 목록 줄의 아이콘(툴팁)과 편집 칸 맨 위에 보인다.
// 이름이 비었으면 검사에는 "이름 없는 항목"으로 넘긴다(빈 이름으로 돌리면 ": 빈 문구…" · "null" 같은 문장이 나온다)
function rowProblems(entry: SpecialRow) {
  const name = entry.name.trim();
  const out: string[] = [];
  if (!name) out.push(T.problems.noName);
  else if (special.value.filter((e) => e.name.trim() === name).length > 1) out.push(T.problems.duplicate);
  out.push(...statusProblems({ interval: INTERVAL_DEFAULT, messages: ["-"], special: fromSpecial([{ ...entry, name: name || T.problems.unnamed }]) }));
  return out;
}
const rowProblem = (entry: SpecialRow) => rowProblems(entry).join("\n");
// 기본 문구의 문제(변경 주기 · 평소 문구)
const globalProblems = computed(() => (loaded.value ? statusProblems({ interval: draft.value.interval, messages: fromMessages(messages.value), special: null }) : []));
// 어느 줄의 것도 아닌 문제: 저장할 때 서버가 짚은 것
const listProblems = computed(() => serverProblems.value);

function addSpecial() {
  special.value.push(newSpecial());
  select(special.value.length - 1);
}

function removeSpecial(i: number) {
  const wasSelected = i === selectedIndex.value;
  special.value.splice(i, 1);
  afterRemove(i, wasSelected);
}

onMounted(fetch);
</script>
