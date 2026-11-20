// 모든 응답에 이번 기동의 표시를 싣는다. 열려 있던 화면이 봇이 다시 켜진 것을 알아 옛 상태를 새로 읽게 한다(composables/bot-boot).
// PID, 기동 시각 대신 무작위 값이다: 로그인하지 않은 요청에도 붙는다

import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { BOOT_HEADER } from "../contract/boot.ts";

const BOOT = crypto.randomUUID();

function bootMark(_req: Request, res: Response, next: NextFunction) {
  res.setHeader(BOOT_HEADER, BOOT);
  next();
}

export { bootMark };
