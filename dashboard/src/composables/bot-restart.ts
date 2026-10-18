// 봇 다시 시작. 봇 상태 탭의 버튼 · 운영 조절값 저장 막대의 "저장 후 다시 시작"이 함께 쓴다. 창(BotRestartDialog)은 운영자 패널에 하나.
// 봇이 스스로 다시 시작하는 일(봇 전체 초기화)은 보내지 않고 기다리기만 한다(waitRestart).
// asking: 버튼을 눌러 묻는 중. starting: 다시 시작을 보내는 중(로그인한 지 오래됐으면 다시 로그인을 마칠 때까지 여기서 기다린다. 창은 닫혀 있다).
// waiting: 봇이 받았고 내려갔다 다시 뜨기를 기다리는 중. 새 프로세스(pid)가 답하면 화면을 새로고침한다

import { ref } from "vue";
import axios from "axios";
import { notify, notifyProblem } from "./toasts.ts";
import type { AdminStatus, RestartReply } from "../../../src/dashboard/contract/admin.ts";
import { text } from "../text/index.ts";
const T = text.restart;

// 다시 뜨기를 기다리는 상한과 확인 간격. 기동은 보통 몇 초, POToken 서버가 늦으면 30초 남짓
const WAIT_MS = 120_000;
const POLL_MS = 1500;

type Phase = "idle" | "asking" | "starting" | "waiting";
const phase = ref<Phase>("idle");

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const pidNow = async () => (await axios.get<AdminStatus>("/api/admin/status", { timeout: 3000 })).data.env.pid;

// 새 프로세스가 답하면 true. 내려가 있는 동안의 실패는 기다린다
async function cameBack(before: number) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    try {
      if ((await pidNow()) !== before) return true;
    } catch {
      // 아직 내려가 있다
    }
  }
  return false;
}

/** 확인 창을 연다 */
function askRestart() {
  if (phase.value === "idle") phase.value = "asking";
}

// 다른 프로세스가 답할 때까지 기다려 새로고침한다(새 봇이 새 화면을 줄 수 있다: 빌드를 바꾼 뒤 다시 시작했을 때). 못 오면 알리고 끝낸다
async function waitFor(before: number) {
  phase.value = "waiting";
  if (await cameBack(before)) {
    location.reload();
    return;
  }
  notify({ title: T.timeoutTitle, body: T.timeoutBody });
  phase.value = "idle";
}

/** 묻지 않고 다시 시작한다(이미 선택한 일: 확인 창의 다시 시작 · 저장 후 다시 시작) */
async function restartNow() {
  phase.value = "starting";
  try {
    const before = await pidNow();
    await axios.post<RestartReply>("/api/admin/restart");
    await waitFor(before);
  } catch (err) {
    notifyProblem(err, T.failed);
    phase.value = "idle";
  }
}

/** 지금 봇 프로세스(봇이 스스로 다시 시작하는 일을 보내기 전에 받아 둔다) */
const currentPid = pidNow;

/** 봇이 스스로 다시 시작한다(봇 전체 초기화). 보내지 않고, before(보내기 전의 프로세스)와 다른 봇이 답할 때까지 기다린다 */
const waitRestart = (before: number) => waitFor(before);

/** 확인 창을 닫는다. 기다리는 중에는 닫지 않는다 */
function cancelRestart() {
  if (phase.value === "asking") phase.value = "idle";
}

export { phase as restartPhase, askRestart, restartNow, currentPid, waitRestart, cancelRestart };
