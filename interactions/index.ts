// 버튼 · 메뉴 · 모달 처리기 전부. 새 처리기는 여기에 더한다(events/interactionCreate 가 이 표로 고른다)

import { routes as buttons } from "./buttonHandler.ts";
import { routes as menus } from "./modalHandler.ts";
import { routes as autoplay } from "./autoplay.ts";
import { routes as playlistMore } from "./playlistMoreHandler.ts";
import { routes as sponsorConfig } from "./sponsorConfigHandler.ts";
import { routes as djRoleConfig } from "./djRoleConfigHandler.ts";
import type { Route } from "./route.ts";

const ROUTES: readonly Route[] = [...buttons, ...menus, ...autoplay, ...playlistMore, ...sponsorConfig, ...djRoleConfig];

export { ROUTES };
