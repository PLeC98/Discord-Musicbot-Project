// AI 보조 설정(ai.yaml)의 스키마. 프롬프트(ai-prompt.chatml)는 제 형식이 따로 있어 여기서 보지 않는다.

import aiProviders from "./aiProviders.ts";
const { PROVIDERS } = aiProviders;
import problems from "./problems.ts";
const { z, ALWAYS, present, plain, problemsOf } = problems;

const PROMPT_FILE = "ai-prompt.chatml";
const AI_UNKNOWN = ["hide", "text", "zero"];

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
      unknownDuration: present((v) => typeof v === "string" && AI_UNKNOWN.includes(v), `list.unknownDuration은 ${AI_UNKNOWN.join(" · ")} 중 하나여야 합니다.`),
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
      enabled: gone("enabled 는 provider 로 바뀌었습니다. off 또는 openai 를 적으세요."),
      // 온도도 모델이 받는 칸 하나다. params 아래로 옮겼다
      temperature: gone("temperature는 params 아래에 모델별로 적습니다."),
      timeoutMs: between("timeoutMs", 1000, 600000),
      batchSize: between("batchSize", 1, 50),
      // 추가 파라미터는 한 줄에 하나씩 적는 글이다(autoplayAssist.parseExtra)
      extra: z.string({ error: "extra는 한 줄에 하나씩 적는 글이어야 합니다." }).nullish(),
      prompt: gone(`프롬프트는 ${PROMPT_FILE} 에 적습니다. ai.yaml 의 prompt 는 쓰이지 않습니다.`),
      project: z.string({ error: "project는 글자로 적어야 합니다." }).nullish(),
      location: z.string({ error: "location는 글자로 적어야 합니다." }).nullish(),
      // 모델이 받는 칸의 값. 모델 이름으로 한 겹 나뉜다. 안 그러면 모델을 바꿨을 때
      // 앞 모델 값이 따라온다. 칸 이름이 맞는지는 모델 프로필이 판단한다(autoplayAssist.withParams).
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
      if (!data.provider || data.provider === "off") return;
      // baseUrl 은 custom 일 때만 쓴다. 나머지는 프로바이더에 박힌 주소로 간다(autoplayAssist)
      if (data.provider === "custom") {
        if (!String(data.baseUrl || "").trim()) ctx.addIssue({ code: "custom", message: "provider가 custom이면 baseUrl을 적어야 합니다." });
        else if (!/^https?:\/\//.test(String(data.baseUrl).trim())) ctx.addIssue({ code: "custom", message: "baseUrl은 http:// 또는 https:// 로 시작해야 합니다." });
      }
      if (!String(data.model || "").trim()) ctx.addIssue({ code: "custom", message: "model을 적어야 합니다." });
    }, ALWAYS),
);

/** AI 설정의 문제 목록. 없으면 빈 배열 */
function aiProblems(data: unknown): string[] {
  return problemsOf(aiFile, data, (path) => ({ model: path[0] === "params" ? path[1] : undefined }));
}

const exported = { aiProblems, PROMPT_FILE, AI_UNKNOWN };
export default exported;
export { exported as "module.exports" };
