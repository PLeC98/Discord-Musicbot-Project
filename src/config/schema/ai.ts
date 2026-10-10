// AI 보조 설정(settings.db 의 "ai" 문서)의 스키마. 프롬프트("ai-prompt" 문서)는 제 형식이 따로 있어 여기서 보지 않는다(schema/ai-prompt).

import { PROVIDERS } from "./ai-providers.ts";
import { VERTEX_LOCATION } from "../../rules/vertex-url.ts";
import { setsSecretHeader } from "../../rules/secret-headers.ts";
import { z, ALWAYS, present, plain, problemsOf } from "./problems.ts";

// 길이를 모르는 후보를 목록 줄에 어떻게 적나: 그 칸을 뺀다 · 글자로 · 0 으로
const AI_UNKNOWN = ["hide", "text", "zero"] as const;
type AiUnknown = (typeof AI_UNKNOWN)[number];
const isAiUnknown = (v: unknown): v is AiUnknown => AI_UNKNOWN.some((one) => one === v);

// AI 설정의 키 차례(기본 설정 문서와 같다). 저장은 받은 차례대로 두므로 대시보드가 이 차례로 보낸다(내보내기 글이 읽기 좋게)
const AI_KEY_ORDER = ["enabled", "provider", "baseUrl", "location", "project", "timeoutMs", "retries", "totalTimeoutMs", "retryTimeouts", "retryDelayMs", "retryDelayMaxMs", "retryStatus", "batchSize", "skipConfident", "list", "model", "params", "extra", "hideModels", "promptNames"] as const;

// 모델이 받는 수치 칸. 범위를 벗어나거나 수가 아니면 같은 문구
const between = (key: string, min: number, max: number) =>
  present((v) => {
    const value = Number(v);
    return Number.isFinite(value) && value >= min && value <= max;
  }, `${key}는 ${min}~${max} 사이여야 합니다.`);

// 옛 칸. 남아 있으면 조용히 무시되므로 알린다
const gone = (message: string) => present(() => false, message);

const list = z
  .object(
    {
      lineFormat: z
        .string({ error: "list.lineFormat은 글로 적어야 합니다." })
        // 제목이 없으면 판정할 거리가 없다
        .refine((f) => !f.trim() || /\{\{\s*제목\s*\}\}/.test(f), { error: "list.lineFormat에 {{제목}} 이 있어야 합니다." })
        .nullish(),
      unknownDuration: present((v) => isAiUnknown(v), `list.unknownDuration은 ${AI_UNKNOWN.join(" · ")} 중 하나여야 합니다.`),
      unknownText: z.string({ error: "list.unknownText는 글로 적어야 합니다." }).nullish(),
    },
    { error: "list는 이름:값 꼴이어야 합니다." },
  )
  .nullish();

