import crypto from "crypto";

function createPlayerSessionId() {
  // 144비트는 커스텀 ID를 작게 유지하면서도 충돌이나 추측을 불가능하게 만듬.
  return crypto.randomBytes(18).toString("base64url");
}

export default createPlayerSessionId;
export { createPlayerSessionId as "module.exports" };
