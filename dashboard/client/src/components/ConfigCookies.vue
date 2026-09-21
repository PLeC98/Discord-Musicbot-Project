<template>
  <BaseCard icon="gear" title="유튜브 쿠키">
    <p class="text-muted text-[0.82rem] mt-1 mb-3">연령 제한 영상에만 쓰입니다. 유튜브가 브라우저 쪽에서 세션을 돌리면 만료 시각과 상관없이 무효가 되므로, 로그에 <code class="text-fg-soft">cookies are no longer valid</code> 가 보이면 여기에 새로 붙여넣으세요.</p>

    <!-- 값은 쓰기 전용이다. 저장된 내용은 어느 통로로도 내려오지 않는다. -->
    <textarea v-model="input" rows="6" autocomplete="off" spellcheck="false" wrap="off" :placeholder="placeholder" :class="[inputCls, 'font-mono text-[0.72rem] leading-relaxed resize-y']"></textarea>

    <div class="flex items-center gap-2 mt-2">
      <BaseButton :disabled="!input.trim() || saving" @click="save">{{ saving ? "저장 중…" : "저장" }}</BaseButton>
      <button v-if="state.hasFile" :class="iconBtn" :disabled="saving" v-tooltip="'저장된 쿠키 지우기'" @click="clear"><Icon name="trash" :size="15" /></button>
      <span :class="state.hasFile ? 'text-[0.78rem] text-[#4ade80]' : 'text-[0.78rem] text-muted'">{{ state.hasFile ? "저장됨" : "저장된 쿠키 없음" }}</span>
    </div>

    <p v-if="error" class="mt-2 text-[0.78rem] text-[#f87171]">{{ error }}</p>

    <!-- yt-dlp 는 끝나면서 쿠키 항아리를 그 파일에 되쓴다. 그때 갈아 끼우면 옛것으로 되돌아간다 -->
    <p v-if="state.inFlight > 0" class="mt-2 text-[0.78rem] text-[#fbbf24]">지금 연령 제한 영상 {{ state.inFlight }}건이 이 쿠키를 쓰는 중입니다. 그쪽이 끝나면서 방금 저장한 내용을 되돌릴 수 있으니, 잠시 뒤 한 번 더 저장해 주세요.</p>
    <p v-if="!secureOrigin" class="mt-1 text-[0.78rem] text-[#fbbf24]">지금 평문(HTTP)으로 접속 중입니다. 쿠키가 그대로 네트워크를 지나갑니다.</p>

    <p class="text-muted text-[0.78rem] mt-3 opacity-80">브라우저 확장에서 <strong>복사하기</strong> 한 내용을 그대로 붙여넣으면 됩니다. 파일로 받았다면 열어서 전체를 복사하세요. 내보내는 방법은 README 를 참고하세요.</p>
  </BaseCard>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";

const input = ref("");
const saving = ref(false);
const error = ref("");
const state = reactive({ source: "none", hasFile: false, inFlight: 0 });

const placeholder = computed(() => (state.hasFile ? "저장돼 있습니다. 바꾸려면 새 쿠키를 붙여넣으세요" : "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t…"));
const secureOrigin = computed(() => window.isSecureContext);

const inputCls = "w-full bg-white/5 border border-white/9 rounded-xl text-fg px-3.5 py-2 text-[0.9rem] outline-none font-[inherit] [color-scheme:dark] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7";
const iconBtn = "h-[38px] w-[38px] rounded-xl border border-white/9 text-muted cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color] duration-150 hover:bg-white/10 hover:text-fg disabled:opacity-35 disabled:cursor-not-allowed";

function apply(data) {
  Object.assign(state, data);
}

async function put(text) {
  saving.value = true;
  error.value = "";
  try {
    apply((await axios.put("/api/admin/cookies", { text })).data);
    input.value = "";
  } catch (err) {
    error.value = err.response?.data?.error || "쿠키를 저장하지 못했습니다.";
  } finally {
    saving.value = false;
  }
}

const save = () => put(input.value);
const clear = () => put("");

onMounted(async () => {
  try {
    apply((await axios.get("/api/admin/cookies")).data);
  } catch {
    /* 못 읽으면 저장된 것이 없는 것처럼 보인다. 저장은 여전히 된다 */
  }
});
</script>
