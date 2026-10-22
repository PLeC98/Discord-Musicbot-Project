<template>
  <div class="flex flex-col gap-(--gap-in)">
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>
    <!-- 저장했지만 다시 시작해야 적용되는 값이 남아 있으면 무엇인지 적고 그 자리에서 다시 시작한다 -->
    <NoticeBox v-if="pendingHere.length" variant="note" tone="info" icon="restart_alt" class="mt-0!">
      <span class="flex items-center gap-3 flex-wrap"
        ><span class="flex-1 min-w-0">{{ text.restart.pending(namesOf(pendingHere)) }}</span
        ><BotRestart :available="canRestart"
      /></span>
    </NoticeBox>

    <!-- 항목 하나의 칸. 카드 그리드와 박스 안에서 같이 쓴다(VueUse createReusableTemplate). short: 박스 안이라 짧은 이름 -->
    <DefineField v-slot="{ one, short }">
      <!-- 구간 선택은 체크박스 목록이라 label 로 감싸지 않는다(라벨을 누르면 첫 체크박스가 바뀐다). 서버 설정의 SponsorBlock 카드와 같은 컴포넌트, SponsorBlock 을 끄면 흐리게 -->
      <SponsorCategories v-if="one.kind === 'categories'" class="min-w-0 @md/card:col-span-2" :label="labelOf(one.key)" :selected="categoriesOf(one)" :dimmed="!boolOf(tunable('SPONSORBLOCK_ENABLED'))" @toggle="toggleCategory(one, $event)" />
      <!-- 쿠키 출처는 두 칸을 쓴다: 기타를 고르면 입력란이 넓을 때 오른쪽 칸에, 좁으면 아래에 -->
      <label v-else class="block min-w-0" :class="one.kind === 'cookies' && '@md/card:col-span-2'">
        <span :class="FIELD_LABEL" class="flex items-center gap-1 flex-wrap"
          ><span class="truncate">{{ (short && T.fields[one.key]?.short) || (T.fields[one.key]?.label ?? one.key) }}</span
          ><Icon v-if="T.fields[one.key]?.help" name="info" :size="14" class="shrink-0 cursor-help" v-tooltip="T.fields[one.key]?.help" /><span v-if="pending.includes(one.key)" class="text-tertiary" v-tooltip="T.restartTip">{{ T.pending }}</span
          ><span v-else-if="one.restart" class="text-on-surface-variant/70" v-tooltip="T.restartTip">{{ T.restartBadge }}</span></span
        >
        <!-- 참 · 거짓은 스위치. 비우면(기본값) 기본값 쪽으로 보인다 -->
        <span v-if="one.kind === 'bool'" class="flex items-center gap-2 h-10">
          <BaseSwitch :model-value="boolOf(one)" :label="T.fields[one.key]?.label ?? one.key" @update:model-value="draft[one.key] = $event ? 'true' : 'false'" />
          <span class="text-sm text-on-surface">{{ boolOf(one) ? T.on : T.off }}</span>
        </span>
        <!-- 쿠키 출처: 쓰지 않음 · 파일 · 브라우저 선택, 그 밖의 형식(프로필 · 키링 · 컨테이너)은 "기타"를 선택하고 아래 입력란에 입력한다 -->
        <span v-else-if="one.kind === 'cookies'" class="grid grid-cols-1 @md/card:grid-cols-2 gap-x-3 gap-y-2">
          <SingleSelect :model-value="cookieChoice(one)" :options="COOKIE_OPTIONS" :empty-label="T.cookies.none" @update:model-value="pickCookie(one, String($event))" />
          <input v-if="cookieChoice(one) === COOKIE_OTHER" :value="draft[one.key]" spellcheck="false" :placeholder="T.cookies.otherPlaceholder" :aria-label="T.cookies.other" :class="[FIELD, 'w-full min-w-0 font-mono placeholder:font-sans']" @input="draft[one.key] = valueOf($event)" />
        </span>
        <!-- 색은 동그라미를 누르면 색 선택이 열린다. 글 입력란이 앞이라야 라벨을 누를 때 색 선택 대신 글 입력란으로 간다(보이는 순서는 동그라미가 앞) -->
        <span v-else class="flex items-center gap-2">
          <input :value="draft[one.key]" :inputmode="one.kind === 'int' ? 'numeric' : undefined" spellcheck="false" :placeholder="T.defaultWith(one.def)" :class="[FIELD, 'w-full min-w-0', one.kind !== 'text' && 'font-mono placeholder:font-sans']" @input="draft[one.key] = valueOf($event)" />
          <ColorPicker v-if="one.kind === 'color'" class="order-first" :model-value="draft[one.key]" :fallback="one.def" :label="T.pickColor" @update:model-value="draft[one.key] = $event" />
        </span>
      </label>
    </DefineField>

    <template v-for="group in groups" :key="group">
      <BaseCard v-if="byGroup(group).length" :icon="T.groups[group].icon" :title="T.groups[group].title">
        <template v-if="GROUP_DOCS[group]" #actions><DocLink :file="GROUP_DOCS[group]!.file" :label="GROUP_DOCS[group]!.label" /></template>
        <p v-if="T.groups[group].desc" class="mb-3 text-sm text-on-surface-variant">{{ T.groups[group].desc }}</p>
        <div class="grid grid-cols-1 @md/card:grid-cols-2 gap-3">
          <ReuseField v-for="one in looseOf(group)" :key="one.key" :one="one" />
          <!-- 같은 일의 출처별 값은 박스 하나로(예: 원본 다시 확인 간격). 제목 · 설명은 박스 위에 한 번, 칸에는 짧은 이름만(SponsorBlock 구간 선택과 같은 모양) -->
          <div v-for="box in boxesOf(group)" :key="box" class="min-w-0 @md/card:col-span-2">
            <span class="flex items-center gap-1 mb-2 text-xs text-on-surface-variant">{{ T.boxes[box].title }}<Icon name="info" :size="14" class="shrink-0 cursor-help" v-tooltip="T.boxes[box].help" /></span>
            <div class="grid grid-cols-1 @md/card:grid-cols-3 gap-3 rounded-(--r-inner) border border-outline-variant/50 p-3">
              <ReuseField v-for="one in boxItems(group, box)" :key="one.key" :one="one" :short="true" />
            </div>
          </div>
        </div>
        <!-- 그룹 카드 안, 칸들 아래에 부르는 쪽이 끼우는 슬롯(연령 제한 탭 유튜브 그룹의 유튜브 쿠키 입력) -->
        <slot :name="`in-${group}`" />
      </BaseCard>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { createReusableTemplate } from "@vueuse/core";
