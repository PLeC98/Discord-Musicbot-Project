// 운영자 패널의 "고급 설정 보기". 켜면 고급 항목(운영 조절값의 advanced · AI 보조의 고급 설정)이 제자리에 보이고, 끄면 빠진다.
// 운영자가 어느 기기로 열어도 같게 보이도록 서버(settings.db 의 panel 문서)에 둔다. 읽기 전에는 꺼진 채로 그린다

import { ref } from "vue";
import axios from "axios";
import { notifyProblem } from "./toasts.ts";
import type { PanelPrefs } from "../../../src/dashboard/contract/admin.ts";
import { text } from "../text/index.ts";

export const showAdvanced = ref(false);

/** 운영자 패널을 열 때 한 번 읽는다. 못 읽으면 꺼진 채로 둔다(보기 설정이라 막을 일은 아니다) */
export async function loadPanelPrefs() {
  try {
    showAdvanced.value = (await axios.get<PanelPrefs>("/api/admin/panel")).data.advanced;
  } catch {
    // 다음에 열 때 다시 읽는다
  }
}

/** 곧바로 바꾸고 서버에 쓴다. 못 쓰면 되돌리고 알린다 */
export async function setShowAdvanced(on: boolean) {
  const before = showAdvanced.value;
  showAdvanced.value = on;
  try {
    showAdvanced.value = (await axios.put<PanelPrefs>("/api/admin/panel", { advanced: on })).data.advanced;
  } catch (e) {
    showAdvanced.value = before;
    notifyProblem(e, text.tunables.visibility.saveFailed);
  }
}
