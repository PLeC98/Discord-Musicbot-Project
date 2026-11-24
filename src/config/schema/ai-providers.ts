// AI 설정의 제공자 규격. 설정 검증과 AI 보조와 대시보드가 같이 본다.

/**
 * 어디에 물을지. 모델 이름은 적지 않는다. 적어 두면 저쪽에서 새 모델이 나올 때마다 고쳐야 하므로,
 * 주소만 알고 있다가 목록을 그때그때 물어본다.
 *
 * 대부분 OpenAI 호환이라 코드가 하나다. 규격이 진짜로 다른 곳은 `dialect`로 분기하고,
 * 차이는 DIALECTS 한 곳에만 둔다.
 *
 *   label          상표 이름(화면은 이름을 따로 두는 것만 그 언어의 이름으로 바꿔 보여 준다)
 *   group          묶음: local(내 기기), cloud(모델을 직접 내는 곳), gateway(여러 곳을 묶어 파는 곳), direct(주소를 직접 적는 곳). 없으면 맨 위
 *   key            키를 받는가(로컬은 안 받는다)
 *   editable       주소를 설정에 적는다(custom)
 *   dialect        OpenAI 호환이 아닌 규격
 *   registry       모델 레지스트리의 이름
 *   prices         값표(models.dev)의 프로바이더 이름. 없으면 값을 모른다(키가 없는 로컬은 0)
 *   serviceAccount 키 대신 서비스 계정 JSON(needsProject: 프로젝트도 적는다)
 *   headers        그곳이 더 바라는 헤더(OpenAI 호환 분기)
 */
type ProviderSpec = { label: string; group: ProviderGroup | ""; baseUrl?: string; key?: boolean; editable?: boolean; dialect?: string; registry?: string; prices?: string; serviceAccount?: boolean; needsProject?: boolean; headers?: Record<string, string> };

type ProviderGroup = "local" | "cloud" | "gateway" | "direct";

const PROVIDER_SPECS: Record<string, ProviderSpec> = {
  off: { label: "Off", group: "" },

  // ── 내 기기에서 도는 것 ── 키가 없다.
  ollama: { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", key: false, group: "local" },
  lmstudio: { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", key: false, group: "local" },
  vllm: { label: "vLLM", baseUrl: "http://127.0.0.1:8000/v1", key: false, group: "local" },
  llamacpp: { label: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1", key: false, group: "local" },

  // ── 모델을 직접 내는 곳 ──
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", key: true, group: "cloud", registry: "openai", prices: "openai" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", key: true, group: "cloud", dialect: "anthropic", registry: "anthropic", prices: "anthropic" },
  aistudio: { label: "Google AI Studio", baseUrl: "https://generativelanguage.googleapis.com/v1beta", key: true, group: "cloud", dialect: "gemini", registry: "google", prices: "google" },
  xai: { label: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", key: true, group: "cloud", prices: "xai" },
  "ollama-cloud": { label: "Ollama Cloud", baseUrl: "https://ollama.com/v1", key: true, group: "cloud", registry: "ollama-cloud", prices: "ollama-cloud" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", key: true, group: "cloud", registry: "deepseek", prices: "deepseek" },
  mistral: { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", key: true, group: "cloud", prices: "mistral" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", key: true, group: "cloud", prices: "groq" },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", key: true, group: "cloud", prices: "togetherai" },

  // 구글 클라우드. 키가 아니라 서비스 계정 JSON을 쓰고, 주소는 프로젝트, 리전으로 조립한다.
  vertex: { label: "Vertex AI (Gemini native)", key: true, group: "cloud", dialect: "vertex", serviceAccount: true, needsProject: true, registry: "vertex-gemini-native", prices: "google-vertex" },

  // ── 여러 곳을 묶어 파는 곳 ──
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", key: true, group: "gateway", registry: "openrouter", prices: "openrouter" },
  nanogpt: { label: "NanoGPT", baseUrl: "https://nano-gpt.com/api/v1", key: true, group: "gateway", registry: "nanogpt", prices: "nano-gpt" },
  vercel: { label: "Vercel AI Gateway", baseUrl: "https://ai-gateway.vercel.sh/v1", key: true, group: "gateway", registry: "vercel", prices: "vercel" },
  llmgateway: { label: "LLM Gateway", baseUrl: "https://api.llmgateway.io/v1", key: true, group: "gateway", registry: "llmgateway", prices: "llmgateway" },
  neuralwatt: { label: "Neuralwatt", baseUrl: "https://api.neuralwatt.com/v1", key: true, group: "gateway", registry: "neuralwatt", prices: "neuralwatt" },

  // 주소를 직접 적는 유일한 곳. 여기 없는 곳도, 위의 주소가 바뀌었을 때도 이것으로 간다.
  custom: { label: "OpenAI compatible (custom)", baseUrl: "", key: true, editable: true, group: "direct" },
};

const PROVIDERS = Object.keys(PROVIDER_SPECS);

export { PROVIDER_SPECS, PROVIDERS };
export type { ProviderSpec, ProviderGroup };
