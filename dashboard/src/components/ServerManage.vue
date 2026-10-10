<template>
  <!-- 서버 관리 탭. 넓으면 두 단(왼쪽 전체 공지 · 오른쪽 참가 서버), 좁으면 위아래. 서버 목록은 탭이 3초마다 다시 읽어 넘겨준다 -->
  <div class="grid grid-cols-1 @4xl/content:grid-cols-2 items-start gap-(--gap-in)">
    <!-- 카드 안 간격(design.md 간격 기준): 덩어리 사이 12, 입력칸 → 글자 수 4, 이름표 → 미리보기 8 -->
    <BaseCard icon="campaign" title="전체 공지">
      <div class="flex flex-col gap-3">
        <p class="text-sm text-on-surface-variant">봇이 들어간 모든 서버에 공지를 보내요.</p>
        <!-- 공지 종류: 이어 붙은 버튼 묶음(하나 고르기). 종류마다 아이콘, 고르면 체크(M3). 좁은 카드(384 미만)는 칸 안 여백을 줄이고, 아주 좁으면(320 미만) 고르지 않은 칸의 아이콘을 뺀다 -->
        <div class="flex gap-0.5" role="radiogroup" aria-label="공지 종류">
          <button v-for="(k, i) in KINDS" :key="k.value" type="button" role="radio" :aria-checked="kind === k.value" :class="[segment(kind === k.value, i, KINDS.length), '@max-sm/card:px-2 @max-sm/card:gap-1']" @click="kind = k.value"><Icon :name="kind === k.value ? 'check' : k.icon" :size="18" :class="kind !== k.value && '@max-xs/card:hidden!'" />{{ k.label }}</button>
        </div>
        <!-- 서식 도구줄(디스코드 임베드가 그리는 마크다운). 누르면 고른 글을 감싸거나 고른 줄 앞에 기호를 붙인다(이미 있으면 뗀다).
             누르는 동안 입력칸의 선택이 풀리지 않게 mousedown 을 막는다 -->
        <div class="flex flex-wrap items-center gap-1 -ml-1" role="toolbar" aria-label="서식">
          <template v-for="(group, gi) in FORMAT_GROUPS" :key="gi">
            <span v-if="gi" class="w-px h-5 mx-1 bg-outline-variant" aria-hidden="true"></span>
            <button v-for="f in group" :key="f.icon" type="button" :class="[ICON_BTN, 'size-8']" :aria-label="f.label" v-tooltip="f.tip" @mousedown.prevent @click="format(f.run)"><Icon :name="f.icon" :size="20" /></button>
          </template>
        </div>
        <!-- 다른 입력칸과 같은 채운 칸. 이모지 버튼은 오른쪽 위(오른쪽 아래는 크기 조절 손잡이 자리) -->
        <div class="flex flex-col gap-1">
          <div class="relative">
            <textarea ref="box" :value="message" placeholder="공지 내용" rows="5" :class="[FIELD, tooLong ? 'border-error!' : '']" @blur="caret = caretOf(box)" @click="caret = caretOf(box)" @keyup="caret = caretOf(box)" @select="caret = caretOf(box)" @keydown="onFormatKey" @input="message = valueOf($event)"></textarea>
            <EmojiPicker class="absolute! right-2 top-2" @pick="insertEmoji">
              <template #default="{ toggle }">
                <button type="button" :class="[ICON_BTN, 'size-8']" v-tooltip="'이모지 넣기'" @click="toggle"><Twemoji char="🙂" :size="20" /></button>
              </template>
            </EmojiPicker>
          </div>
          <div class="flex items-center justify-between gap-3 text-xs">
            <span :class="tooLong ? 'text-error' : 'text-on-surface-variant'">{{ tooLong ? `${(length - ANNOUNCE_MAX).toLocaleString("ko-KR")}자를 줄여 주세요` : "" }}</span>
            <span class="nums" :class="tooLong ? 'text-error' : 'text-on-surface-variant'">{{ length.toLocaleString("ko-KR") }} / {{ ANNOUNCE_MAX.toLocaleString("ko-KR") }}</span>
          </div>
        </div>
        <!-- 미리보기: 봇이 보낼 디스코드 임베드(왼쪽 색 띠 · 이모지 제목 · 본문 · 꼬리말)를 앱의 면 위에, 글꼴은 디스코드 순서(font-discord). 무슨 종류로 나가는지 보내기 전에 보이게 -->
        <div class="flex flex-col gap-2">
          <p class="text-xs text-on-surface-variant">디스코드 메시지 미리보기</p>
          <div class="flex rounded-(--r-inner) bg-surface-container-highest overflow-hidden font-discord">
            <span class="w-1 shrink-0" :style="{ backgroundColor: style.color }"></span>
            <div class="min-w-0 flex-1 px-4 py-3">
              <div class="flex items-center gap-2 text-sm font-semibold text-on-surface"><Twemoji :char="style.emoji" :size="18" />{{ style.title }}</div>
              <!-- 본문은 디스코드 마크다운으로 그린다(utils/discord-markdown). 스포일러는 누르면 드러난다 -->
              <!-- eslint-disable-next-line vue/no-v-html -- 글은 이스케이프하고 만든 태그만 넣는다 -->
              <div v-if="body" class="dmd mt-1 text-sm text-on-surface wrap-break-word" @click="revealSpoiler" v-html="rendered"></div>
              <p v-else class="mt-1 text-sm text-on-surface-variant">입력한 공지 내용은 여기에 들어가요</p>
              <p class="mt-2 text-xs text-on-surface-variant nums">봇 운영자 • {{ sentAt }}</p>
            </div>
          </div>
        </div>
        <div class="flex justify-end">
          <BaseButton variant="primary" :disabled="sending || !body || tooLong" @click="sendOpen = true"><Icon name="send" :size="20" />{{ sending ? "보내는 중..." : `${style.title} 전송` }}</BaseButton>
        </div>
      </div>
    </BaseCard>

    <BaseCard icon="public" title="참가 서버 목록">
      <div class="flex flex-col gap-3">
        <p class="text-sm text-on-surface-variant">봇이 참가 중인 서버예요. 내보내면 되돌릴 수 없고, 다시 초대할 때까지 봇을 사용하지 못해요.</p>
        <div class="flex flex-wrap items-center gap-2">
          <input :value="term" :placeholder="`${guilds.length}곳 중에서 찾기`" @input="term = valueOf($event)" :class="SEARCH_FIELD" class="flex-1 min-w-40" />
          <!-- 정렬 · 거르기: 고르기 칸 모양의 드롭다운 하나에(닫혀 있으면 고른 것을 줄여 보인다). 고를 때마다 닫지 않는다(여럿 바꿀 수 있게) -->
          <SelectPanel v-model:open="viewOpen" :summary="viewSummary" :muted="false" :count="0" :searchable="false" :empty="false" :rows="7" class="w-52 shrink-0">
            <p :class="SELECT_GROUP">정렬</p>
            <button v-for="o in SORTS" :key="o.value" type="button" role="menuitemradio" :aria-checked="sort === o.value" :class="[SELECT_ROW, sort === o.value && SELECT_ROW_ON]" @click="sort = o.value">{{ o.label }}</button>
            <p :class="SELECT_GROUP">필터</p>
            <button type="button" role="menuitemcheckbox" :aria-checked="playingOnly" :class="[SELECT_ROW, 'justify-between gap-2', playingOnly && SELECT_ROW_ON]" @click="playingOnly = !playingOnly">
              <span class="truncate"
                >재생 중인 서버 <span class="nums">({{ playingCount }})</span></span
              >
              <input type="checkbox" class="size-4 shrink-0 pointer-events-none" :class="playingOnly ? 'accent-on-tertiary-container' : 'accent-(--md-primary)'" :checked="playingOnly" tabindex="-1" />
            </button>
          </SelectPanel>
        </div>
        <!-- 목록 칸은 서버 7.5줄(한 단일 때 6.5줄) 높이로 고정하고 넘치면 구른다. 넘치면 칸 오른쪽을 카드 끝까지 넓혀 스크롤바가 가장자리에서 3 떨어지게(활성 플레이어 목록과 같다) -->
        <div ref="listEl" class="h-91 @4xl/content:h-105 overflow-y-auto -ml-2" :class="overflowing ? '-mr-4' : '-mr-2'" :style="listFade">
          <ul v-if="shown.length" class="flex flex-col">
            <li v-for="g in shown" :key="g.id" class="flex items-center gap-3 h-14 px-2 rounded-(--r-row)">
              <GuildAvatar :guild="{ name: g.name, icon: g.icon, hasPlayer: g.hasPlayer, state: g.hasPlayer ? 'playing' : 'idle' }" :status="g.hasPlayer" size-class="size-9" text-class="text-sm" class="shrink-0" />
              <div class="min-w-0 flex-1">
                <div class="text-sm font-semibold truncate">{{ g.name }}</div>
                <div class="text-xs text-on-surface-variant nums">
                  멤버 {{ g.memberCount.toLocaleString("ko-KR") }}명<template v-if="g.hasPlayer"> · <span class="text-(--ok-ink)">재생 중</span></template>
                </div>
              </div>
              <BaseButton variant="ghost" size="sm" @click="leaveTarget = g">나가기</BaseButton>
            </li>
          </ul>
          <p v-else class="px-2 py-3 text-sm text-on-surface-variant">{{ guilds.length ? "해당하는 서버가 없어요" : "참가 중인 서버가 없어요" }}</p>
        </div>
      </div>
    </BaseCard>

    <ConfirmDialog v-model="sendOpen" tone="primary" :icon="KIND_ICON[kind]" :title="`${guilds.length}곳에 공지를 보낼까요?`" :body="`${style.emoji} ${style.title}\n보낸 뒤에는 거둘 수 없어요.`" confirm-label="보내기" :busy="sending" @confirm="send" />
    <ConfirmDialog :model-value="leaveTarget !== null" icon="logout" :title="`'${leaveTarget?.name ?? ''}'에서 나갈까요?`" :body="`되돌릴 수 없어요. 다시 쓰려면 봇을 다시 초대해야 해요.${leaveTarget?.hasPlayer ? '\n지금 재생 중이라 재생도 멈춰요.' : ''}`" confirm-label="나가기" :busy="leaving" @update:model-value="(v) => !v && (leaveTarget = null)" @confirm="leave" />
  </div>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import { computed, nextTick, ref } from "vue";
