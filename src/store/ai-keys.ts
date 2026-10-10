// AI 보조의 키(프로바이더마다 하나. 버텍스는 서비스 계정 JSON). 비밀 표(store/secrets)에 암호화해 둔다.
// 키는 넣을 때의 주소(binding: 그 프로바이더가 요청을 보내는 곳)에 묶인다. 주소가 바뀌면 키를 내주지 않는다(다시 넣어야 한다).
// 주소를 셈하는 것은 보조(autoplay/assist 의 keyBinding)이고 여기는 그 값을 받아 묶고 맞춰 볼 뿐이다.

import fs from "fs";
import path from "path";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "config" });
import { PROJECT } from "../infra/project-paths.ts";
import * as secrets from "./secrets.ts";
import type { AiKeyState } from "../rules/service-keys.ts";

const nameOf = (provider: string) => `ai.${provider}`;

/** 넣기. endpoint 는 그 프로바이더가 요청을 보내는 주소 */
function put(provider: string, value: string, endpoint: string) {
  secrets.put(nameOf(provider), value, { provider, endpoint });
}

function remove(provider: string) {
  secrets.remove(nameOf(provider));
}

/** 지금 주소로 꺼낸 키. 없거나 주소가 다르거나 못 풀면 빈 글자 */
function read(provider: string, endpoint: string) {
  const got = secrets.read(nameOf(provider), { provider, endpoint });
  return got.state === "ok" ? got.value : "";
}

function stateOf(provider: string, endpoint: string): AiKeyState {
  const got = secrets.read(nameOf(provider), { provider, endpoint });
  if (got.state === "ok" || got.state === "none" || got.state === "moved") return got.state;
  return "again";
}

/**
 * 저장된 키 값 모두(가리기용: 거절 응답이 되비춘 키를 화면 · 로그에서 지운다). 키마다 묶인 곳으로 푼다.
 * 묶인 주소 칸을 바꿔 둔 줄은 풀리지 않아 빠진다. 그런 키는 어디로도 나가지 않으므로 가릴 것도 없다
 */
function allValues(providers: readonly string[]) {
  const out: string[] = [];
  for (const provider of providers) {
    const { saved, endpoint } = secrets.status(nameOf(provider));
    if (!saved) continue;
    const got = secrets.read(nameOf(provider), { provider, endpoint });
    if (got.state === "ok") out.push(got.value);
  }
  return out;
}

/** 옛 키 파일(config/ai-keys.yaml)이 남아 있으면 기동 때 한 줄. 읽지도 지우지도 않는다 */
function warnLegacyFile(dir = PROJECT.config) {
  const file = path.join(dir, "ai-keys.yaml");
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    log.warn("config/ai-keys.yaml 은 이제 읽지 않습니다. 운영자 패널의 AI 보조 탭에서 키를 다시 넣고 이 파일은 지우세요");
  }
}

export { put, remove, read, stateOf, allValues, warnLegacyFile };
