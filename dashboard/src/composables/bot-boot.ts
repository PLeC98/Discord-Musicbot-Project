// 열려 있는 동안 봇이 다시 켜졌는가. 응답 헤더의 기동 표시(서버의 dashboard/middleware/boot-mark)가 처음 본 것과 달라지면 다시 켜진 것이다.
// 화면이 들고 있던 상태(카드가 한 번 읽은 값, 옛 빌드의 화면)는 옛것이라 새로고침한다. 저장하지 않은 편집이 있으면 날아가지 않게 알림의 버튼으로 맡긴다.
// 대시보드에서 누른 다시 시작은 이보다 먼저 새 프로세스를 기다려 새로고침한다(composables/bot-restart)

import { unsaved } from "./unsaved.ts";
import { notify } from "./toasts.ts";
import { text } from "../text/index.ts";

let first: string | null = null;
let told = false;

/** 응답마다 부른다. id: 응답의 기동 표시(없으면 부르지 않는다). reload는 테스트가 넘긴다 */
function noteBoot(id: string, reload: () => void = () => location.reload()): void {
  first ??= id;
  if (id === first || told) return;
  told = true;
  if (unsaved.size === 0) return reload();
  const T = text.shell.botRestarted;
  notify({ severity: "info", title: T.title, body: T.body, actions: [{ label: T.action, icon: "restart_alt", run: reload }] });
}

/** 테스트: 처음 상태로 */
function _resetBoot() {
  first = null;
  told = false;
}

export { noteBoot, _resetBoot };