import axios from "axios";
import { useIntervalFn, useNow } from "@vueuse/core";
import BaseButton from "./BaseButton.vue";
import BaseCard from "./BaseCard.vue";
import Icon from "./BaseIcon.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import EmojiPicker from "./EmojiPicker.vue";
import GuildAvatar from "./GuildAvatar.vue";
import Twemoji from "./TwemojiImage.vue";
import { useOverflowing } from "../composables/overflowing.ts";
import { useScrollFade } from "../composables/scroll-fade.ts";
import { caretOf, insertAt, type Caret } from "../utils/caret.ts";
import { discordMarkdown } from "../utils/discord-markdown.ts";
import { composing, valueOf } from "../utils/dom.ts";
import { koMatch } from "../utils/ko-search.ts";
import { SEARCH_FIELD } from "../utils/field.ts";
import { codeBlock, linePrefix, link, timestampTag, wrap, type Edit } from "../utils/markdown-edit.ts";
import { SELECT_GROUP, SELECT_ROW, SELECT_ROW_ON } from "../utils/select-row.ts";
import SelectPanel from "./SelectPanel.vue";
import { notify, notifyDone, notifyProblem } from "../composables/toasts.ts";
import { LIMIT } from "../utils/request.ts";
import { segment } from "../utils/segment.ts";
import { ANNOUNCE_MAX, ANNOUNCE_STYLE, announceBody, type AdminGuilds, type AnnounceKind, type BroadcastReply } from "../../../src/dashboard/contract/admin.ts";
import type { IconName } from "../icons.ts";

