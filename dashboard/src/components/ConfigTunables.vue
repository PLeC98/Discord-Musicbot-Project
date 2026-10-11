<template>
  <div class="flex flex-col gap-(--gap-in)">
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>
    <p v-if="desc" class="text-sm text-on-surface-variant">{{ T.desc }}</p>
    <!-- 저장했지만 다시 시작해야 적용되는 값이 남아 있으면 무엇인지 적고 그 자리에서 다시 시작한다 -->
    <NoticeBox v-if="pendingHere.length" variant="note" tone="info" icon="restart_alt" class="mt-0!">
      <span class="flex items-center gap-3 flex-wrap"
        ><span class="flex-1 min-w-0">{{ text.restart.pending(namesOf(pendingHere)) }}</span
        ><BotRestart :available="canRestart"
      /></span>
    </NoticeBox>

    <BaseCard v-for="group in groups" :key="group" :icon="T.groups[group].icon" :title="T.groups[group].title">
      <p v-if="T.groups[group].desc" class="mb-3 text-sm text-on-surface-variant">{{ T.groups[group].desc }}</p>
      <div class="grid grid-cols-1 @md/card:grid-cols-2 gap-3">
        <template v-for="one in byGroup(group)" :key="one.key">
          <!-- 구간 고르기는 체크박스 목록이라 label 로 감싸지 않는다(이름표를 누르면 첫 칸이 바뀐다). 서버 설정의 SponsorBlock 카드와 같은 부품, SponsorBlock 을 끄면 흐리게 -->
          <SponsorCategories v-if="one.kind === 'categories'" class="min-w-0 @md/card:col-span-2" :label="labelOf(one.key)" :selected="categoriesOf(one)" :dimmed="!boolOf(tunable('SPONSORBLOCK_ENABLED'))" @toggle="toggleCategory(one, $event)" />
          <label v-else class="block min-w-0">
            <span :class="FIELD_LABEL" class="flex items-center gap-1 flex-wrap"
              ><span class="truncate">{{ T.fields[one.key]?.label ?? one.key }}</span
              ><Icon v-if="T.fields[one.key]?.help" name="info" :size="14" class="shrink-0 cursor-help" v-tooltip="T.fields[one.key]?.help" /><span v-if="pending.includes(one.key)" class="text-tertiary" v-tooltip="T.restartTip">{{ T.pending }}</span
              ><span v-else-if="one.restart" class="text-on-surface-variant/70" v-tooltip="T.restartTip">{{ T.restartBadge }}</span></span
            >
            <!-- 참 · 거짓은 스위치. 비우면(기본값) 기본값 쪽으로 보인다 -->
            <span v-if="one.kind === 'bool'" class="flex items-center gap-2 h-10">
              <BaseSwitch :model-value="boolOf(one)" :label="T.fields[one.key]?.label ?? one.key" @update:model-value="draft[one.key] = $event ? 'true' : 'false'" />
              <span class="text-sm text-on-surface">{{ boolOf(one) ? T.on : T.off }}</span>
            </span>
            <!-- 쿠키 출처: 쓰지 않음 · 파일 · 브라우저 고르기, 그 밖의 꼴(프로필 · 키링 · 컨테이너)은 "기타"를 고르고 아래 칸에 적는다 -->
            <span v-else-if="one.kind === 'cookies'" class="flex flex-col gap-2">
              <SingleSelect :model-value="cookieChoice(one)" :options="COOKIE_OPTIONS" :empty-label="T.cookies.none" @update:model-value="pickCookie(one, String($event))" />
              <input v-if="cookieChoice(one) === COOKIE_OTHER" :value="draft[one.key]" spellcheck="false" :placeholder="T.cookies.otherPlaceholder" :aria-label="T.cookies.other" :class="[FIELD, 'w-full min-w-0 font-mono placeholder:font-sans']" @input="draft[one.key] = valueOf($event)" />
            </span>
            <!-- 색은 동그라미를 누르면 색 고르기가 뜬다. 글 칸이 앞이라야 이름표를 누를 때 고르기 대신 글 칸으로 간다(보이는 차례는 동그라미가 앞) -->
            <span v-else class="flex items-center gap-2">
              <input :value="draft[one.key]" :inputmode="one.kind === 'int' ? 'numeric' : undefined" spellcheck="false" :placeholder="T.defaultWith(one.def)" :class="[FIELD, 'w-full min-w-0', one.kind !== 'text' && 'font-mono placeholder:font-sans']" @input="draft[one.key] = valueOf($event)" />
              <ColorPicker v-if="one.kind === 'color'" class="order-first" :model-value="draft[one.key]" :fallback="one.def" :label="T.pickColor" @update:model-value="draft[one.key] = $event" />
            </span>
          </label>
        </template>
      </div>
    </BaseCard>
    <SaveDock :tab="tab" :dirty="dirty && loaded" :saving="saving" :restart="canRestart && needsRestart" @save="save()" @save-restart="saveAndRestart" @revert="reset" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import BaseCard from "./BaseCard.vue";
import SaveDock from "./SaveDock.vue";
import BotRestart from "./BotRestart.vue";
import { restartNow } from "../composables/bot-restart.ts";
import BaseSwitch from "./BaseSwitch.vue";
import ColorPicker from "./ColorPicker.vue";
import SponsorCategories from "./SponsorCategories.vue";
import SingleSelect from "./SingleSelect.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import { FIELD, FIELD_LABEL } from "../utils/field.ts";
import { valueOf } from "../utils/dom.ts";
import { problemText } from "../utils/problem.ts";
import { trackUnsaved } from "../composables/unsaved.ts";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { attach, draft, loaded, pending, revertKeys, saved, saveKeys } from "../composables/tunables.ts";
import { TUNABLES, tunable, type Tunable, type TunableGroup } from "../../../src/rules/tunables.ts";
import { NO_CATEGORIES, SKIP_CATEGORIES } from "../../../src/rules/sponsor-categories.ts";
import { COOKIE_BROWSERS, COOKIE_BROWSER_NAMES } from "../../../src/rules/cookie-browsers.ts";
import type { Option } from "../utils/options.ts";
import { text } from "../text/index.ts";
const T = text.tunables;

