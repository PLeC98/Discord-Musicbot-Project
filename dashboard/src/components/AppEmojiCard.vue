<template>
  <!-- 디스플레이 탭의 앱 이모지 카드: 운영자 패널에서 추가한 이모지(이름 변경, 삭제)와 봇 아이콘(보기만), 더 추가할 수 있는 수.
       추가하기는 파일을 선택한 뒤 추가 창(AppEmojiDialog)을 연다. 바뀌면 목록을 다시 읽어 입력란, 선택기도 같이 바뀐다 -->
  <BaseCard icon="add_reaction" :title="T.title">
    <template #actions>
      <BaseButton size="sm" variant="ghost" :disabled="busy" @click="fileInput?.click()"><Icon name="upload" :size="16" />{{ T.add }}</BaseButton>
    </template>
    <p class="mb-3 text-sm text-on-surface-variant">{{ T.desc }}</p>
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0! mb-3">{{ loadError }}</NoticeBox>

    <!-- 추가한 이모지: 이미지, 이름(변경하는 동안 입력란), 조작. 남는 폭은 칸들이 나눠 갖는다 -->
    <div v-if="uploaded.length" class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
      <div v-for="one in uploaded" :key="one.id" class="flex items-center gap-2 h-14 pl-3 pr-2 rounded-2xl bg-surface-container">
        <img :src="appEmojiImage(one)" alt="" class="size-8 shrink-0 object-contain" draggable="false" />
        <template v-if="editing === one.id">
          <input ref="draftInput" v-model.trim="draft" type="text" maxlength="32" autocomplete="off" spellcheck="false" :class="[FIELD, 'h-8 px-3 flex-1 min-w-0 font-mono']" :aria-label="T.nameLabel(one.name)" :disabled="busy" @keydown.enter="!composing($event) && rename(one)" @keydown.esc.stop="editing = null" />
          <button type="button" :class="iconButton(32)" :disabled="busy || !draft" :aria-label="T.save" v-tooltip="T.save" @click="rename(one)"><Icon name="check" :size="18" /></button>
          <button type="button" :class="iconButton(32)" :disabled="busy" :aria-label="text.common.cancel" v-tooltip="text.common.cancel" @click="editing = null"><Icon name="close" :size="18" /></button>
        </template>
        <template v-else>
          <span class="flex-1 min-w-0 truncate font-mono text-sm">{{ one.name }}</span>
          <button type="button" :class="iconButton(32)" :disabled="busy" :aria-label="T.renameOne(one.name)" v-tooltip="T.renameOne(one.name)" @click="startRename(one)"><Icon name="edit" :size="18" /></button>
          <button type="button" :class="iconButton(32)" class="hover:text-error" :disabled="busy" :aria-label="T.removeOne(one.name)" v-tooltip="T.removeOne(one.name)" @click="askRemove(one)"><Icon name="delete" :size="18" /></button>
        </template>
      </div>
    </div>
    <p v-else-if="loaded" class="py-3 text-sm text-on-surface-variant">{{ T.empty }}</p>
    <p v-if="loaded" class="mt-2 text-xs text-on-surface-variant nums">{{ T.room(appEmojiRoom) }}</p>

    <!-- 봇 아이콘: 이름은 툴팁으로 -->
    <template v-if="icons.length">
      <p class="mt-4 mb-2 flex items-center gap-1 text-sm font-medium">{{ T.icons }}<Icon name="info" :size="16" class="shrink-0 cursor-help text-on-surface-variant" v-tooltip="T.iconsTip" /></p>
      <div class="flex flex-wrap gap-1">
        <img v-for="one in icons" :key="one.id" :src="appEmojiImage(one)" :alt="one.name" class="size-7 object-contain" draggable="false" v-tooltip="one.name" />
      </div>
    </template>

    <input ref="fileInput" type="file" :accept="TYPES.join(',')" class="hidden" @change="onPick" />
    <AppEmojiDialog v-model="adding" :file="file" @added="onAdded" />
    <ConfirmDialog v-model="asking" icon="delete" :title="removing ? T.confirm.title(removing.name) : ''" :body="removeBody" :confirm-label="T.confirm.run" :busy="busy" @confirm="remove" />
  </BaseCard>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import AppEmojiDialog from "./AppEmojiDialog.vue";
import { FIELD } from "../utils/field.ts";
import { iconButton } from "../utils/icon-button.ts";
import { composing } from "../utils/dom.ts";
import { formatBytes } from "../../../src/ui/format.ts";
import { appEmojiImage, appEmojiRoom, appEmojis, loadAppEmojis } from "../composables/app-emojis.ts";
import { ensureRecentLogin } from "../composables/session.ts";
import { notify, notifyDone, notifyProblem } from "../composables/toasts.ts";
import { APPEARANCE_MAX_BYTES } from "../../../src/dashboard/contract/appearance.ts";
import type { AppEmojiItem, AppEmojiUses } from "../../../src/dashboard/contract/app-emojis.ts";
import { text } from "../text/index.ts";
const T = text.appEmojis;

/** 디스코드가 이모지로 받는 형식 */
const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
const API = "/api/app-emojis";

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

// 이름 변경: 칸 안에서 입력란으로 바꿔 고친다
const editing = ref<string | null>(null);
const draft = ref("");
const draftInput = ref<HTMLInputElement[]>([]);
async function startRename(one: AppEmojiItem) {
  editing.value = one.id;
  draft.value = one.name;
  await nextTick();
  draftInput.value[0]?.select();
}
async function rename(one: AppEmojiItem) {
  if (!draft.value || busy.value) return;
  if (draft.value === one.name) return (editing.value = null);
  busy.value = true;
  try {
    await axios.patch(`${API}/${one.id}`, { name: draft.value });
    notifyDone(T.renamed(draft.value));
    editing.value = null;
    await reload();
  } catch (err) {
    notifyProblem(err, T.renameFailed);
  } finally {
    busy.value = false;
  }
}

// 삭제: 서버가 최근 로그인을 요구해 로그인 창을 먼저 열고, 쓰는 곳을 읽어 확인 창에 보인다
const removing = ref<AppEmojiItem | null>(null);
const uses = ref<string[]>([]);
const asking = computed({ get: () => removing.value !== null, set: (on) => !on && !busy.value && (removing.value = null) });
const removeBody = computed(() => (uses.value.length ? `${T.confirm.body}\n${T.confirm.uses}\n\n${uses.value.join("\n")}` : T.confirm.body));

async function askRemove(one: AppEmojiItem) {
  if (!(await ensureRecentLogin())) return;
  busy.value = true;
  try {
    const { data } = await axios.get<AppEmojiUses>(`${API}/${one.id}/uses`);
    uses.value = [...data.voice.map((key) => text.tunables.fields[key]?.label ?? key), ...data.genres.map((id) => T.confirm.genre(id))];
    removing.value = one;
  } catch (err) {
    notifyProblem(err, T.removeFailed);
  } finally {
    busy.value = false;
  }
}
async function remove() {
  const one = removing.value;
  if (!one) return;
  busy.value = true;
  try {
    await axios.delete(`${API}/${one.id}`);
    notifyDone(T.removed(one.name));
    removing.value = null;
    await reload();
  } catch (err) {
    notifyProblem(err, T.removeFailed);
  } finally {
    busy.value = false;
  }
}
</script>
