// AI 보조 설정(settings.db의 "ai" 문서)의 스키마. 프롬프트("ai-prompt" 문서)는 제 형식이 따로 있어 여기서 보지 않는다(schema/ai-prompt).

import { PROVIDERS } from "./ai-providers.ts";
import { VERTEX_LOCATION } from "../../rules/vertex-url.ts";
import { setsSecretHeader } from "../../rules/secret-headers.ts";
import { extraLineProblems } from "../../rules/ai-extra.ts";
import { z, ALWAYS, coded, present, plain, problemsOf } from "./problems.ts";
import { rule, type RuleProblem } from "../../rules/rule-problem.ts";
import { LINE_NAMES, parseFormat, usesName, type Problem } from "../../rules/line-format.ts";

/**
 * 줄 형식의 문제(글자 위치와 함께, 화면이 그 위치를 표시한다). 비우면 기본 형식이라 문제가 없다. 제목이 없으면 판정할 거리가 없다.
 * 길이를 모르는 후보는 줄 형식 안에서 정한다({{#if-exist {{duration}}}} … {{:else}} … {{/}}). 옛 필드(list.unknownDuration, unknownText)는 읽지 않는다
 */
function lineFormatProblems(format: string): Problem[] {
  if (!format.trim()) return [];
  const { nodes, problems } = parseFormat(format, LINE_NAMES);
  return usesName(nodes, "title") ? problems : [...problems, { at: 0, end: 0, rule: rule("format-needs-title") }];
}

// AI 설정의 키 순서(기본 설정 문서와 같다). 저장은 받은 순서대로 두므로 대시보드가 이 순서로 보낸다(내보내기 글이 읽기 좋게)
const AI_KEY_ORDER = ["enabled", "provider", "baseUrl", "location", "project", "timeoutMs", "retries", "totalTimeoutMs", "retryTimeouts", "retryDelayMs", "retryDelayMaxMs", "retryStatus", "batchSize", "skipConfident", "list", "model", "params", "extra", "hideModels", "promptNames"] as const;

// 모델이 받는 수치 필드. 범위를 벗어나거나 수가 아니면 같은 문구
/** 요청 하나의 시간 한도(ms) 범위. 저장과 운영자 패널의 테스트(저장 전 초안)가 같이 쓴다 */
const AI_TIMEOUT_RANGE = { min: 1000, max: 600000 } as const;

const between = (key: string, min: number, max: number) =>
  present(
    (v) => {
      const value = Number(v);
      return Number.isFinite(value) && value >= min && value <= max;
    },
    coded("ai-between", { key, min, max }),
  );

// 옛 필드. 남아 있으면 조용히 무시되므로 알린다
const gone = (message: string) => present(() => false, message);

const list = z
  .object(
    {
      lineFormat: z
        .string({ error: "ai-line-format-text" })
        .superRefine((f, ctx) => {
          for (const one of lineFormatProblems(f)) ctx.addIssue({ code: "custom", message: coded("ai-line-format", { at: one.at + 1 }, one.rule) });
        })
        .nullish(),
    },
    { error: "ai-list-shape" },
  )
  .nullish();

