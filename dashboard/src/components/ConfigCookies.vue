<template>
  <div class="flex flex-col gap-(--gap-in)">
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>
    <!-- yt-dlp 는 끝나면서 쿠키 항아리를 그 파일에 되쓴다. 그때 갈아 끼우면 옛것으로 되돌아간다 -->
    <NoticeBox v-if="state.inFlight > 0" variant="note" tone="notice" icon="warning" class="mt-0!">지금 연령 제한 영상 {{ state.inFlight }}건이 이 쿠키를 쓰고 있어요. 그쪽이 끝나면서 방금 저장한 내용을 되돌릴 수 있으니, 잠시 뒤 한 번 더 저장해 주세요.</NoticeBox>

    <BaseCard icon="cookie" title="유튜브 쿠키">
      <!-- 있는지 없는지만 안다. 값은 쓰기 전용이라 어느 통로로도 내려오지 않는다 -->
      <template #actions>
        <span class="inline-flex items-center gap-1 text-xs" :class="state.hasFile ? 'text-primary' : 'text-on-surface-variant'"><Icon :name="!known ? 'help' : state.hasFile ? 'check_circle' : 'radio_button_unchecked'" :size="16" :fill="known && state.hasFile" />{{ !known ? "저장돼 있는지 몰라요" : state.hasFile ? "저장된 쿠키 있음" : "저장된 쿠키 없음" }}</span>
      </template>
      <!-- 무엇에 쓰는지 한 줄, 언제 갈아 끼우는지는 툴팁 -->
      <p class="mb-3 flex items-center gap-1 text-sm text-on-surface-variant">연령 제한 영상을 받을 때만 써요.<Icon name="info" :size="16" class="shrink-0 cursor-help" v-tooltip="'유튜브가 세션을 바꾸면 만료 시각 전에도 무효가 돼요.\n로그에 cookies are no longer valid 가 보이면 새로 붙여넣어 주세요.'" /></p>

      <div class="flex flex-col gap-2">
        <textarea :value="input" rows="6" autocomplete="off" spellcheck="false" wrap="off" :placeholder="placeholder" :class="[AREA, 'font-mono text-xs', state.hasFile && 'placeholder:font-sans']" @input="input = valueOf($event)"></textarea>
        <div class="flex items-center gap-2">
          <BaseButton :disabled="!input.trim() || saving" @click="save">{{ saving ? "저장 중…" : "저장" }}</BaseButton>
          <button v-if="state.hasFile" type="button" :class="[ICON_BTN, 'size-10']" class="hover:text-error" :disabled="saving" aria-label="저장된 쿠키 지우기" v-tooltip="'저장된 쿠키 지우기'" @click="clear"><Icon name="delete" :size="20" /></button>
        </div>
        <p class="flex items-center gap-1 text-xs text-on-surface-variant">브라우저 확장에서 복사한 내용이나 내려받은 파일의 내용 전부를 그대로 붙여넣으세요.<Icon name="info" :size="14" class="shrink-0 cursor-help" v-tooltip="'내보내는 방법은 README를 참고하세요.'" /></p>
        <p v-if="!secureOrigin" class="text-xs text-(--warn-ink)">지금 평문(HTTP)으로 접속 중이에요. 쿠키가 그대로 네트워크를 지나가요.</p>
      </div>
    </BaseCard>
  </div>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import { valueOf } from "../utils/dom.ts";
import { problemText } from "../utils/problem.ts";
import { AREA } from "../utils/field.ts";
import { trackUnsaved } from "../composables/unsaved.ts";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { ref, reactive, computed, onMounted } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import type { CookieState } from "../../../src/dashboard/contract/admin.ts";

const input = ref("");
// 붙여 넣고 저장하지 않은 쿠키도 떠날 때 묻는다
trackUnsaved(
  "cookies",
  computed(() => Boolean(input.value.trim())),
);
const saving = ref(false);
const loadError = ref("");
const state = reactive<CookieState>({ source: "none", hasFile: false, inFlight: 0 });
// 서버에서 상태를 받았는지. 못 받았으면 "없음"이 아니라 모른다
const known = ref(false);

const placeholder = computed(() => (state.hasFile ? "바꾸려면 새 쿠키를 붙여넣어요" : "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t…"));
const secureOrigin = computed(() => window.isSecureContext);

function apply(data: CookieState) {
  Object.assign(state, data);
  known.value = true;
  loadError.value = "";
}

async function put(text: string) {
  saving.value = true;
  try {
    apply((await axios.put<CookieState>("/api/admin/cookies", { text })).data);
    input.value = "";
    notifyDone(text ? "쿠키를 저장했어요" : "쿠키를 지웠어요");
  } catch (err) {
    notifyProblem(err, text ? "쿠키를 저장하지 못했어요." : "쿠키를 지우지 못했어요.");
  } finally {
    saving.value = false;
  }
}

const save = () => put(input.value);
const clear = () => put("");

onMounted(async () => {
  try {
    apply((await axios.get<CookieState>("/api/admin/cookies")).data);
  } catch (err) {
    // 저장은 여전히 된다
    loadError.value = problemText(err, "쿠키 상태를 읽지 못했어요.");
  }
});
</script>
