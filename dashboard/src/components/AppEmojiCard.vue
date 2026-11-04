<template>
  <!-- 앱 이모지 탭의 카드: 운영자 패널에서 추가한 이모지(이름 입력란, 삭제)와 봇 내장 아이콘(보기만), 남은 슬롯.
       고친 이름은 저장 띠로 모아 저장한다. 삭제는 두 번 누른다(처음 누르면 버튼이 "삭제"로 바뀌고 쓰는 곳을 알린다, 다른 곳을 누르면 돌아간다). 추가하기는 파일을 선택한 뒤 추가 창(AppEmojiDialog)을 연다. 바뀌면 목록을 다시 읽어 입력란, 선택기도 같이 바뀐다 -->
  <BaseCard icon="add_reaction" :title="T.title">
    <template #actions>
      <BaseButton size="sm" variant="ghost" :disabled="busy" @click="fileInput?.click()"><Icon name="upload" :size="16" />{{ T.add }}</BaseButton>
    </template>
    <p class="mb-3 text-sm text-on-surface-variant">{{ T.desc }}</p>
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0! mb-3">{{ loadError }}</NoticeBox>

    <!-- 추가한 이모지: 이미지, 이름 입력란(앞뒤 : 는 고칠 수 없다), 삭제. 틀린 이름, 삭제할 이모지를 쓰는 곳은 그 칸 아래에. 남는 폭은 칸들이 나눠 갖는다 -->
    <div v-if="uploaded.length" class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
      <div v-for="one in uploaded" :key="one.id" class="flex flex-col gap-1 py-3 pl-3 pr-2 rounded-2xl bg-surface-container">
        <div class="flex items-center gap-2">
          <img :src="appEmojiImage(one)" alt="" class="size-8 shrink-0 object-contain" draggable="false" />
          <!-- :이름: 이 평소 글자처럼 보이고, 올리거나 입력하는 동안 : 까지 묶은 상자에 입력란 면이 보인다. 입력란 폭은 글자 수만큼(고정폭 글꼴의 ch), 칸을 넘지 않는다 -->
          <span class="flex-1 min-w-0 flex">
            <label :class="[NAME_BOX, issues[one.id] && 'bg-surface-container-highest border-error!']">
              <span class="text-on-surface-variant" aria-hidden="true">:</span>
              <input :value="drafts[one.id] ?? one.name" type="text" maxlength="32" autocomplete="off" spellcheck="false" class="min-w-0 bg-transparent font-[inherit] text-on-surface outline-none" :style="{ width: `${Math.max(1, (drafts[one.id] ?? one.name).length)}ch` }" :aria-label="T.nameLabel(one.name)" :aria-invalid="!!issues[one.id]" :disabled="saving" @input="onName(one, valueOf($event))" />
              <span class="text-on-surface-variant" aria-hidden="true">:</span>
            </label>
          </span>
          <button v-if="armed === one.id" data-armed type="button" class="shrink-0 inline-flex items-center gap-1 h-8 px-3 rounded-full bg-error text-on-error text-xs font-medium cursor-pointer disabled:opacity-38" :disabled="busy" :aria-label="T.removeNow(one.name)" @click="remove(one)"><Icon name="delete" :size="16" />{{ T.removeArmed }}</button>
          <button v-else type="button" :class="iconButton(32)" class="hover:text-error" :disabled="busy || saving" :aria-label="T.removeOne(one.name)" v-tooltip="T.removeOne(one.name)" @click="arm(one)"><Icon name="delete" :size="18" /></button>
        </div>
        <p v-if="issues[one.id]" class="pl-10 text-xs text-error">{{ issues[one.id] }}</p>
        <p v-else-if="armed === one.id && uses.length" class="pl-10 text-xs text-on-surface-variant">{{ T.usedIn(uses) }}</p>
      </div>
    </div>
    <p v-else-if="loaded" class="py-3 text-sm text-on-surface-variant">{{ T.empty }}</p>
    <p v-if="loaded" class="mt-2 text-xs text-on-surface-variant nums">{{ T.room(appEmojiRoom, appEmojis.length, APP_EMOJI_LIMIT) }}</p>

    <!-- 봇 내장 아이콘: 이름은 툴팁으로 -->
    <template v-if="icons.length">
      <p class="mt-4 mb-2 flex items-center gap-1 text-sm font-medium">{{ T.icons }}<Icon name="info" :size="16" class="shrink-0 cursor-help text-on-surface-variant" v-tooltip="T.iconsTip" /></p>
      <div class="flex flex-wrap gap-1">
        <img v-for="one in icons" :key="one.id" :src="appEmojiImage(one)" :alt="one.name" class="size-7 object-contain" draggable="false" v-tooltip="one.name" />
      </div>
    </template>

    <input ref="fileInput" type="file" :accept="TYPES.join(',')" class="hidden" @change="onPick" />
    <AppEmojiDialog v-model="adding" :file="file" @added="onAdded" />
  </BaseCard>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import AppEmojiDialog from "./AppEmojiDialog.vue";