const aiFile = z.preprocess(
  plain,
  z
    .looseObject({
      provider: present((v) => typeof v === "string" && PROVIDERS.includes(v), `provider는 ${PROVIDERS.join(" · ")} 중 하나여야 합니다.`),
      // 켜고 끄기. 끄면(false) 고른 프로바이더 · 모델은 그대로 두고 부르지만 않는다. 없으면 provider 로 판단한다(off 면 꺼짐)
      enabled: present((v) => typeof v === "boolean", "enabled는 true 또는 false여야 합니다."),
      // 온도도 모델이 받는 칸 하나다. params 아래로 옮겼다
      temperature: gone("temperature는 params 아래에 모델별로 적습니다."),
      timeoutMs: between("timeoutMs", 1000, 600000),
      batchSize: between("batchSize", 1, 50),
      // 글자 "false" 는 참으로 읽힌다. 참 · 거짓으로만 받는다
      skipConfident: present((v) => typeof v === "boolean", "skipConfident는 true 또는 false여야 합니다."),
      // 재시도. 빠진 칸의 기본값은 assist 의 DEFAULTS
      retries: between("retries", 0, 10),
      totalTimeoutMs: present((v) => Number(v) === 0 || (Number(v) >= 1000 && Number(v) <= 3600000), "totalTimeoutMs는 0(상한 없음) 또는 1000~3600000 사이여야 합니다."),
      retryTimeouts: present((v) => typeof v === "boolean", "retryTimeouts는 true 또는 false여야 합니다."),
      retryDelayMs: between("retryDelayMs", 0, 60000),
      retryDelayMaxMs: between("retryDelayMaxMs", 0, 600000),
      retryStatus: present((v) => Array.isArray(v) && v.every((one) => Number.isInteger(one) && one >= 400 && one <= 599), "retryStatus는 400~599 사이 상태 코드 목록이어야 합니다(예: [429, 503])."),
      // 추가 파라미터는 한 줄에 하나씩 적는 글이다(assist/index 의 parseExtra)
      // 비밀 헤더(Authorization 등)는 적지 못한다. 설정은 평문으로 남고 내보내기에도 실린다. 키는 키 칸에(암호화해 둔다)
      extra: z
        .string({ error: "extra는 한 줄에 하나씩 적는 글이어야 합니다." })
        .refine((v) => !setsSecretHeader(v), "extra 에 비밀 헤더(Authorization · x-api-key · Cookie 등)는 적을 수 없습니다. 키는 API 키 칸에 넣으세요(암호화해 둡니다).")
        .nullish(),
      prompt: gone("프롬프트는 AI 보조 탭의 프롬프트에 적습니다. AI 설정의 prompt 칸은 쓰이지 않습니다."),
      project: z.string({ error: "project는 글자로 적어야 합니다." }).nullish(),
      location: z
        .string({ error: "location는 글자로 적어야 합니다." })
        .refine((v) => !v.trim() || VERTEX_LOCATION.test(v.trim()), "location은 버텍스 리전 이름이어야 합니다(영문 소문자 · 숫자 · -, 예: us-central1 · global).")
        .nullish(),
      // 모델이 받는 칸의 값. 모델 이름으로 한 겹 나뉜다. 안 그러면 모델을 바꿨을 때
      // 앞 모델 값이 따라온다. 칸 이름이 맞는지는 모델 프로필이 판단한다(assist/index 의 withParams).
      params: z
        .record(
          z.string(),
          present((v) => typeof v === "object" && !Array.isArray(v), "params.{model} 은 칸 이름과 값을 적는 표여야 합니다(모델 이름으로 한 겹 나눕니다)."),
          { error: "params는 모델 이름 아래에 칸을 적는 표여야 합니다." },
        )
        .nullish(),
      // 모델 목록에서 가릴 이름(글롭). 저쪽 목록에는 영상·이미지 모델도 섞여 나온다.
      hideModels: present((v) => Array.isArray(v) && v.every((one) => typeof one === "string"), 'hideModels는 글자 목록이어야 합니다(예: ["*sora*", "gpt-3.5*"]).'),
      // 섹션 이름은 대시보드에서 어느 섹션인지 알아보려고 붙이는 것이다.
      // ChatML 에는 이름을 적을 자리가 없어서 여기 둔다. 차례가 프롬프트 섹션과 같아야 한다.
      promptNames: present((v) => Array.isArray(v) && v.every((one) => one == null || typeof one === "string"), "promptNames는 글자 목록이어야 합니다."),
      list,
    })
    // 켤 때만 나머지를 따진다. 꺼 둔 설정이 반쯤 비어 있다고 나무랄 이유가 없다.
    .superRefine((data, ctx) => {
      if (data.enabled === true && (!data.provider || data.provider === "off")) ctx.addIssue({ code: "custom", message: "켜려면 provider를 골라야 합니다." });
      if (!data.provider || data.provider === "off") return;
      // baseUrl 은 custom 일 때만 쓴다. 나머지는 프로바이더에 박힌 주소로 간다(assist/index)
      if (data.provider === "custom") {
        if (!String(data.baseUrl || "").trim()) ctx.addIssue({ code: "custom", message: "provider가 custom이면 baseUrl을 적어야 합니다." });
        else if (!/^https?:\/\//.test(String(data.baseUrl).trim())) ctx.addIssue({ code: "custom", message: "baseUrl은 http:// 또는 https:// 로 시작해야 합니다." });
      }
      if (!String(data.model || "").trim()) ctx.addIssue({ code: "custom", message: "model을 적어야 합니다." });
    }, ALWAYS),
);

/** 꺼 두었는지(enabled: false). 꺼 두면 나머지 칸을 따지지 않는다(프롬프트는 파일이 깨지지 않을 만큼만 본다: ai-prompt 의 promptProblems(…, false)) */
const aiSwitchedOff = (data: unknown) => !!data && typeof data === "object" && (data as { enabled?: unknown }).enabled === false;

/** AI 설정의 문제 목록. 없으면 빈 배열 */
function aiProblems(data: unknown): string[] {
  if (aiSwitchedOff(data)) return [];
  return problemsOf(aiFile, data, (path) => ({ model: path[0] === "params" ? path[1] : undefined }));
}

export { aiProblems, aiSwitchedOff, AI_UNKNOWN, AI_KEY_ORDER, isAiUnknown };
export type { AiUnknown };
