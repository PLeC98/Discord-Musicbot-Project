// 운영자 패널 설정 탭의 봇 운영자 카드(/api/admin/operators)가 주고받는 형식

import type { OperatorScope } from "../../rules/app-owners.ts";
import type { TunablesView } from "./admin.ts";

/** 범위를 바꿀 수 없는 까닭. personal: 개인 앱(넓힐 팀이 없다), override: OWNER_ID 로 정했다, not-app-owner: 팀 소유자가 아니다, unknown: 앱 정보를 받지 못했다 */
type ScopeLock = "personal" | "override" | "not-app-owner" | "unknown";

/**
 * 봇 운영자. kind: 앱 종류(모르면 null), source: 운영자를 정한 곳(app: 앱 정보, override: OWNER_ID), operators: 지금 운영자,
 * teamId: 팀 앱의 팀 ID(개발자 포털의 팀 페이지 링크용, 모르면 null), scope: 넓히는 범위(저장한 값), stale: 앱 정보를 오랫동안 받지 못해 넓힌 범위를 되돌렸다, lock: 바꿀 수 없으면 그 까닭
 */
type OperatorsView = {
  kind: "personal" | "team" | null;
  source: "app" | "override";
  operators: Array<{ id: string; name: string }>;
  teamId: string | null;
  scope: OperatorScope;
  stale: boolean;
  lock: ScopeLock | null;
};

/** 범위를 바꾼 응답. tunables: 범위를 저장한 운영 설정값(화면이 저장 번호를 맞춰 저장 바의 다음 저장이 충돌로 거절되지 않게 한다) */
type ScopeSaved = { operators: OperatorsView; tunables: TunablesView };

export type { OperatorsView, ScopeLock, ScopeSaved };
