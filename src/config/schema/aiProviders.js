"use strict";

// AI 설정(ai.yaml)의 제공자 규격. 설정 검증과 AI 보조와 대시보드가 같이 본다.

/**
 * 어디에 물을지. 모델 이름은 적지 않는다. 적어 두면 저쪽에서 새 모델이 나올 때마다 고쳐야 하므로,
 * 주소만 알고 있다가 목록을 그때그때 물어본다.
 *
 * 대부분 OpenAI 호환이라 코드가 하나다. 규격이 진짜로 다른 곳은 `dialect`로 갈래를 내고,
 * 차이는 DIALECTS 한 곳에만 둔다.
 */
const PROVIDER_SPECS = {
  off: { label: "사용하지 않음", group: "" },

  // ── 내 기기에서 도는 것 ── 키가 없다.
  ollama: { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", key: false, group: "로컬" },
  lmstudio: { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", key: false, group: "로컬" },
  vllm: { label: "vLLM", baseUrl: "http://127.0.0.1:8000/v1", key: false, group: "로컬" },
  llamacpp: { label: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1", key: false, group: "로컬" },

  // ── 모델을 직접 내는 곳 ──
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", key: true, group: "클라우드", registry: "openai" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", key: true, group: "클라우드", dialect: "anthropic", registry: "anthropic" },
  aistudio: { label: "Google AI Studio", baseUrl: "https://generativelanguage.googleapis.com/v1beta", key: true, group: "클라우드", dialect: "gemini", registry: "google" },
  xai: { label: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", key: true, group: "클라우드" },
  "ollama-cloud": { label: "Ollama Cloud", baseUrl: "https://ollama.com/v1", key: true, group: "클라우드", registry: "ollama-cloud" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", key: true, group: "클라우드", registry: "deepseek" },
  mistral: { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", key: true, group: "클라우드" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", key: true, group: "클라우드" },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", key: true, group: "클라우드" },

  // 구글 클라우드. 키가 아니라 서비스 계정 JSON 을 쓰고, 주소는 프로젝트·리전으로 조립한다.
  vertex: { label: "Vertex AI (Gemini 네이티브)", key: true, group: "클라우드", dialect: "vertex", serviceAccount: true, needsProject: true, registry: "vertex-gemini-native" },

  // ── 여러 곳을 묶어 파는 곳 ──
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", key: true, group: "게이트웨이", registry: "openrouter" },
  nanogpt: { label: "NanoGPT", baseUrl: "https://nano-gpt.com/api/v1", key: true, group: "게이트웨이", registry: "nanogpt" },
  vercel: { label: "Vercel AI Gateway", baseUrl: "https://ai-gateway.vercel.sh/v1", key: true, group: "게이트웨이", registry: "vercel" },
  llmgateway: { label: "LLM Gateway", baseUrl: "https://api.llmgateway.io/v1", key: true, group: "게이트웨이", registry: "llmgateway" },
  neuralwatt: { label: "Neuralwatt", baseUrl: "https://api.neuralwatt.com/v1", key: true, group: "게이트웨이", registry: "neuralwatt" },

  // 주소를 직접 적는 유일한 자리. 여기 없는 곳도, 위의 주소가 바뀌었을 때도 이것으로 간다.
  custom: { label: "OpenAI 호환 (직접 입력)", baseUrl: "", key: true, editable: true, group: "직접" },
};

const PROVIDERS = Object.keys(PROVIDER_SPECS);

module.exports = { PROVIDER_SPECS, PROVIDERS };
