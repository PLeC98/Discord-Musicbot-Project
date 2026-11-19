// 봇이 그리는 이미지의 워커 스레드. @napi-rs/canvas 의 모듈 불러오기, 글꼴 등록, 그리기가 동기라
// 메인 스레드(음성 프레임 타이머가 도는 곳)에서 돌리지 않는다. 받는 것은 일(kind 와 값), 반환하는 것은 이미지들.
// close 를 받으면 글꼴을 지우고 끝난다(지우지 않고 종료하면 글꼴 메모리가 프로세스에 남는다)

import { parentPort } from "node:worker_threads";
import { messageOf } from "../../rules/error-kind.ts";
import { drawQueueMosaic } from "../queue-mosaic/draw.ts";
import { drawSystemCards } from "../system-card/draw.ts";
import { releaseFonts } from "./canvas-fonts.ts";
import type { Job } from "./render.ts";

/** napi 가 만든 Buffer 는 전송할 수 없어 전송 가능한 사본으로 */
const transferable = (image: Buffer) => image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer;

async function imagesOf(job: Job): Promise<Buffer[]> {
  if (job.kind === "queue") return [await drawQueueMosaic(job.data)];
  const { top, bottom } = await drawSystemCards(job.data);
  return [top, bottom];
}

async function draw(id: number, job: Job) {
  try {
    const images = (await imagesOf(job)).map(transferable);
    parentPort?.postMessage({ id, images }, images);
  } catch (error) {
    parentPort?.postMessage({ id, error: messageOf(error) });
  }
}

type Message = { id: number; job: Job } | { close: true };

parentPort?.on("message", (message: Message) => {
  if ("close" in message) {
    releaseFonts();
    parentPort?.close();
    return;
  }
  void draw(message.id, message.job);
});
