// /system 이미지를 그리는 워커 스레드. @napi-rs/canvas 의 모듈 불러오기, 글꼴 등록, 그리기가 동기라
// 메인 스레드(음성 프레임 타이머가 도는 곳)에서 돌리지 않는다. 받는 것은 그릴 값, 반환하는 것은 PNG 둘.
// close 를 받으면 글꼴을 지우고 끝난다(지우지 않고 종료하면 글꼴 메모리가 프로세스에 남는다)

import { parentPort } from "node:worker_threads";
import { messageOf } from "../../rules/error-kind.ts";
import { drawSystemCards, releaseFonts, type CardData } from "./draw.ts";

/** napi 가 만든 Buffer 는 전송할 수 없어 전송 가능한 사본으로 */
const transferable = (png: Buffer) => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;

async function draw(id: number, data: CardData) {
  try {
    const { top, bottom } = await drawSystemCards(data);
    const pngs = [transferable(top), transferable(bottom)];
    parentPort?.postMessage({ id, top: pngs[0], bottom: pngs[1] }, pngs);
  } catch (error) {
    parentPort?.postMessage({ id, error: messageOf(error) });
  }
}

type Message = { id: number; data: CardData } | { close: true };

parentPort?.on("message", (message: Message) => {
  if ("close" in message) {
    releaseFonts();
    parentPort?.close();
    return;
  }
  void draw(message.id, message.data);
});
