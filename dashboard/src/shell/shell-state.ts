// 틀의 상태: 세로 막대를 펼쳤는지와 펼친 폭(이 브라우저에만 기억한다), 위 막대 제목 뒤에 붙일 말(휴대폰에서 지금 보는 탭 등)

import { reactive } from "vue";
import { readStored, writeStored } from "../utils/storage.ts";

const KEY = "shell:sidebar";
const WIDTH_KEY = "shell:sidebar-width";

/** 펼친 폭(px)의 기본 · 범위 */
const SIDEBAR_WIDTH = { initial: 240, min: 180, max: 360 };

const clampWidth = (px: number) => Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, px)));
const storedWidth = Number(readStored(WIDTH_KEY));

const shell = reactive({
  sidebarOpen: readStored(KEY) === "open",
  sidebarWidth: Number.isFinite(storedWidth) && storedWidth > 0 ? clampWidth(storedWidth) : SIDEBAR_WIDTH.initial,
  /** 휴대폰 위 막대 제목 뒤에 " - 이것"(화면이 정한다, 없으면 빈 글) */
  subtitle: "",
  /** 바탕화면 높이(px). App 이 잰다. 화면 아래에 붙는 판(휴대폰 대기열 판)이 높이를 셈한다 */
  deskHeight: 0,
  /** 봇 프로필 그림(App 이 /api/bot 에서 받는다). 없거나 못 받으면 null, 모든 서버 아이콘이 기호로 */
  botAvatar: null as string | null,
});

function toggleSidebar() {
  shell.sidebarOpen = !shell.sidebarOpen;
  writeStored(KEY, shell.sidebarOpen ? "open" : "closed");
}

/** 펼친 폭을 바꾼다. save 면 기억한다(끄는 동안은 기억하지 않고 놓을 때 한 번) */
function setSidebarWidth(px: number, save = false) {
  shell.sidebarWidth = clampWidth(px);
  if (save) writeStored(WIDTH_KEY, String(shell.sidebarWidth));
}

export { shell, toggleSidebar, setSidebarWidth, SIDEBAR_WIDTH };