import { iconButton } from "../utils/icon-button.ts";
import { valueOf } from "../utils/dom.ts";
import { problemCodeOf, replyOf } from "../utils/request.ts";
import { formatBytes } from "../../../src/ui/format.ts";
import { appEmojiImage, appEmojiRoom, appEmojis, loadAppEmojis, nameIssueText, nameProblem } from "../composables/app-emojis.ts";
import { useSaveTarget } from "../composables/save-targets.ts";
import { notify, notifyDone, notifyProblem } from "../composables/toasts.ts";
import { APPEARANCE_MAX_BYTES } from "../../../src/dashboard/contract/appearance.ts";
import { APP_EMOJI_LIMIT, type AppEmojiItem, type AppEmojiUses } from "../../../src/dashboard/contract/app-emojis.ts";
import { text } from "../text/index.ts";
const T = text.appEmojis;

/** 디스코드가 이모지로 받는 형식 */
const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
const API = "/api/app-emojis";
/** :이름: 상자: 평소에는 면과 테두리가 없고, 올리면 입력란 면, 입력하는 동안 입력란 면과 강조 테두리 */
const NAME_BOX = "inline-flex items-center h-8 px-2 min-w-0 max-w-full rounded-(--r-inner) border border-transparent font-mono text-sm cursor-text transition-[background-color,border-color] effects-fast hover:bg-surface-container-highest focus-within:bg-surface-container-highest focus-within:border-primary";

const uploaded = computed(() => appEmojis.value.filter((one) => !one.icon));
const icons = computed(() => appEmojis.value.filter((one) => one.icon));
const loaded = ref(false);
const loadError = ref("");
const busy = ref(false);

async function reload() {
  const ok = await loadAppEmojis(true);
  loadError.value = ok ? "" : T.loadFailed;
  loaded.value ||= ok;
}
onMounted(reload);

// 추가하기: 파일을 화면에서 먼저 걸러(봇도 다시 본다) 추가 창을 연다
const fileInput = ref<HTMLInputElement | null>(null);
const file = ref<File | null>(null);
const adding = ref(false);

/** 추가 창을 열기 전에 거절할 까닭. 없으면 빈 글 */
async function refusal(one: File): Promise<string> {
  if (!TYPES.includes(one.type)) return T.refuse.format(one.name);
  if (one.size > APPEARANCE_MAX_BYTES) return T.refuse.tooBig(one.name, formatBytes(APPEARANCE_MAX_BYTES));
  try {
    (await createImageBitmap(one)).close();
    return "";
  } catch {
    return T.refuse.unreadable(one.name);
  }
}
async function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const picked = input.files?.[0];
  input.value = "";
  if (!picked) return;
  const why = await refusal(picked);
  if (why) return notify({ title: T.refusedTitle, body: why, severity: "warning" });
  file.value = picked;
  adding.value = true;
}
async function onAdded(emoji: AppEmojiItem) {
  notifyDone(T.added(emoji.name));
  await reload();
}

