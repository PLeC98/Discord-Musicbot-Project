// AI 보조 설정(ai.yaml · ai-keys.yaml · ai-prompt.chatml).

import fs from "fs";
import path from "path";
import logger from "../infra/log/logger.ts";
import { repeatingFailure } from "../infra/repeating-failure.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
const log = logger.child({ category: "config" });
import { PROVIDERS } from "./schema/ai-providers.ts";
import { load, fileOf, save, configDir, cache } from "./yaml-store.ts";
import type { ConfigData } from "./yaml-store.ts";
import { aiProblems, PROMPT_FILE } from "./schema/ai.ts";
import { promptProblems, type PromptSection } from "./schema/ai-prompt.ts";

const validateAi = aiProblems;

// ── ai-keys.yaml ──────────────────────────────────────────────────────────
//
// 프로바이더마다 키가 따로다. 이 값은 대시보드로 내려보내지 않는다.
// 화면에는 있는지 없는지만 간다(src/dashboard/routes/admin.ts).
//
// .env 가 아니라 여기 두는 까닭: 프로바이더가 여럿이면 .env 한 칸을 돌려쓸 수 없고,
// 키를 갈아 끼울 때마다 봇을 다시 띄워야 한다. 설정 파일은 mtime 이 바뀌면 다시 읽는다.

// 키 파일을 못 읽는 것(문법 오류). 키 없이 부르면 401 로만 보여 까닭을 모른다
const keysUnreadable = repeatingFailure(log, "ai-keys.yaml 읽기");

function aiKeys(): Record<string, string> {
  try {
    const data = load("ai-keys");
    keysUnreadable.ok();
    return Object.fromEntries(Object.entries(data).map(([name, value]) => [name, String(value ?? "").trim()]));
  } catch (error) {
    // 파일이 없으면 키가 없는 것이다. 로컬 모델만 쓰면 이게 정상이다. 나머지는 알리고 키 없이 간다
    if (codeOf(error) !== "CONFIG_MISSING") keysUnreadable.fail(messageOf(error));
    return {};
  }
}

/** 이 프로바이더의 키(없으면 빈 문자열). */
const aiKeyOf = (provider: string) => aiKeys()[provider] || "";

/**
 * 키를 고쳐 쓴다. 적어 보낸 칸만 바꾸고 나머지는 그대로 둔다.
 * 돌려주는 것은 값이 아니라 있는지 없는지다. 값은 어느 통로로도 돌아나가지 않는다.
 */
function saveAiKeys(changes: unknown): Record<string, boolean> {
  if (!changes || typeof changes !== "object") throw Object.assign(new Error("저장할 내용이 없습니다"), { code: "CONFIG_INVALID" });

  const known = new Set(aiProviders());
  const next = { ...aiKeys() };
  for (const [name, value] of Object.entries(changes as Record<string, unknown>)) {
    if (!known.has(name)) continue; // 모르는 이름으로 칸을 늘리지 않는다
    if (value != null && typeof value !== "string") throw Object.assign(new Error(`${name}: 키는 글자여야 합니다`), { code: "CONFIG_INVALID" });
    next[name] = value == null ? "" : value.trim();
  }

  // 파일이 없으면 만들어 둔다. 설치 때 복사되지만 지웠을 수도 있다
  if (!fs.existsSync(fileOf("ai-keys"))) fs.writeFileSync(fileOf("ai-keys"), "", { mode: 0o600 });
  save("ai-keys", next, { secret: true });
  return Object.fromEntries(Object.entries(next).map(([name, value]) => [name, !!value]));
}

const CHATML = /<\|im_start\|>[ \t]*(\w+)[ \t]*\r?\n([\s\S]*?)<\|im_end\|>/g;

const promptPath = () => path.join(configDir(), PROMPT_FILE);

/** ChatML 글 → 섹션 목록. 블록 바깥의 글은 버린다(규격에 자리가 없다). */
function parseChatML(text: unknown): PromptSection[] {
  const out: PromptSection[] = [];
  for (const [, role, body] of String(text || "").matchAll(CHATML)) {
    out.push({ role: role.toLowerCase(), text: body.replace(/\r?\n$/, "") });
  }
  return out;
}

/** 섹션 목록 → ChatML 글. */
function toChatML(sections: PromptSection[] | null | undefined): string {
  return `${(sections || []).map((one) => `<|im_start|>${one?.role || "system"}\n${String(one?.text ?? "")}\n<|im_end|>`).join("\n\n")}\n`;
}

/** 지금 프롬프트. 파일이 없거나 비면 빈 목록. 부르는 쪽이 기본 구성을 쓴다. */
function aiPrompt(): PromptSection[] {
  let stat;
  try {
    stat = fs.statSync(promptPath());
  } catch {
    return [];
  }

  const cached = cache.get(PROMPT_FILE);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value as PromptSection[];

  const value = parseChatML(fs.readFileSync(promptPath(), "utf8"));
  cache.set(PROMPT_FILE, { mtimeMs: stat.mtimeMs, value });
  return value;
}

function saveAiPrompt(sections: unknown): PromptSection[] {
  const problems = promptProblems(sections, true);
  if (problems.length) throw Object.assign(new Error(problems[0]), { code: "CONFIG_INVALID", problems });

  // 검사를 지났다. 비었거나 섹션 목록이다
  fs.writeFileSync(promptPath(), toChatML(sections as PromptSection[] | null | undefined));
  cache.delete(PROMPT_FILE);
  log.info(`설정을 저장했습니다: ${PROMPT_FILE}`);
  return aiPrompt();
}

// ── ai.yaml ───────────────────────────────────────────────────────────────

// 상태와 같은 처지다. 곡을 고를 때마다 읽히므로 던지지 않는다.
// 던지면 자동재생이 통째로 멈춘다. AI는 없어도 되는 기능이라 그건 과하다.
let aiWarned = "";

/** 읽은 그대로의 ai.yaml. 문제가 있으면 enabled: false 를 얹는다 */
function ai(): ConfigData {
  let data;
  try {
    data = load("ai");
  } catch {
    return { enabled: false }; // 파일이 없어도 봇은 돈다. 이 기능만 꺼진다.
  }

  const problems = validateAi(data);
  const key = problems.join("|");
  if (problems.length && key !== aiWarned) log.warn(`ai.yaml: ${problems.join(" / ")}`);
  aiWarned = key;

  // 하나라도 어긋나면 켜지 않는다. 반만 맞는 설정으로 부르면 매번 실패하고 로그만 쌓인다
  return problems.length ? { ...data, enabled: false } : data;
}

// 목록은 schema/aiProviders 가 갖는다(주소 · 키 필요 여부까지 거기 있다).
const aiProviders = () => PROVIDERS;

export { ai, aiKeys, aiKeyOf, saveAiKeys, aiPrompt, saveAiPrompt, validateAi, parseChatML, toChatML, promptPath };
