<template>
  <!-- 권한 적용해서 보기(디스코드의 "역할 적용해서 서버 보기", 서버 판정까지 같이 낮아진다) · 유지 관리(커맨드 재배포 · 캐시 초기화). 넓으면 두 단 -->
  <div class="grid grid-cols-1 xl:grid-cols-2 gap-(--gap-in) items-start">
    <BaseCard icon="visibility" title="권한 적용해서 보기">
      <p class="mb-3 flex items-center gap-1 text-sm text-on-surface-variant">설정한 권한으로 대시보드를 표시해요.<Icon name="info" :size="16" class="shrink-0 cursor-help" v-tooltip="'화면뿐 아니라 서버가 허용하는 동작도 그 권한을 따라요.\n이 패널은 어느 권한으로 보든 계속 열 수 있어요.'" /></p>
      <div role="radiogroup" aria-label="권한 수준" class="flex flex-col gap-1">
        <button v-for="t in TIER_ROWS" :key="t.id ?? 'none'" type="button" role="radio" :aria-checked="user.viewAs === t.id" :class="[tierRow, user.viewAs === t.id && SELECT_ROW_ON]" :disabled="switchingTier" @click="pickTier(t.id)">
          <Icon :name="user.viewAs === t.id ? 'radio_button_checked' : 'radio_button_unchecked'" :size="20" class="mt-px shrink-0" :class="user.viewAs !== t.id && 'text-on-surface-variant'" />
          <span class="min-w-0">
            <span class="block text-sm">{{ t.label }}</span>
            <span class="block text-xs font-normal" :class="user.viewAs !== t.id && 'text-on-surface-variant'">{{ t.desc }}</span>
          </span>
        </button>
      </div>
    </BaseCard>

    <!-- 줄마다 이름 · 설명, 오른쪽에 하기. 좁으면 단추가 아래로 -->
    <BaseCard icon="build" title="유지 관리">
      <div class="flex flex-col">
        <div :class="actionRow">
          <div class="min-w-0 flex-1 basis-56">
            <p class="text-sm font-semibold text-on-surface">슬래시 커맨드 재배포</p>
            <p class="text-xs text-on-surface-variant">봇 재시작 없이 현재 커맨드들을 디스코드에 다시 등록해요.</p>
          </div>
          <BaseButton variant="secondary" :disabled="redeploying" @click="redeploy">{{ redeploying ? "재배포 중…" : "재배포" }}</BaseButton>
        </div>
        <div :class="actionRow" class="border-t border-outline-variant/40">
          <div class="min-w-0 flex-1 basis-56">
            <p class="text-sm font-semibold text-on-surface">캐시 초기화</p>
            <p class="text-xs text-on-surface-variant">받아 둔 오디오 파일과 조회 기록을 모두 지워요. 서버 설정은 남아요.</p>
          </div>
          <BaseButton variant="ghost" class="text-error!" :disabled="resetting" @click="confirmReset = true">{{ resetting ? "지우는 중…" : "초기화" }}</BaseButton>
        </div>
      </div>
    </BaseCard>
  </div>

  <ConfirmDialog v-model="confirmReset" icon="delete" title="캐시를 모두 지울까요?" :body="RESET_CONFIRM" confirm-label="모두 지우기" :busy="resetting" @confirm="resetCache" />
</template>

<script setup lang="ts">
import { ref } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import Icon from "./BaseIcon.vue";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { LIMIT } from "../utils/request.ts";
import { SELECT_ROW_ON } from "../utils/select-row.ts";
import { useUserStore, VIEW_AS_TIERS } from "../stores/user.ts";
import type { RedeployReply, ResetReply } from "../../../src/dashboard/contract/admin.ts";
import type { Tier } from "../../../src/dashboard/contract/identity.ts";

// ── 권한 수준 오버라이드 ──────────────────────────────────────────────────────
// 계층을 바꾸면 스토어가 페이지를 다시 읽는다. 서버 목록·플레이어 권한이 통째로 달라지기 때문.
const user = useUserStore();
const switchingTier = ref(false);
// 맨 위는 오버라이드 안 함(null). 고르는 계층이 아니라 평소 상태다
const TIER_ROWS: { id: Tier | null; label: string; desc: string }[] = [{ id: null, label: "오버라이드 안 함 (운영자)", desc: "일반 사용 시의 권한과 같아요." }, ...VIEW_AS_TIERS];

// 라디오 줄(고른 줄은 목록 · 상세의 고른 줄과 같은 색)
const tierRow = "state-layer w-full flex items-start gap-3 text-left rounded-(--r-inner) px-3 py-2.5 text-on-surface cursor-pointer transition-[background-color,border-radius] duration-150 disabled:cursor-not-allowed disabled:opacity-38";
// 유지 관리 카드의 한 줄
const actionRow = "flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0";

async function pickTier(tier: Tier | null) {
  if (switchingTier.value || user.viewAs === tier) return;
  switchingTier.value = true;
  try {
    await user.setViewAs(tier); // 성공하면 새로고침되므로 아래로 돌아오지 않는다
  } catch (e) {
    notifyProblem(e, "권한 수준을 바꾸지 못했어요.");
    switchingTier.value = false;
  }
}

// ── 캐시 초기화 ───────────────────────────────────────────────
const confirmReset = ref(false);
const resetting = ref(false);
const RESET_CONFIRM = "되돌릴 수 없어요. 오디오 파일 · 조회 기록 · SponsorBlock 구간 캐시가 사라지고, 다음 재생부터 다시 받아요.\n서버 설정(전용 채널 · DJ 역할 · SponsorBlock)은 남아요.";

// 지운 것 · 남긴 것(재생 중)
function resetSummary(r: ResetReply) {
  const mb = Math.round((r.freedBytes || 0) / 1024 / 1024);
  const kept = r.kept > 0 ? `\n${r.kept}개는 재생 중이라 남겼어요` : "";
  return `파일 ${r.removed}개 · ${mb}MB${kept}`;
}

async function resetCache() {
  if (resetting.value) return;
  resetting.value = true;
  try {
    const { data } = await axios.post<ResetReply>("/api/admin/reset-cache", undefined, { timeout: LIMIT.long });
    notifyDone("캐시를 비웠어요", resetSummary(data));
  } catch (e) {
    notifyProblem(e, "캐시를 비우지 못했어요.");
  } finally {
    resetting.value = false;
    confirmReset.value = false;
  }
}

// ── 명령 다시 배포 ─────────────────────────────────────────
const redeploying = ref(false);

async function redeploy() {
  if (redeploying.value) return;
  redeploying.value = true;
  try {
    const { data } = await axios.post<RedeployReply>("/api/admin/redeploy-commands", undefined, { timeout: LIMIT.long });
    notifyDone("커맨드를 다시 배포했어요", `${data.count}개 · ${data.scope === "guild" ? "서버" : "전역"}`);
  } catch (e) {
    notifyProblem(e, "커맨드를 다시 배포하지 못했어요.");
  } finally {
    redeploying.value = false;
  }
}
</script>
