// 디스코드 이벤트 처리기 전부. 새 처리기는 여기에 더한다(app/main 이 이 목록으로 등록한다). 폴더의 파일과 같은지는 시험(test/app/module-lists)이 본다

import channelDelete from "./channel-delete.ts";
import interactionCreate from "./interaction-create.ts";
import messageHandler from "./message-handler.ts";
import panelPin from "./panel-pin.ts";
import type { AnyClientEvent } from "../../app/main.ts";

const EVENTS: readonly AnyClientEvent[] = [channelDelete, interactionCreate, messageHandler, panelPin];

export { EVENTS };
