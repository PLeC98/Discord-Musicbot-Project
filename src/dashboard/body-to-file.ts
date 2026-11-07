// 요청 본문을 파일로 스트리밍해 받는다(큰 파일: 로그인 배경 올리기, 백업 불러오기). 고정 상한 없이 남은 공간(room)으로만 막는다:
// Content-Length가 room을 넘으면 받지 않고, 없거나 틀려도 받는 동안 넘으면 멈춘다. 받는 동안은 <file>.part에 쓰고 다 받으면 이름을 바꾼다.
// 동시에 받는 요청이 있으면 그 요청이 앞으로 더 쓸 크기(명시된 크기에서 이미 쓴 양을 뺀 값)를 room에서 뺀다. 각 요청이 남은 공간 전부를 쓸 수 있다고 판단하지 않게 한다.
// 크기를 명시하지 않은 요청은 남은 공간 전부를 쓸 수 있으므로 그만큼을 미리 잡아 둔다(그동안 다른 요청은 이 요청이 아직 쓰지 않은 양만큼 가용 공간이 줄어든다)

import fs from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request } from "express";
import { messageOf } from "../rules/error-kind.ts";

/** 저장 완료(크기), 남은 공간 부족(이 요청이 쓸 수 있던 크기, busy: 동시에 받는 다른 요청이 잡아 둔 공간 때문인지 여부), 빈 본문, 전송 중단(원인) */
type Saved = { ok: true; bytes: number } | { ok: false; why: "no-space"; room: number; busy: boolean } | { ok: false; why: "empty" } | { ok: false; why: "aborted"; detail: string };

const NO_SPACE = Symbol("no-space");

/** 수신 중인 요청: 확보한 크기(명시된 크기, 모르면 시작 시점의 남은 공간)와 지금까지 쓴 바이트 수 */
const receiving = new Set<{ claimed: number; written: number }>();
/** 수신 중인 요청들이 앞으로 더 쓸 크기 */
const ahead = () => [...receiving].reduce((sum, one) => sum + Math.max(0, one.claimed - one.written), 0);

async function saveBody(req: Request, file: string, room: number): Promise<Saved> {
  const length = Number(req.headers["content-length"]);
  const left = room - ahead();
  if (left <= 0 || (Number.isFinite(length) && length > left)) return { ok: false, why: "no-space", room: Math.max(0, left), busy: room > 0 && !(Number.isFinite(length) && length > room) };
  const me = { claimed: Number.isFinite(length) ? length : left, written: 0 };
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      me.written += chunk.length;
      done(me.written > left ? Object.assign(new Error("남은 공간을 넘음"), { [NO_SPACE]: true }) : null, chunk);
    },
  });
  const part = `${file}.part`;
  receiving.add(me);
  try {
    await pipeline(req, guard, fs.createWriteStream(part));
  } catch (error) {
    fs.rmSync(part, { force: true });
    if ((error as { [NO_SPACE]?: boolean })[NO_SPACE]) return { ok: false, why: "no-space", room: left, busy: left < room && me.written <= room };
    return { ok: false, why: "aborted", detail: messageOf(error) };
  } finally {
    receiving.delete(me);
  }
  const written = me.written;
  if (!written) {
    fs.rmSync(part, { force: true });
    return { ok: false, why: "empty" };
  }
  fs.renameSync(part, file);
  return { ok: true, bytes: written };
}

export { saveBody };
export type { Saved };