import BaseCard from "./BaseCard.vue";
import BotRestart from "./BotRestart.vue";
import BaseSwitch from "./BaseSwitch.vue";
import ColorPicker from "./ColorPicker.vue";
import SponsorCategories from "./SponsorCategories.vue";
import SingleSelect from "./SingleSelect.vue";
import DocLink from "./DocLink.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import { FIELD, FIELD_LABEL } from "../utils/field.ts";
import { valueOf } from "../utils/dom.ts";
import { problemText } from "../utils/problem.ts";
import { trackUnsaved } from "../composables/unsaved.ts";
import { attach, draft, labelOf, namesOf, pending, saved } from "../composables/tunables.ts";
import { showAdvanced } from "../composables/advanced-settings.ts";
import { TUNABLES, tunable, tunableValue, type Tunable, type TunableBox, type TunableGroup } from "../../../src/rules/tunables.ts";
import { NO_CATEGORIES, SKIP_CATEGORIES } from "../../../src/rules/sponsor-categories.ts";
import { COOKIE_BROWSERS, COOKIE_BROWSER_NAMES } from "../../../src/rules/cookie-browsers.ts";
import type { Option } from "../utils/options.ts";
import { text } from "../text/index.ts";
const T = text.tunables;

/**
 * 운영 조절값 카드. 그룹(group)마다 카드 하나. 값은 탭끼리 같이 쓰고 저장 · 되돌리기는 운영자 패널의 저장 막대가 한다(composables/tunables).
 * groups: 보일 그룹 · tab: 운영자 패널 탭(저장 안 함 표시) · canRestart: 실행기로 시작했는가(봇 상태의 env.launcher)
 */
const props = defineProps<{ groups: readonly TunableGroup[]; tab: string; canRestart: boolean }>();

const loadError = ref("");
// 카드 헤더의 설명서 버튼(저장소의 설명서)
const GROUP_DOCS: Partial<Record<TunableGroup, { file: string; label: string }>> = { youtube: { file: "docs/youtube.md", label: T.youtubeDoc } };