// 이름: 칸마다 입력란. 고친 이름만 drafts 에 두고 저장 띠로 모아 저장한다. 다른 칸에서 고치는 이름과도 겹치지 않아야 한다
const drafts = reactive<Record<string, string>>({});
/** 봇이 거절한 이름의 까닭. 그 칸을 고치면 지운다 */
const refused = reactive<Record<string, string>>({});
const saving = ref(false);
const changed = computed(() => uploaded.value.filter((one) => one.id in drafts));

function onName(one: AppEmojiItem, value: string) {
  delete refused[one.id];
  if (value === one.name) delete drafts[one.id];
  else drafts[one.id] = value;
}

/** 고친 칸마다 이름의 문제(입력란 아래 글) */
const issues = computed(() => {
  const now = appEmojis.value.map((one) => ({ id: one.id, name: drafts[one.id] ?? one.name, icon: one.icon }));
  const out: Record<string, string> = {};
  for (const one of changed.value) {
    const code = nameProblem(drafts[one.id], new Map(now.filter((other) => other.id !== one.id).map((other) => [other.name, other.icon])));
    const why = refused[one.id] ?? nameIssueText(code);
    if (why) out[one.id] = why;
  }
  return out;
});

// 하나씩 바꾸고, 실패하면 거기서 멈춘다(저장 띠가 이 탭으로 옮긴다). 봇이 거절한 이름은 그 칸 아래에
async function save(): Promise<boolean> {
  if (saving.value) return false;
  saving.value = true;
  let done = 0;
  try {
    for (const one of [...changed.value]) {
      try {
        await axios.patch(`${API}/${one.id}`, { name: drafts[one.id] });
        delete drafts[one.id];
        done++;
      } catch (err) {
        const why = nameIssueText(problemCodeOf(replyOf(err)));
        if (why) refused[one.id] = why;
        else notifyProblem(err, T.renameFailed);
        return false;
      }
    }
    return true;
  } finally {
    if (done) {
      notifyDone(T.renamed(done));
      await reload();
    }
    saving.value = false;
  }
}
function revert() {
  for (const id of Object.keys(drafts)) delete drafts[id];
  for (const id of Object.keys(refused)) delete refused[id];
}
useSaveTarget({ tab: "emojis", dirty: computed(() => changed.value.length > 0), saving, blocked: computed(() => Object.keys(issues.value).length > 0), save: () => save(), revert });

// 삭제: 두 번 누른다. 처음 누르면 그 칸의 버튼이 "삭제"로 바뀌고 쓰는 곳을 읽어 칸 아래에 알린다. 그 버튼 밖을 누르거나 Esc 면 돌아간다
const armed = ref<string | null>(null);
const uses = ref<string[]>([]);

async function arm(one: AppEmojiItem) {
  armed.value = one.id;
  uses.value = [];
  try {
    const { data } = await axios.get<AppEmojiUses>(`${API}/${one.id}/uses`);
    if (armed.value === one.id) uses.value = [...data.voice.map((key) => text.tunables.fields[key]?.label ?? key), ...data.genres.map((id) => T.genreUse(id))];
  } catch {
    // 쓰는 곳은 알림일 뿐이라 읽지 못해도 삭제할 수 있다
  }
}
const disarm = () => (armed.value = null);
const outside = (e: PointerEvent) => (e.target as Element).closest("[data-armed]") || disarm();
const onEsc = (e: KeyboardEvent) => e.key === "Escape" && disarm();
watch(armed, (now, before) => {
  if (now && !before) {
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", onEsc);
  } else if (!now) {
    window.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("keydown", onEsc);
  }
});
onBeforeUnmount(disarm);

async function remove(one: AppEmojiItem) {
  busy.value = true;
  try {
    await axios.delete(`${API}/${one.id}`);
    notifyDone(T.removed(one.name));
    delete drafts[one.id];
    delete refused[one.id];
    disarm();
    await reload();
  } catch (err) {
    notifyProblem(err, T.removeFailed);
  } finally {
    busy.value = false;
  }
}
</script>
