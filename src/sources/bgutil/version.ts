// 봇이 쓰는 bgutil 빌드의 버전과 설정한 버전(BGUTIL_VERSION). 봇 정보 탭이 둘을 보이고, 기동 때 다르면 한 줄 남긴다.
// 새 릴리스는 조회하지 않는다

import config from "../../config/index.ts";
import logger from "../../infra/log/logger.ts";
import { bgutilBundle, type BgutilBundle } from "./bundle.ts";
const log = logger.child({ category: "core", sub: "bgutil" });

/** installed: 이 봇이 쓰는 빌드의 서버 버전(태그와 같은 글자), target: 설정한 버전. 설치돼 있지 않으면 null */
function bgutilVersions(bundle: BgutilBundle | null = bgutilBundle()) {
  return bundle ? { installed: bundle.version, target: config.bgutil.version } : null;
}

/** 기동. 설치된 것이 설정한 버전과 다르면(코드를 업데이트해 목표가 올랐는데 다시 설치하지 않음) 무엇을 할지 warn 한 줄 */
function warnOffTarget(bundle: BgutilBundle | null = bgutilBundle()) {
  const now = bgutilVersions(bundle);
  if (now && now.installed !== now.target) log.warn(`bgutil 설치 버전이 설정값과 다름: 설치 ${now.installed}, 설정 ${now.target}. pnpm run install:bgutil로 버전을 맞추고 봇을 다시 시작하세요`);
}

export { bgutilVersions, warnOffTarget };
