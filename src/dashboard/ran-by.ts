import type { Request } from "express";
import { signedIn } from "./middleware/require-auth.ts";

/** 로그에 남기는 실행한 사람(사용자 이름, 없으면 id) */
function ranBy<P>(req: Request<P>) {
  const user = signedIn(req);
  return user.username || user.id;
}

export { ranBy };
