// AI 보조가 화면 · 로그 · 리퀘스트 로그에 내보내는 글에서 키를 가린다. 판정(assist/index)과 기록(assist/request-log)이 같이 쓴다.
//
// 어떤 서비스는 거절 응답에 보낸 값을 되비춘다. 화면에도 로그에도 키가 남으면 안 된다.
// 무엇이 가려진 것인지 알아볼 수 있게 이름을 붙인다(별표만 있으면 원래 그런 값인 줄 안다).

import * as aiKeys from "../../store/ai-keys.ts";
import * as googleAuth from "./google-auth.ts";
import { PROVIDERS } from "../../config/schema/ai-providers.ts";
import { isSecretHeader } from "../../rules/secret-headers.ts";

const REDACTED = "[REDACTED_SECRET_KEY]";

// 지금 쓰는 프로바이더 것만이 아니라 적혀 있는 키를 모두 가린다.
// 어느 것이 되비쳐 올지 우리가 정할 수 없고, 넉넉히 가려서 손해 볼 것이 없다.
function mask(text: unknown): string {
  let out = String(text);
  // 받아 둔 액세스 토큰도 가린다. 서비스 계정에서 나온 것이라 키만큼 값이 나간다
  for (const key of [...aiKeys.allValues(PROVIDERS), ...googleAuth.heldTokens()]) {
    if (!key || key.length <= 8) continue;
    out = out.split(key).join(REDACTED);

    // 서비스 계정은 값 자체가 JSON 블록이다. 통째로 나오는 일은 없어도 키만 떨어져 나올 수는
    // 있으므로 안쪽 private_key 도 따로 가린다.
    if (key.trimStart().startsWith("{")) {
      try {
        const inner = JSON.parse(key)?.private_key;
        if (inner) out = out.split(inner).join(REDACTED);
      } catch {
        /* JSON 이 아니면 경로였던 것이다 */
      }
    }
  }
  return out;
}

// 인증이 실리는 헤더는 규격마다 다르다(rules/secret-headers)

/** 화면에 보여도 되는 헤더. 키 값은 절대 나가지 않는다. */
function safeHeaders(headers: Record<string, string> | null | undefined) {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (!isSecretHeader(name)) {
      out[name] = value;
      continue;
    }
    // 앞의 낱말(Bearer)은 남긴다. 어떤 방식으로 붙는지는 보이는 편이 낫다
    const scheme = /^(\w+)\s/.exec(String(value));
    out[name] = scheme ? `${scheme[1]} ${REDACTED}` : REDACTED;
  }
  return out;
}

export { REDACTED, mask, safeHeaders };
