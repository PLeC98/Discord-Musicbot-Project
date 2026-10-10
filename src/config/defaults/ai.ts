// AI 보조 기본값(꺼짐). settings.db 에 "ai" 문서가 없을 때 이것으로 시작한다(config/documents). 검사는 config/schema/ai

const aiDefault: Record<string, unknown> = {
  enabled: false,
  provider: "off",
  baseUrl: "",
  location: "",
  project: "",
  timeoutMs: 60000,
  retries: 2,
  totalTimeoutMs: 0,
  retryTimeouts: false,
  retryDelayMs: 1000,
  retryDelayMaxMs: 16000,
  retryStatus: [408, 409, 429, 500, 502, 503, 504, 529],
  batchSize: 10,
  skipConfident: true,
  list: {
    lineFormat: "{{번호}}. 장르={{장르}} 길이={{길이분}}분 제목={{제목}}",
    unknownDuration: "hide",
    unknownText: "모름",
  },
  model: "gemma3n:e2b",
  params: {},
  extra: "",
  hideModels: ["*aqa*", "babbage-002", "davinci-002", "*o1*", "*o3*", "*o4*", "gpt-3.5*", "*gpt-4*", "*omni-moderation*", "*gemini-1.5*", "*gemini-2.5*", "*sora*", "*veo*", "*dall-e*", "*whisper*", "*embedding*", "*image*", "*banana*", "*audio*", "*lyria*", "*transcribe*", "*robotics*", "*translate*", "*deep-research*", "*gpt-live*", "*tts*", "*gpt-realtime*", "*antigravity*", "*computer-use*", "*search-api*", "*customtools*", "spicy-mayo", "*gemini-omni*"],
  promptNames: [],
};

export default aiDefault;