/**
 * 운영 조절값 카드. 묶음(group)마다 카드 하나, 저장 막대는 이 편집기의 칸만 저장한다(값은 탭끼리 같이 쓴다, composables/tunables).
 * groups: 보일 묶음 · tab: 운영자 패널 탭(저장 막대 · 저장 안 함 표시) · desc: 맨 위 안내(비운 칸은 기본값) · canRestart: 실행기로 켰는가(봇 상태의 env.launcher)
 */
const props = withDefaults(defineProps<{ groups: readonly TunableGroup[]; tab: string; desc?: boolean; canRestart: boolean }>(), { desc: false });

// 칸 이름(화면 이름표). 알림 · 안내에 "몇 칸" 대신 무엇인지 적는다
const labelOf = (key: string) => T.fields[key]?.label ?? key;
const namesOf = (keys: string[]) => keys.map(labelOf).join(" · ");

const loadError = ref("");
const saving = ref(false);

const mine = computed(() => TUNABLES.filter((one) => props.groups.includes(one.group)));
const keys = computed(() => mine.value.map((one) => one.key));
const byGroup = (group: TunableGroup) => mine.value.filter((one) => one.group === group);
const boolOf = (one: Tunable) => (draft.value[one.key] || one.def) === "true";
const changed = (one: Tunable) => (draft.value[one.key] ?? "").trim() !== (saved.value[one.key] ?? "");
const dirty = computed(() => mine.value.some(changed));

// 쿠키 출처 고르기. 고르기 목록에 없는 값(chrome:Profile 1 같은 꼴)이 들어 있거나 "기타"를 고른 동안은 "기타"와 적는 칸
// 고르기 목록 안에서만 쓰는 표식(값으로 저장하지 않는다. 브라우저 이름은 괄호로 시작하지 않는다)
const COOKIE_OTHER = "(other)";
const COOKIE_OPTIONS: Option[] = [{ value: "file", label: T.cookies.file }, ...COOKIE_BROWSERS.map((id) => ({ value: id, label: COOKIE_BROWSER_NAMES[id], group: T.cookies.browsers })), { value: COOKIE_OTHER, label: T.cookies.other, group: T.cookies.otherGroup }];
const cookieOther = ref(false);
function cookieChoice(one: Tunable) {
  const value = (draft.value[one.key] ?? "").trim();
  if (cookieOther.value) return COOKIE_OTHER;
  if (!value) return "";
  return COOKIE_OPTIONS.some((option) => option.value === value.toLowerCase()) ? value.toLowerCase() : COOKIE_OTHER;
}
// "기타"로 바꿀 때는 지금 값을 그대로 둔다(chrome 을 chrome:Profile 1 로 고쳐 적기 쉽게)
function pickCookie(one: Tunable, value: string) {
  cookieOther.value = value === COOKIE_OTHER;
  if (!cookieOther.value) draft.value[one.key] = value;
}

// 구간 고르기(쉼표로 이은 id). 비면 기본값의 구간, NO_CATEGORIES 면 하나도 없음
const listOf = (raw: string) => raw.split(",").filter((id) => SKIP_CATEGORIES.includes(id));
function categoriesOf(one: Tunable) {
  const raw = (draft.value[one.key] ?? "").trim();
  return raw === NO_CATEGORIES ? [] : listOf(raw || one.def);
}
// 고른 차례는 목록 차례로. 기본값과 같으면 비운다(기본값을 따른다), 다 끄면 NO_CATEGORIES
function toggleCategory(one: Tunable, id: string) {
  const now = categoriesOf(one);
  const next = SKIP_CATEGORIES.filter((each) => (each === id ? !now.includes(each) : now.includes(each)));
  const sameAsDefault = next.join(",") === SKIP_CATEGORIES.filter((each) => listOf(one.def).includes(each)).join(",");
  draft.value[one.key] = !next.length ? NO_CATEGORIES : sameAsDefault ? "" : next.join(",");
}
const pendingHere = computed(() => pending.value.filter((key) => keys.value.includes(key)));
// 다시 시작해야 먹는 값을 고쳤거나, 저장해 두고 아직 다시 시작하지 않은 값이 있다
const needsRestart = computed(() => mine.value.some((one) => one.restart && changed(one)) || pendingHere.value.length > 0);
trackUnsaved(`${props.tab}:tunables`, dirty);

const reset = () => {
  revertKeys(keys.value);
  cookieOther.value = false;
};

/** 저장. 됐으면 true. restarting 이면 다시 시작해야 먹는다는 안내는 빼고 알린다(곧 다시 시작한다) */
async function save(restarting = false) {
  saving.value = true;
  try {
    const view = await saveKeys(keys.value);
    const waiting = view.pending.filter((key) => keys.value.includes(key));
    notifyDone(T.savedDone, waiting.length && !restarting ? T.savedRestart(namesOf(waiting)) : "");
    return true;
  } catch (err) {
    notifyProblem(err, T.saveFailed);
    return false;
  } finally {
    saving.value = false;
  }
}

async function saveAndRestart() {
  if (await save(true)) await restartNow();
}

const { ready, detach } = attach();
onUnmounted(detach);
onMounted(async () => {
  try {
    await ready;
  } catch (err) {
    loadError.value = problemText(err, T.loadFailed);
  }
});
</script>