type AdminGuild = AdminGuilds["guilds"][number];
const props = defineProps<{ guilds: AdminGuild[] }>();
/** changed: 서버에서 나갔다(목록 · 봇 상태를 다시 읽는다) */
const emit = defineEmits<{ changed: [] }>();

// 다른 입력칸과 같은 채운 칸(모서리 12, 고르면 테두리 primary)
const FIELD = "block w-full bg-surface-container-highest border border-transparent rounded-(--r-inner) text-on-surface text-sm font-[inherit] pl-4 pr-12 py-3 resize-y outline-none transition-[border-color] duration-150 focus:border-primary placeholder:text-on-surface-variant";

// ── 전체 공지 ──
// 종류는 서버의 것(contract/admin 의 ANNOUNCE_KINDS)
const KIND_LABEL: Record<AnnounceKind, string> = { maintenance: "점검", update: "업데이트", alert: "긴급", info: "공지" };
// 종류 버튼의 아이콘(보낼 임베드의 이모지와 같은 뜻)
const KIND_ICON: Record<AnnounceKind, IconName> = { maintenance: "build", update: "new_releases", alert: "warning", info: "info" };
const KINDS = (Object.entries(KIND_LABEL) as Array<[AnnounceKind, string]>).map(([value, label]) => ({ value, label, icon: KIND_ICON[value] }));
const kind = ref<AnnounceKind>("maintenance");
const message = ref("");
// 서버처럼 앞뒤 공백을 뺀 길이로 센다. 길이 상한은 서버의 것(서버도 막지만 다 쓰고 나서야 막히면 늦다)
const body = computed(() => announceBody(message.value));
const length = computed(() => body.value.length);
// 꼬리말의 시각: 지금 보내면 찍힐 시각을 디스코드 한국어 표기로("오늘 오후 11:15"). 분이 바뀌면 따라간다
const now = useNow({ scheduler: (cb) => useIntervalFn(cb, 10_000) });
const sentAt = computed(() => `오늘 ${now.value.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })}`);
// 봇이 보낼 임베드의 모양(계약 ANNOUNCE_STYLE)
const style = computed(() => ANNOUNCE_STYLE[kind.value]);
const tooLong = computed(() => length.value > ANNOUNCE_MAX);
const sendOpen = ref(false);
const sending = ref(false);

