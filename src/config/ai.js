"use strict";

// AI 보조 설정(ai.yaml · ai-keys.yaml · ai-prompt.chatml).

const fs = require("fs");
const path = require("path");
const log = require("../infra/log/logger").child({ category: "config" });
const { PROVIDERS } = require("./schema/aiProviders");
const { load, fileOf, save, configDir, cache } = require("./yamlStore");
const { aiProblems, PROMPT_FILE } = require("./schema/ai");

const validateAi = aiProblems;

// ── ai-keys.yaml ──────────────────────────────────────────────────────────
//
// 프로바이더마다 키가 따로다. 이 값은 대시보드로 내려보내지 않는다.
// 화면에는 있는지 없는지만 간다(dashboard/server/routes/admin.js).
//
// .env 가 아니라 여기 두는 까닭: 프로바이더가 여럿이면 .env 한 칸을 돌려쓸 수 없고,
// 키를 갈아 끼울 때마다 봇을 다시 띄워야 한다. 설정 파일은 mtime 이 바뀌면 다시 읽는다.

function aiKeys() {
  try {
    const data = load("ai-keys");
    return Object.fromEntries(Object.entries(data).map(([name, value]) => [name, String(value ?? "").trim()]));
  } catch {
    return {}; // 파일이 없으면 키가 없는 것이다. 로컬 모델만 쓰면 이게 정상이다.
  }
}

/** 이 프로바이더의 키(없으면 빈 문자열). */
const aiKeyOf = (provider) => aiKeys()[provider] || "";

/**
 * 키를 고쳐 쓴다. 적어 보낸 칸만 바꾸고 나머지는 그대로 둔다.
 * 돌려주는 것은 값이 아니라 있는지 없는지다. 값은 어느 통로로도 돌아나가지 않는다.
 */
function saveAiKeys(changes) {
  if (!changes || typeof changes !== "object") throw Object.assign(new Error("저장할 내용이 없습니다"), { code: "CONFIG_INVALID" });

  const known = new Set(aiProviders());
  const next = { ...aiKeys() };
  for (const [name, value] of Object.entries(changes)) {
    if (!known.has(name)) continue; // 모르는 이름으로 칸을 늘리지 않는다
    if (value != null && typeof value !== "string") throw Object.assign(new Error(`${name}: 키는 글자여야 합니다`), { code: "CONFIG_INVALID" });
    next[name] = value == null ? "" : value.trim();
  }

  // 파일이 없으면 만들어 둔다. 설치 때 복사되지만 지웠을 수도 있다
  if (!fs.existsSync(fileOf("ai-keys"))) fs.writeFileSync(fileOf("ai-keys"), "");
  save("ai-keys", next);
  return Object.fromEntries(Object.entries(next).map(([name, value]) => [name, !!value]));
}

const CHATML = /<\|im_start\|>[ \t]*(\w+)[ \t]*\r?\n([\s\S]*?)<\|im_end\|>/g;

const promptPath = () => path.join(configDir(), PROMPT_FILE);

/** ChatML 글 → 섹션 목록. 블록 바깥의 글은 버린다(규격에 자리가 없다). */
function parseChatML(text) {
  const out = [];
  for (const [, role, body] of String(text || "").matchAll(CHATML)) {
    out.push({ role: role.toLowerCase(), text: body.replace(/\r?\n$/, "") });
  }
  return out;
}

/** 섹션 목록 → ChatML 글. */
function toChatML(sections) {
  return `${(sections || []).map((one) => `<|im_start|>${one?.role || "system"}\n${String(one?.text ?? "")}\n<|im_end|>`).join("\n\n")}\n`;
}

/** 지금 프롬프트. 파일이 없거나 비면 빈 목록. 부르는 쪽이 기본 구성을 쓴다. */
function aiPrompt() {
  let stat;
  try {
    stat = fs.statSync(promptPath());
  } catch {
    return [];
  }

  const cached = cache.get(PROMPT_FILE);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value;

  const value = parseChatML(fs.readFileSync(promptPath(), "utf8"));
  cache.set(PROMPT_FILE, { mtimeMs: stat.mtimeMs, value });
  return value;
}

function saveAiPrompt(sections) {
  const problems = promptProblems(sections, true);
  if (problems.length) throw Object.assign(new Error(problems[0]), { code: "CONFIG_INVALID", problems });

  fs.writeFileSync(promptPath(), toChatML(sections));
  cache.delete(PROMPT_FILE);
  log.info(`설정을 저장했습니다: ${PROMPT_FILE}`);
  return aiPrompt();
}

// ── ai.yaml ───────────────────────────────────────────────────────────────

// 상태와 같은 처지다. 곡을 고를 때마다 읽히므로 던지지 않는다.
// 던지면 자동재생이 통째로 멈춘다. AI는 없어도 되는 기능이라 그건 과하다.
let aiWarned = "";

function ai() {
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

// 목록은 autoplayAssist 가 갖는다(주소·키 필요 여부까지 거기 있다).
// 여기서 위로 require 하면 순환이다. 그쪽이 이 파일을 먼저 부른다. 쓸 때 부른다.
const aiProviders = () => PROVIDERS;

// 프롬프트는 섹션 목록이다. 섹션마다 역할(system·user·assistant)과 내용을 갖는다.
// 비우면 기본 구성을 쓰므로, 적었을 때만 따진다.
const AI_ROLES = ["system", "user", "assistant"];

function promptProblems(prompt, on) {
  if (prompt == null) return [];
  if (!Array.isArray(prompt)) return ["프롬프트는 섹션 목록이어야 합니다(역할과 내용을 가진 항목들)."];
  if (!prompt.length) return [];

  const problems = [];
  prompt.forEach((section, i) => {
    const where = `${i + 1}번째 섹션`;
    if (!section || typeof section !== "object") return problems.push(`${where}: 역할과 내용을 적어야 합니다.`);
    if (!AI_ROLES.includes(section.role)) problems.push(`${where}: 역할은 ${AI_ROLES.join(" · ")} 중 하나여야 합니다.`);
    if (section.text != null && typeof section.text !== "string") problems.push(`${where}: 내용은 글로 적어야 합니다.`);
    // ChatML 은 블록 안에 끝 표시가 또 나오면 파일이 깨진다
    if (/<\|im_(start|end)\|>/.test(String(section?.text ?? ""))) problems.push(`${where}: 내용에 <|im_start|>·<|im_end|> 를 적을 수 없습니다.`);
  });

  // 후보를 어디에도 안 넣으면 모델은 무엇을 판정할지 모른다. 켜 두고 이러면 매번 헛돈다.
  const hasList = prompt.some((section) => /\{\{\s*목록\s*\}\}/.test(String(section?.text ?? "")));
  if (on && !hasList) problems.push("어딘가에 {{목록}} 이 있어야 합니다. 그 자리에 판정할 후보가 들어갑니다.");
  return problems;
}

module.exports = { ai, aiKeys, aiKeyOf, saveAiKeys, aiPrompt, saveAiPrompt, validateAi, promptProblems, parseChatML, toChatML, promptPath };
