// 봇 토큰의 앱 ID. .env에 두지 않고 기동과 pnpm commands가 앱 설정(GET /applications/@me)을 읽어 넣는다(app/app-info).
// 명령 배포 경로, 초대 링크, 대시보드 로그인(OAuth), 세션 쿠키 이름이 쓴다.
// 설정 객체(config)에 두지 않는다: 대시보드에서 설정을 저장하면 설정을 다시 계산해 덮어쓴다(store/tunables)

import { L } from "./log/text.ts";
import { logTextError } from "./log/log-text.ts";

let appId: string | null = null;

/** 읽은 앱 ID를 넣는다 */
function useAppId(id: string) {
  appId = id;
}

/** 앱 ID. 넣기 전에 부르면 예외를 던진다(빈 값으로 명령 배포 경로, 로그인 주소, 쿠키 이름을 만들지 않는다) */
function appIdOf(): string {
  if (!appId) throw logTextError(L.core.appIdNotRead());
  return appId;
}

/** 테스트: 넣은 앱 ID를 비운다 */
function _resetAppId() {
  appId = null;
}

export { useAppId, appIdOf, _resetAppId };
