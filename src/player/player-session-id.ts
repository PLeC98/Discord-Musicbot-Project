import crypto from "crypto";

function createPlayerSessionId(): string {
  // 144비트(18바이트): 커스텀 ID를 짧게 두면서 충돌, 추측은 사실상 불가능한 길이다
  return crypto.randomBytes(18).toString("base64url");
}

export { createPlayerSessionId };
