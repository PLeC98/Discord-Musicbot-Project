// 요청 본문을 파일로 스트리밍해 받는다(큰 파일: 로그인 배경 올리기 · 백업 불러오기). 고정 상한 없이 남은 공간(room)으로만 막는다:
// Content-Length 가 room 을 넘으면 받지 않고, 없거나 틀려도 받는 동안 넘으면 멈춘다. 받는 동안은 <file>.part 에 쓰고 다 받으면 이름을 바꾼다

import fs from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request } from "express";
import { messageOf } from "../rules/error-kind.ts";

/** 받았다(크기) · 남은 공간이 모자라다 · 빈 본문 · 올리던 쪽이 끊었다(까닭) */
type Saved = { ok: true; bytes: number } | { ok: false; why: "no-space" | "empty" } | { ok: false; why: "aborted"; detail: string };

const NO_SPACE = Symbol("no-space");

async function saveBody(req: Request, file: string, room: number): Promise<Saved> {
  const length = Number(req.headers["content-length"]);
  if (room <= 0 || (Number.isFinite(length) && length > room)) return { ok: false, why: "no-space" };
  let written = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      written += chunk.length;
      done(written > room ? Object.assign(new Error("남은 공간을 넘었습니다"), { [NO_SPACE]: true }) : null, chunk);
    },
  });
  const part = `${file}.part`;
  try {
    await pipeline(req, guard, fs.createWriteStream(part));
  } catch (error) {
    fs.rmSync(part, { force: true });
    if ((error as { [NO_SPACE]?: boolean })[NO_SPACE]) return { ok: false, why: "no-space" };
    return { ok: false, why: "aborted", detail: messageOf(error) };
  }
  if (!written) {
    fs.rmSync(part, { force: true });
    return { ok: false, why: "empty" };
  }
  fs.renameSync(part, file);
  return { ok: true, bytes: written };
}

export { saveBody };
export type { Saved };