// 미리보기 본문(디스코드 마크다운)
const rendered = computed(() => discordMarkdown(body.value));
function revealSpoiler(e: MouseEvent) {
  (e.target as HTMLElement).closest(".dmd-spoiler")?.classList.add("is-shown");
}

// 서식 도구. 단축키는 디스코드와 같다(굵게 Ctrl+B · 기울임 Ctrl+I · 밑줄 Ctrl+U · 링크 Ctrl+K)
type Run = (text: string, start: number, end: number) => Edit;
const tool = (icon: IconName, label: string, run: Run, key?: string) => ({ icon, label, tip: key ? `${label} (${key})` : label, run });
const FORMAT_GROUPS = [
  [tool("format_bold", "굵게", (t, a, b) => wrap(t, a, b, "**"), "Ctrl+B"), tool("format_italic", "기울임", (t, a, b) => wrap(t, a, b, "*"), "Ctrl+I"), tool("format_underlined", "밑줄", (t, a, b) => wrap(t, a, b, "__"), "Ctrl+U"), tool("format_strikethrough", "취소선", (t, a, b) => wrap(t, a, b, "~~")), tool("visibility_off", "스포일러", (t, a, b) => wrap(t, a, b, "||"))],
  [tool("format_h1", "제목 1", (t, a, b) => linePrefix(t, a, b, "# ")), tool("format_h2", "제목 2", (t, a, b) => linePrefix(t, a, b, "## ")), tool("format_h3", "제목 3", (t, a, b) => linePrefix(t, a, b, "### ")), tool("text_decrease", "작은 글씨", (t, a, b) => linePrefix(t, a, b, "-# "))],
  [tool("format_quote", "인용", (t, a, b) => linePrefix(t, a, b, "> ")), tool("format_list_bulleted", "목록", (t, a, b) => linePrefix(t, a, b, "- ")), tool("format_list_numbered", "번호 목록", (t, a, b) => linePrefix(t, a, b, "", true))],
  [tool("code", "코드", (t, a, b) => wrap(t, a, b, "`")), tool("code_blocks", "코드 블록", codeBlock), tool("link", "링크", link, "Ctrl+K"), tool("schedule", "현재 시간 (시간대 자동 변환)", timestampTag)],
];
const SHORTCUT: Record<string, Run> = { b: FORMAT_GROUPS[0][0].run, i: FORMAT_GROUPS[0][1].run, u: FORMAT_GROUPS[0][2].run, k: link };
function format(run: Run) {
  const el = box.value;
  if (!el) return;
  const r = run(message.value, el.selectionStart, el.selectionEnd);
  message.value = r.text;
  void nextTick(() => {
    el.focus();
    el.setSelectionRange(r.start, r.end);
    caret.value = { start: r.start, end: r.end };
  });
}
function onFormatKey(e: KeyboardEvent) {
  if (composing(e)) return;
  const run = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey ? SHORTCUT[e.key.toLowerCase()] : undefined;
  if (!run) return;
  e.preventDefault();
  format(run);
}

