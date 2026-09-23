"use strict";

// AI 보조 설정(ai.yaml · ai-keys.yaml · ai-prompt.chatml).

const fs = require("fs");
const path = require("path");
const log = require("../infra/log/logger").child({ category: "config" });
const { PROVIDERS } = require("./schema/aiProviders");
const { load, fileOf, save, configDir, cache } = require("./yamlStore");

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

// ── ai-prompt.chatml ──────────────────────────────────────────────────────
//
// 프롬프트는 설정과 딴 파일에 산다. 설정 파일에 긴 글을 섞으면 YAML 들여쓰기에 걸려
// 손으로 고치기 나쁘고, 프롬프트만 주고받기도 어렵다.
//
// 모양은 ChatML 이다. 채팅 프론트엔드들이 쓰는 그 규격이라 옮겨 붙이기 쉽다.
//
//   <|im_start|>system
//   판정 기준…
//   <|im_end|>

const PROMPT_FILE = "ai-prompt.chatml";

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

function validateAi(data) {
  const problems = [];
  if (data?.provider != null && !aiProviders().includes(data.provider)) problems.push(`provider는 ${aiProviders().join(" · ")} 중 하나여야 합니다.`);
  if (data?.enabled != null) problems.push("enabled 는 provider 로 바뀌었습니다. off 또는 openai 를 적으세요.");

  // 켤 때만 나머지를 따진다. 꺼 둔 설정이 반쯤 비어 있다고 나무랄 이유가 없다.
  if (data?.provider && data.provider !== "off") {
    // baseUrl 은 custom 일 때만 쓴다. 나머지는 프로바이더에 박힌 주소로 간다(autoplayAssist)
    if (data.provider === "custom") {
      if (!String(data.baseUrl || "").trim()) problems.push("provider가 custom이면 baseUrl을 적어야 합니다.");
      else if (!/^https?:\/\//.test(String(data.baseUrl).trim())) problems.push("baseUrl은 http:// 또는 https:// 로 시작해야 합니다.");
    }
    if (!String(data.model || "").trim()) problems.push("model을 적어야 합니다.");
  }

  const num = (key, min, max) => {
    if (data?.[key] == null) return;
    const value = Number(data[key]);
    if (!Number.isFinite(value) || value < min || value > max) problems.push(`${key}는 ${min}~${max} 사이여야 합니다.`);
  };
  // 온도도 모델이 받는 칸 하나다. params 아래로 옮겼다. 남아 있으면 조용히 무시되므로 알린다.
  if (data?.temperature != null) problems.push("temperature는 params 아래에 모델별로 적습니다.");
  num("timeoutMs", 1000, 600000);
  num("batchSize", 1, 50);

  // 추가 파라미터는 한 줄에 하나씩 적는 글이다(autoplayAssist.parseExtra)
  if (data?.extra != null && typeof data.extra !== "string") problems.push("extra는 한 줄에 하나씩 적는 글이어야 합니다.");
  if (data?.prompt != null) problems.push(`프롬프트는 ${PROMPT_FILE} 에 적습니다. ai.yaml 의 prompt 는 쓰이지 않습니다.`);

  for (const key of ["project", "location"]) {
    if (data?.[key] != null && typeof data[key] !== "string") problems.push(`${key}는 글자로 적어야 합니다.`);
  }

  // 모델이 받는 칸의 값. 모델 이름으로 한 겹 나뉜다. 안 그러면 모델을 바꿨을 때
  // 앞 모델 값이 따라온다. 칸 이름이 맞는지는 모델 프로필이 판단한다(autoplayAssist.withParams).
  if (data?.params != null) {
    if (typeof data.params !== "object" || Array.isArray(data.params)) {
      problems.push("params는 모델 이름 아래에 칸을 적는 표여야 합니다.");
    } else {
      for (const [model, values] of Object.entries(data.params)) {
        if (values != null && (typeof values !== "object" || Array.isArray(values))) {
          problems.push(`params.${model} 은 칸 이름과 값을 적는 표여야 합니다(모델 이름으로 한 겹 나눕니다).`);
        }
      }
    }
  }

  // 모델 목록에서 가릴 이름(글롭). 저쪽 목록에는 영상·이미지 모델도 섞여 나온다.
  if (data?.hideModels != null && !(Array.isArray(data.hideModels) && data.hideModels.every((one) => typeof one === "string"))) {
    problems.push('hideModels는 글자 목록이어야 합니다(예: ["*sora*", "gpt-3.5*"]).');
  }

  // 섹션 이름은 대시보드에서 어느 섹션인지 알아보려고 붙이는 것이다.
  // ChatML 에는 이름을 적을 자리가 없어서 여기 둔다. 차례가 프롬프트 섹션과 같아야 한다.
  if (data?.promptNames != null && !(Array.isArray(data.promptNames) && data.promptNames.every((one) => one == null || typeof one === "string"))) {
    problems.push("promptNames는 글자 목록이어야 합니다.");
  }

  problems.push(...listProblems(data?.list));
  return problems;
}

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

const AI_UNKNOWN = ["hide", "text", "zero"];

function listProblems(list) {
  if (list == null) return [];
  if (typeof list !== "object" || Array.isArray(list)) return ["list는 이름:값 꼴이어야 합니다."];

  const problems = [];
  if (list.lineFormat != null) {
    if (typeof list.lineFormat !== "string") problems.push("list.lineFormat은 글로 적어야 합니다.");
    // 제목이 없으면 판정할 거리가 없다
    else if (list.lineFormat.trim() && !/\{\{\s*제목\s*\}\}/.test(list.lineFormat)) problems.push("list.lineFormat에 {{제목}} 이 있어야 합니다.");
  }
  if (list.unknownDuration != null && !AI_UNKNOWN.includes(list.unknownDuration)) problems.push(`list.unknownDuration은 ${AI_UNKNOWN.join(" · ")} 중 하나여야 합니다.`);
  if (list.unknownText != null && typeof list.unknownText !== "string") problems.push("list.unknownText는 글로 적어야 합니다.");
  return problems;
}

module.exports = { ai, aiKeys, aiKeyOf, saveAiKeys, aiPrompt, saveAiPrompt, validateAi, promptProblems, parseChatML, toChatML, promptPath };
