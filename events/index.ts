// 디스코드 이벤트 처리기 전부. 새 처리기는 여기에 더한다(app/main 이 이 목록으로 등록한다). 폴더의 파일과 같은지는 시험(test/app/moduleLists)이 본다

import channelDelete from "./channelDelete.ts";
import interactionCreate from "./interactionCreate.ts";
import messageHandler from "./messageHandler.ts";
import panelPin from "./panelPin.ts";
import type { AnyClientEvent } from "../src/app/main.ts";

const EVENTS: readonly AnyClientEvent[] = [channelDelete, interactionCreate, messageHandler, panelPin];

export { EVENTS };