// 이모지는 커서 자리에 끼워 넣는다. 판을 열면 칸에서 초점이 떠나므로 떠나기 전 자리를 적어 둔다
const box = ref<HTMLTextAreaElement | null>(null);
const caret = ref<Caret | null>(null);
function insertEmoji(char: string) {
  const inserted = insertAt(message.value, char, caret.value, ANNOUNCE_MAX);
  if (!inserted) return;
  message.value = inserted.text;
  caret.value = { start: inserted.caret, end: inserted.caret };
  void nextTick(() => {
    box.value?.focus();
    box.value?.setSelectionRange(inserted.caret, inserted.caret);
  });
}

async function send() {
  if (!message.value.trim() || sending.value) return;
  sending.value = true;
  try {
    const { data } = await axios.post<BroadcastReply>("/api/admin/broadcast", { message: message.value, type: kind.value }, { timeout: LIMIT.long });
    message.value = "";
    // 몇 곳에 못 갔으면 경고로(보낸 곳 · 못 보낸 곳)
    if (data.failed) notify({ title: "공지를 일부만 보냈어요", body: `${data.sent}곳에 보내고 ${data.failed}곳에는 보내지 못했어요`, severity: "warning" });
    else notifyDone("공지를 보냈어요", `서버 ${data.sent}곳`);
  } catch (e) {
    // 서버가 알려 준 까닭을 보인다. "보내지 못함"만으로는 무엇을 고쳐야 할지 모른다
    notifyProblem(e, "공지를 보내지 못했어요.");
  } finally {
    sending.value = false;
    sendOpen.value = false;
  }
}

// ── 참가 서버 ──
const term = ref("");
const playingOnly = ref(false);
const playingCount = computed(() => props.guilds.filter((g) => g.hasPlayer).length);
// 정렬: 이름(기본) · 이름 역순 · 멤버 수. 봇이 넘겨주는 차례는 디스코드에서 받은 차례라 기준이 없어 쓰지 않는다
type Sort = "name" | "name-desc" | "members-desc" | "members-asc";
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "name", label: "이름순" },
  { value: "name-desc", label: "이름 역순" },
  { value: "members-desc", label: "멤버 많은 순" },
  { value: "members-asc", label: "멤버 적은 순" },
];
const sort = ref<Sort>("name");
const viewOpen = ref(false);
const viewSummary = computed(() => [SORTS.find((o) => o.value === sort.value)?.label, playingOnly.value && "재생 중만"].filter(Boolean).join(" · "));
const byName = new Intl.Collator("ko");
const shown = computed(() => {
  const list = props.guilds.filter((g) => (!playingOnly.value || g.hasPlayer) && koMatch(g.name, term.value));
  if (sort.value === "name-desc") return list.sort((a, b) => byName.compare(b.name, a.name));
  if (sort.value === "members-desc") return list.sort((a, b) => b.memberCount - a.memberCount);
  if (sort.value === "members-asc") return list.sort((a, b) => a.memberCount - b.memberCount);
  return list.sort((a, b) => byName.compare(a.name, b.name));
});
const listEl = ref<HTMLElement | null>(null);
const overflowing = useOverflowing(listEl);
// 더 있는 쪽 끝 반 줄(28)을 흐리게(봇 상태의 목록과 같다)
const listFade = useScrollFade(listEl, () => true, 28);

const leaveTarget = ref<AdminGuild | null>(null);
const leaving = ref(false);
async function leave() {
  const g = leaveTarget.value;
  if (!g || leaving.value) return;
  leaving.value = true;
  try {
    await axios.post(`/api/admin/guilds/${g.id}/leave`, undefined, { timeout: LIMIT.long });
    notifyDone("서버에서 나갔어요", g.name);
    emit("changed");
  } catch (e) {
    notifyProblem(e, "서버에서 나가지 못했어요.");
  } finally {
    leaving.value = false;
    leaveTarget.value = null;
  }
}
</script>
