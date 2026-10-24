// 버튼 · 메뉴 · 모달 처리기 전부. 새 처리기는 여기에 더한다(src/discord/events/interaction-create 가 이 표로 선택한다)

import { routes as buttons } from "./button-handler.ts";
import { routes as menus } from "./modal-handler.ts";
import { routes as autoplay } from "./autoplay.ts";
import { routes as playlistMore } from "./playlist-more-handler.ts";
import { routes as settingsPanel } from "./settings-panel-handler.ts";
import type { Route } from "./route.ts";

const ROUTES: readonly Route[] = [...buttons, ...menus, ...autoplay, ...playlistMore, ...settingsPanel];

export { ROUTES };
