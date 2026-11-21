// 화면 시작: 계정과 봇 정보를 먼저 요청하고, 화면 언어를 정해 문구를 채운 뒤 앱을 만들어 마운트한다(처음 그리는 글자부터 고른 언어로).
// dashboard/src/main.ts와 더미 대시보드가 같이 쓴다

import type { RouteRecordRaw } from "vue-router";
import type { BotInfo, Me } from "../../src/dashboard/contract/identity.ts";
import { createDashboard } from "./app.ts";
import { useUserStore } from "./stores/user.ts";
import { saveToAccount, startLanguage } from "./composables/screen-language.ts";
import { notify, notifyProblem } from "./composables/toasts.ts";
import { text } from "./text/index.ts";

/** 먼저 보내는 요청의 제한 시간. 넘기면 모르는 것으로 두고 앱이 평소처럼 다시 요청한다 */
const EARLY_MS = 3000;

/** 상태 코드와 본문(2xx일 때). 응답이 없으면 null */
async function early<T>(url: string): Promise<{ status: number; body: T | null } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(EARLY_MS) });
    return { status: res.status, body: res.ok ? ((await res.json()) as T) : null };
  } catch {
    return null;
  }
}

/** extraRoutes: 더할 라우트(app.ts의 createDashboard) */
async function startDashboard({ extraRoutes = [] }: { extraRoutes?: RouteRecordRaw[] } = {}) {
  const [meReply, botReply] = await Promise.all([early<Me>("/api/me"), early<BotInfo>("/api/bot")]);
  // 로그인한 계정, 로그인하지 않음(null), 모름(undefined)
  const me = meReply?.status === 200 ? meReply.body : meReply?.status === 401 ? null : undefined;
  const toAccount = await startLanguage({ me, bot: botReply?.body ?? null });

  const app = createDashboard({ extraRoutes });
  // 받은 계정은 스토어에 넘긴다(라우터가 다시 요청하지 않는다)
  if (me !== undefined) {
    const user = useUserStore();
    user.data = me;
    user.fetched = true;
  }
  app.mount("#app");

  if (toAccount) {
    const T = text.language;
    saveToAccount(toAccount).then(
      () => notify({ severity: "success", title: T.savedToAccount, body: T.appliesToDiscord }),
      (error: unknown) => notifyProblem(error, T.saveFailed),
    );
  }
}

export { startDashboard };