const mine = computed(() => TUNABLES.filter((one) => props.groups.includes(one.group)));
const keys = computed(() => mine.value.map((one) => one.key));
// 고급 항목은 "고급 설정 보기"를 켰을 때만. 꺼 두었어도 고치는 중이거나 다시 시작을 기다리는 항목은 보인다(저장 막대 · 다시 시작 안내가 가리키는 칸이 숨지 않게)
const shown = (one: Tunable) => !one.advanced || showAdvanced.value || changed(one) || pending.value.includes(one.key);
const byGroup = (group: TunableGroup) => mine.value.filter((one) => one.group === group && shown(one));
// 박스 밖의 항목 · 이 카드에 보이는 박스 · 박스 안의 항목
const looseOf = (group: TunableGroup) => byGroup(group).filter((one) => !one.box);
const boxesOf = (group: TunableGroup) => [...new Set(byGroup(group).flatMap((one) => (one.box ? [one.box] : [])))];
const boxItems = (group: TunableGroup, box: TunableBox) => byGroup(group).filter((one) => one.box === box);
const [DefineField, ReuseField] = createReusableTemplate<{ one: Tunable; short?: boolean }>();
const boolOf = (one: Tunable) => (draft.value[one.key] || one.def) === "true";
const changed = (one: Tunable) => tunableValue(one.key, draft.value[one.key] ?? "") !== (saved.value[one.key] ?? "");
const dirty = computed(() => mine.value.some(changed));

// 쿠키 출처 선택. 선택 목록에 없는 값(chrome:Profile 1 같은 형식)이 들어 있거나 "기타"를 선택한 동안은 "기타"와 입력란
// 선택 목록 안에서만 쓰는 표식(값으로 저장하지 않는다. 브라우저 이름은 괄호로 시작하지 않는다)
const COOKIE_OTHER = "(other)";
const COOKIE_OPTIONS: Option[] = [{ value: "file", label: T.cookies.file }, ...COOKIE_BROWSERS.map((id) => ({ value: id, label: COOKIE_BROWSER_NAMES[id], group: T.cookies.browsers })), { value: COOKIE_OTHER, label: T.cookies.other, group: T.cookies.otherGroup }];
const cookieOther = ref(false);
// 저장하거나 되돌려 저장된 값으로 돌아오면 선택 목록으로 돌아간다
watch(
  () => (draft.value.COOKIES_SOURCE ?? "").trim() === (saved.value.COOKIES_SOURCE ?? ""),
  (same) => same && (cookieOther.value = false),
);
function cookieChoice(one: Tunable) {
  const value = (draft.value[one.key] ?? "").trim();
  if (cookieOther.value) return COOKIE_OTHER;
  if (!value) return "";
  return COOKIE_OPTIONS.some((option) => option.value === value.toLowerCase()) ? value.toLowerCase() : COOKIE_OTHER;
}
// "기타"로 바꿀 때는 지금 값을 그대로 둔다(chrome 을 chrome:Profile 1 로 고쳐 입력하기 쉽게)
function pickCookie(one: Tunable, value: string) {
  cookieOther.value = value === COOKIE_OTHER;
  if (!cookieOther.value) draft.value[one.key] = value;
}

// 구간 선택(쉼표로 이은 id). 비면 기본값의 구간, NO_CATEGORIES 면 하나도 없음
const listOf = (raw: string) => raw.split(",").filter((id) => SKIP_CATEGORIES.includes(id));
function categoriesOf(one: Tunable) {
  const raw = (draft.value[one.key] ?? "").trim();
  return raw === NO_CATEGORIES ? [] : listOf(raw || one.def);
}
// 선택한 순서는 목록 순서로. 기본값과 같으면 비운다(기본값을 따른다), 다 끄면 NO_CATEGORIES
function toggleCategory(one: Tunable, id: string) {
  const now = categoriesOf(one);
  const next = SKIP_CATEGORIES.filter((each) => (each === id ? !now.includes(each) : now.includes(each)));
  const sameAsDefault = next.join(",") === SKIP_CATEGORIES.filter((each) => listOf(one.def).includes(each)).join(",");
  draft.value[one.key] = !next.length ? NO_CATEGORIES : sameAsDefault ? "" : next.join(",");
}
const pendingHere = computed(() => pending.value.filter((key) => keys.value.includes(key)));
trackUnsaved(`${props.tab}:tunables`, dirty);

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
