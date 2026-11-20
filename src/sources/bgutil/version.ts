// 봇이 쓰는 bgutil 빌드의 태그와 설정한 태그(업데이트 탭의 bgutil 카드, 고정하지 않았으면 코드의 기본값). 봇 정보 탭이 둘을 보이고, 기동 때 다르면 한 줄 남긴다.
// 새 릴리스는 조회하지 않는다

import config from "../../config/index.ts";
import logger from "../../infra/log/logger.ts";
import { bgutilBundle, type BgutilBundle } from "./bundle.ts";
const log = logger.child({ category: "core", sub: "bgutil" });

/** installed: 이 봇이 쓰는 빌드의 태그, target: 설정한 태그, same: 태그와 커밋이 둘 다 같다. 설치돼 있지 않으면 null */
function bgutilVersions(bundle: BgutilBundle | null = bgutilBundle()) {
  return bundle ? { installed: bundle.tag, target: config.bgutil.version, same: bundle.tag === config.bgutil.version && bundle.commit === config.bgutil.commit } : null;
}

/** 기동. 설치된 것이 설정한 버전과 다르면(코드를 업데이트해 목표가 올랐는데 다시 설치하지 않음) 무엇을 할지 warn 한 줄 */
function warnOffTarget(bundle: BgutilBundle | null = bgutilBundle()) {
  const now = bgutilVersions(bundle);
  if (!bundle || !now || now.same) return;
  // 태그가 같으면 커밋이 다르다(옮겨진 태그를 다시 고정했다)
  const [installed, target] = now.installed === now.target ? [`${now.installed}(${bundle.commit.slice(0, 7)})`, `${now.target}(${config.bgutil.commit.slice(0, 7)})`] : [now.installed, now.target];
  log.warn(`bgutil 설치 버전이 설정값과 다름: 설치 ${installed}, 설정 ${target}. 대시보드 업데이트 탭의 bgutil 카드에서 설치하거나 pnpm run install:bgutil로 맞춘 뒤 봇을 다시 시작하세요`);
}

export { bgutilVersions, warnOffTarget };
