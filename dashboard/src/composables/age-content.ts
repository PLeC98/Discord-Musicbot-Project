// 연령 제한 콘텐츠(운영자 단위, 봇의 config/age-content). 켜면 연령 제한 탭이 생기고, 끄면 연령 관련 설정은 어디에도 보이지 않는다.
// 저장 막대와 상관없이 곧바로 서버에 쓴다. 읽기 전에는 꺼진 채로 그린다

import { ref } from "vue";
import axios from "axios";
import { notifyProblem } from "./toasts.ts";
import type { AgeContent } from "../../../src/dashboard/contract/admin.ts";
import { text } from "../text/index.ts";

export const ageContent = ref<AgeContent>({ enabled: false, changedAt: null });

/** 운영자 패널을 열 때 한 번 읽는다. 못 읽으면 꺼진 채로 둔다 */
export async function loadAgeContent() {
  try {
    ageContent.value = (await axios.get<AgeContent>("/api/admin/age-content")).data;
  } catch {
    // 다음에 열 때 다시 읽는다
  }
}

/** 켜거나 끈다. 못 쓰면 그대로 두고 알린다. 바뀌었으면 true */
export async function setAgeContent(enabled: boolean) {
  try {
    ageContent.value = (await axios.put<AgeContent>("/api/admin/age-content", { enabled })).data;
    return true;
  } catch (e) {
    notifyProblem(e, text.ageContent.saveFailed);
    return false;
  }
}