const aiFile = z.preprocess(
  plain,
  z
    .looseObject({
      provider: present((v) => typeof v === "string" && PROVIDERS.includes(v), coded("ai-provider", { providers: PROVIDERS.join(", ") })),
      // 켜고 끄기. 끄면(false) 선택한 프로바이더, 모델은 그대로 두고 부르지만 않는다. 없으면 provider로 판단한다(off면 꺼짐)
      enabled: present((v) => typeof v === "boolean", "ai-enabled"),
      // 온도도 모델이 받는 필드 하나라 params 아래에 모델별로 둔다
      temperature: gone("ai-temperature"),
      timeoutMs: between("timeoutMs", AI_TIMEOUT_RANGE.min, AI_TIMEOUT_RANGE.max),
      batchSize: between("batchSize", 1, 50),
      // 글자 "false"는 참으로 읽힌다. 참, 거짓으로만 받는다
      skipConfident: present((v) => typeof v === "boolean", "ai-skip-confident"),
      // 재시도. 빠진 필드의 기본값은 assist의 DEFAULTS
      retries: between("retries", 0, 10),
      totalTimeoutMs: present((v) => Number(v) === 0 || (Number(v) >= 1000 && Number(v) <= 3600000), "ai-total-timeout"),
      retryTimeouts: present((v) => typeof v === "boolean", "ai-retry-timeouts"),
      retryDelayMs: between("retryDelayMs", 0, 60000),
      retryDelayMaxMs: between("retryDelayMaxMs", 0, 600000),
      retryStatus: present((v) => Array.isArray(v) && v.every((one) => Number.isInteger(one) && one >= 400 && one <= 599), "ai-retry-status"),
      // 추가 파라미터는 한 줄에 하나씩 적는 문자열이다(rules/ai-extra). 파싱에 실패한 줄은 저장을 막지 않고 aiWarnings로 알린다
      // 비밀 헤더(Authorization 등)는 적지 못한다. 설정은 평문으로 남고 내보내기에도 실린다. 키는 키 입력란에(암호화해 둔다)
      extra: z
        .string({ error: "ai-extra-text" })
        .refine((v) => !setsSecretHeader(v), "ai-secret-header")
        .nullish(),
      prompt: gone("ai-prompt-field"),
      project: z.string({ error: "ai-project" }).nullish(),
      location: z
        .string({ error: "ai-location-text" })
        .refine((v) => !v.trim() || VERTEX_LOCATION.test(v.trim()), "ai-location")
        .nullish(),
      // 모델이 받는 필드의 값. 모델 이름으로 한 겹 나뉜다. 안 그러면 모델을 바꿨을 때
      // 앞 모델 값이 따라온다. 필드 이름이 맞는지는 모델 프로필이 판단한다(assist/index의 withParams).
      params: z
        .record(
          z.string(),
          present((v) => typeof v === "object" && !Array.isArray(v), "ai-params-model"),
          { error: "ai-params-shape" },
        )
        .nullish(),
      // 모델 목록에서 가릴 이름(글롭). 저쪽 목록에는 영상, 이미지 모델도 섞여 나온다.
      hideModels: present((v) => Array.isArray(v) && v.every((one) => typeof one === "string"), "ai-hide-models"),
      // 대시보드에서 어느 섹션인지 알아보려고 붙이는 이름. 프롬프트 섹션에는 이름 필드가 없어 여기 두므로 순서가 섹션과 같아야 한다
      promptNames: present((v) => Array.isArray(v) && v.every((one) => one == null || typeof one === "string"), "ai-prompt-names"),
      list,
    })
    // 켰는데 프로바이더가 없으면 알리고, 프로바이더를 골랐을 때만 주소, 모델을 따진다
    .superRefine((data, ctx) => {
      if (data.enabled === true && (!data.provider || data.provider === "off")) ctx.addIssue({ code: "custom", message: "ai-needs-provider" });
      if (!data.provider || data.provider === "off") return;
      // baseUrl은 custom일 때만 쓴다. 나머지는 프로바이더에 박힌 주소로 간다(assist/index)
      if (data.provider === "custom") {
        if (!String(data.baseUrl || "").trim()) ctx.addIssue({ code: "custom", message: "ai-needs-base-url" });
        else if (!/^https?:\/\//.test(String(data.baseUrl).trim())) ctx.addIssue({ code: "custom", message: "ai-base-url" });
      }
      if (!String(data.model || "").trim()) ctx.addIssue({ code: "custom", message: "ai-needs-model" });
    }, ALWAYS),
);

/** 꺼 두었는지(enabled: false). 꺼 두면 나머지 필드를 따지지 않는다(프롬프트는 형식만 본다: ai-prompt의 promptProblems(…, false)) */
const aiSwitchedOff = (data: unknown) => !!data && typeof data === "object" && (data as { enabled?: unknown }).enabled === false;

/** AI 설정의 문제 목록. 없으면 빈 배열. 꺼 두었어도 비밀 헤더는 막는다(설정은 평문으로 남고 내보내기에도 실린다). 위치 값은 params 아래의 모델(model) */
function aiProblems(data: unknown): RuleProblem[] {
  if (aiSwitchedOff(data)) {
    const extra = (data as { extra?: unknown }).extra;
    return typeof extra === "string" && setsSecretHeader(extra) ? [rule("ai-secret-header")] : [];
  }
  return problemsOf(aiFile, data, (path) => ({ model: path[0] === "params" && path[1] !== undefined ? String(path[1]) : undefined }));
}

/**
 * 막지 않는 경고: 추가 파라미터에서 파싱에 실패해 빠지는 줄. 저장과 켜기를 막지 않는다(그 줄만 빠지고 나머지 요청은 그대로 보낸다)
 */
const aiWarnings = (data: unknown): RuleProblem[] => (data && typeof data === "object" ? extraLineProblems((data as { extra?: unknown }).extra) : []);

export { aiProblems, aiWarnings, aiSwitchedOff, AI_KEY_ORDER, AI_TIMEOUT_RANGE, lineFormatProblems };
