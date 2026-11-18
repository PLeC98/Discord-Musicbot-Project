// bgutil의 설치 상태(대시보드 업데이트 탭의 카드가 읽는다, 공유 타입 sources/bgutil/status-types). 기록은 부를 때마다 새로 읽는다(터미널의 install:bgutil이 바꿀 수 있다)

import config from "../../config/index.ts";
import { PROJECT } from "../../infra/project-paths.ts";
import { readState } from "./state.ts";
import { bgutilBundle } from "./bundle.ts";
import { bgutilAutoInstall } from "./auto-install.ts";
import { potServerUrl } from "../youtube/pot-server.ts";
import type { BgutilCardStatus } from "./status-types.ts";

function bgutilCardStatus(): BgutilCardStatus {
  const auto = bgutilAutoInstall;
  const enabled = auto.deps.savedEnabled();
  const read = readState(PROJECT.bgutil);
  const active = read.kind === "ok" ? read.state.active : null;
  const bundle = bgutilBundle();
  const target = auto.deps.target();
  // 저장한 켜기가 기동 때와 다르거나, 기록의 지금 빌드가 이 봇이 쓰는 빌드와 다르면(그사이 설치) 다시 시작해야 적용된다
  const restartNeeded = enabled !== config.bgutil.enabled || (enabled && (active?.folder ?? null) !== (bundle?.folder ?? null));
  return {
    enabled,
    running: potServerUrl() !== null,
    installed: active ? { tag: active.tag, version: active.version } : null,
    serving: bundle ? { tag: bundle.tag, version: bundle.version } : null,
    target: "error" in target ? null : target,
    targetError: "error" in target ? target.error : null,
    job: auto.job(),
    failure: auto.failure,
    missing: auto.missing,
    restartNeeded,
  };
}

export { bgutilCardStatus };
