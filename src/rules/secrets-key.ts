// .env 의 SECRETS_KEY(비밀값 암호화 키) 모양과 만들기. 설치 스크립트(scripts/setup-config)와 설정 검사(config)가 같은 것을 쓴다.

import crypto from "crypto";

/** 키 길이(바이트). base64 로 적는다 */
const SECRETS_KEY_BYTES = 32;

/** 운영자에게 알려 줄 만드는 명령. 출력을 .env 의 SECRETS_KEY= 뒤에 넣는다 */
const SECRETS_KEY_COMMAND = `node -e "console.log(require('node:crypto').randomBytes(${SECRETS_KEY_BYTES}).toString('base64'))"`;

/** 무작위 32바이트를 base64 로 */
function newSecretsKey() {
  return crypto.randomBytes(SECRETS_KEY_BYTES).toString("base64");
}

/** base64 로 적은 32바이트인가. 다시 적었을 때 같은 글자여야 한다(잘린 값 · 다른 글자가 섞인 값을 걸러낸다) */
function isSecretsKey(value: string) {
  const text = value.trim();
  const bytes = Buffer.from(text, "base64");
  return bytes.length === SECRETS_KEY_BYTES && bytes.toString("base64") === text;
}

/** 세션 쿠키 서명 비밀. 64자 */
function newSessionSecret() {
  return crypto.randomBytes(48).toString("base64url");
}

export { SECRETS_KEY_BYTES, SECRETS_KEY_COMMAND, newSecretsKey, isSecretsKey, newSessionSecret };
