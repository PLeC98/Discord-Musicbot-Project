// AI 보조 설정(ai.yaml · ai-prompt.chatml). 키는 비밀 표에 있다(store/ai-keys).

import fs from "fs";
import path from "path";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "config" });
import { load, configDir, cache } from "./yaml-store.ts";
import type { ConfigData } from "./yaml-store.ts";
import { aiProblems, PROMPT_FILE } from "./schema/ai.ts";
import { promptProblems, type PromptSection } from "./schema/ai-prompt.ts";

const validateAi = aiProblems;

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

/** 프롬프트를 쓴다. on: AI 를 켜 두는가(켜 두면 {{목록}} 자리까지 본다. 꺼 두면 파일이 깨지지 않을 만큼만) */
function saveAiPrompt(sections: unknown, on = true): PromptSection[] {
  const problems = promptProblems(sections, on);
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

export { ai, aiPrompt, saveAiPrompt, validateAi, parseChatML, toChatML, promptPath };
