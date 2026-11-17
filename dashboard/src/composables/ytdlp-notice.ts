// yt-dlp 새 버전 알림. 자동 업데이트가 알림이면 봇은 하루 한 번 확인만 하고 교체는 운영자에게 맡긴다(sources/ytdlp-binary).
// 운영자가 대시보드를 열 때 확인으로 본 최신 버전이 설치된 버전과 다르면 한 번 띄운다. 같은 버전은 이 탭에서 다시 띄우지 않는다(sessionStorage).
// 버전을 고정했으면 띄우지 않는다. 상태를 못 읽으면 조용히 넘어간다(알림이 오지 않을 뿐 업데이트 탭에서 볼 수 있다)

import { watch } from "vue";
import axios from "axios";
import { notify } from "./toasts.ts";
import { readStored, writeStored } from "../utils/storage.ts";
import { useUserStore } from "../stores/user.ts";
import type { VendorReply } from "../../../src/dashboard/contract/admin.ts";
import { text } from "../text/index.ts";
const T = text.ytdlp;

const SEEN_KEY = "ytdlp-notified";

async function check() {
  const { ytdlp } = (await axios.get<VendorReply>("/api/admin/vendor", { quietSession: true })).data.status;
  const latest = ytdlp.seen?.latest;
  if (ytdlp.mode !== "notify" || ytdlp.pin || !latest || latest === ytdlp.version || readStored(SEEN_KEY, true) === latest) return;
  writeStored(SEEN_KEY, latest, true);
  notify({ title: T.available, body: T.availableBody(ytdlp.version ?? T.noVersion, latest, ytdlp.channel), severity: "info", actions: [{ label: T.availableAction, icon: "arrow_forward", to: "/admin?tab=update" }] });
}

/** App에서 한 번. 운영자로 들어오면(로그인, 권한 수준 오버라이드를 해제했을 때 포함) 한 번 본다 */
export function useYtdlpNotice(): void {
  const user = useUserStore();
  let checked = false;
  watch(
    () => user.isOwner,
    (owner) => {
      if (!owner || checked) return;
      checked = true;
      check().catch(() => {
        /* 못 읽으면 알리지 않는다 */
      });
    },
    { immediate: true },
  );
}
