// 운영자 패널: AI 보조 탭(모델 · 파라미터 · 연결 테스트 · 프롬프트 · 판정 테스트 · 고급 설정)

import { formatNumber } from "../../utils/locale.ts";

// 목록
const title = "AI 보조";
const enable = "AI 보조 켜기";
const desc = "자동재생 후보를 LLM을 사용해 재검증해요.";
const descTip = "유튜브 검색으로 선택한 후보만 물어요(키워드 검색 · 곡 이름으로 찾기).\n유튜브 주소를 직접 주는 출처(유튜브 재생목록 · VocaDB 등)는 묻지 않아요.\n모델을 호출하지 못하면 규칙으로 선택하니 재생은 멈추지 않아요.";
/** 후보 목록 표시(mark)가 어느 섹션에도 없을 때 */
const listMarkMissing = (mark: string) => `어느 섹션에도 ${mark} 이 없어요`;

// 모델 카드
const model = {
  title: "모델",
  provider: "프로바이더",
  endpoint: "엔드포인트 주소",
  region: "리전",
  regionTip: "global 도 돼요. 공개된 값이라 주소에 그대로 보여요",
  project: "프로젝트 ID",
  projectTip: "위 주소에서는 가려 둬요",
  projectPlaceholder: "비우면 서비스 계정 JSON 의 project_id",
  serviceAccount: "서비스 계정 JSON",
  apiKey: "API 키",
  savedAccount: "저장된 JSON 있음",
  savedKey: "저장된 API 키 있음",
  noAccount: "저장된 JSON 없음",
  noKey: "저장된 API 키 없음",
  save: "저장",
  saving: "저장 중…",
  clearKey: "저장된 키 지우기",
  clearValue: "저장된 값 지우기",
  accountShape: "client_email 과 private_key 가 있는 JSON 이어야 해요.",
  accountHint: "발급받은 JSON 을 그대로 붙여넣어요. 프로젝트를 비우면 그 안의 project_id 를 써요.",
  keyHint: "저장된 값은 보안을 위해 다시 보여 주지 않아요. 저장하거나 지우려면 로그인한 지 10분 안이어야 해요.",
  keyMoved: "키를 저장한 뒤 주소가 바뀌어 지금 주소로는 키를 보내지 않아요. 이 주소로 쓰려면 키를 다시 저장해 주세요.",
  keyMovedRegion: "JSON 을 저장한 뒤 리전이 바뀌어 지금 리전으로는 보내지 않아요. 이 리전으로 쓰려면 다시 저장해 주세요.",
  keyAgain: "저장된 키를 복호화할 수 없어요(암호화 키 SECRETS_KEY 가 바뀌었거나 값이 손상됐어요). 다시 저장해 주세요.",
  insecure: "지금 평문(HTTP)으로 접속 중이에요. 키가 암호화되지 않은 채 네트워크로 전송돼요.",
  staleUrl: "주소를 고쳤지만 아직 저장하지 않았어요. 저장 전에는 키 없이 보내요.",
  model: "모델",
  modelPlaceholder: "모델 이름",
  refreshList: "모델 목록 새로고침",
  manualTip: "목록을 불러오지 못했으면 직접 입력해야 해요",
  manual: "직접 입력",
  hide: "목록에서 모델 숨기기",
  /** 숨기기 설명: 앞 · 와일드카드 기호 · 뒤 */
  hideHelpBefore: "불러온 목록에서 제외해요. ",
  hideHelpAfter: " 만 와일드카드로 쓰고 대소문자는 구분하지 않아요. 영상 · 이미지 모델이나 구형 모델을 빼는 데 써요.",
  hidePlaceholder: "*sora* 처럼 입력하고 Enter",
};

// 파라미터 카드
const params = {
  title: "파라미터 설정",
  refresh: "모델 정보 갱신",
  refreshTip: "모델 정보를 다시 불러와요",
  advanced: "고급 파라미터 설정",
  default: "기본값",
  defaultWith: (value: unknown) => `기본값 (${String(value)})`,
  listPlaceholder: "입력하고 Enter",
  badJson: "올바른 JSON 이 아니에요",
  extra: "추가 파라미터",
  /** 추가 파라미터 설명의 앞(뒤에 줄 꼴 예시가 붙는다) */
  extraHelp: "한 줄에 하나씩. ",
};

// 연결 테스트
const test = {
  title: "연결 테스트",
  desc: "무료 테스트는 설정한 키와 주소로 모델 목록 및 토큰 수 확인만 요청하고, 유료 테스트는 짧은 질문을 실제로 전송해요.",
  free: "무료 테스트",
  freeRunning: "확인 중…",
  paid: "유료 테스트",
  paidRunning: "보내는 중…",
  notSent: "보내지 못함",
  rawShow: "원문 보기",
  rawHide: "원문 접기",
};

// 후보 목록 카드
const list = {
  title: "후보 목록",
  batch: "요청 하나에 보낼 곡 수",
  batchTip: "요청을 잘게 쪼개면 느려요.",
  skipConfident: "확신할 땐 묻지 않기",
  skipConfidentTip: "채널명, 길이가 일치하면 묻지 않아요.",
  lineFormat: "줄 형식",
  /** 줄 형식 설명: 앞 · 목록 자리 표시 · 뒤 */
  lineFormatBefore: "후보 하나를 한 줄로 적는 형식이에요. 이렇게 만든 목록이 프롬프트의 ",
  lineFormatAfter: " 위치에 들어가요. 업로더 이름은 넣을 수 없어요(Vevo · Radio Mix 같은 이름 때문에 정답률이 떨어졌어요).",
  help: "줄 형식 문법 보기",
  helpTitle: "줄 형식 문법",
  /** 문법 표: 적는 법 · 뜻 */
  syntax: [
    { code: "{{index}}", text: "후보 번호(1부터). 모델이 답할 때 이 번호(n)로 가리켜요" },
    { code: "{{genre}}", text: "자동재생 장르의 식별자(예: rock). 프롬프트 섹션에서도 써요" },
    { code: "{{title}}", text: "영상 제목. 필수예요(판정 대상이에요)" },
    { code: "{{duration}}", text: "길이. 형식 없이 쓰면 3:05. 모르면 빈 값이에요" },
    { code: "{{duration::형식}}", text: "길이를 형식대로. h 시간 · m 전체 분 · mm 남은 분 두 자리 · s 전체 초 · ss 남은 초 두 자리, 그 밖의 글자는 그대로. 예: {{duration::m분 ss초}} → 3분 05초" },
    { code: "{{#if-exist 값}} … {{:else}} … {{/}}", text: "값이 비어 있지 않으면 앞, 비면 {{:else}} 뒤({{:else}} 가 없으면 아무것도 적지 않아요). 닫기는 {{/if-exist}} 도 돼요. 길이를 모르는 후보를 빼거나 unknown 을 적을 때 써요" },
  ],
  syntaxExample: "{{index}}. genre={{genre}} {{#if-exist {{duration}}}}length={{duration::m}}min {{:else}}length=unknown {{/}}title={{title}}",
  syntaxExampleLabel: "예",
  blockChip: "{{#if-exist …}}",
  blockChipTip: "길이가 있을 때만 적는 구간을 끝에 붙여요",
  previewTitle: "미리보기",
  previewKnown: "길이를 아는 후보",
  previewUnknown: "길이를 모르는 후보",
  /** 문제 자리: 몇 번째 글자 */
  problemAt: (n: number) => `${n}번째 글자`,
};

// 판정 프롬프트 카드
const prompt = {
  title: "판정 프롬프트",
  tokens: (count: number) => `${formatNumber(count)} 토큰`,
  estimated: "추정치",
  tokensFailed: "토큰 수를 세지 못함",
  addSection: "섹션 추가",
  /** 설명: 앞 · 답 꼴 예시 · 뒤 */
  descBefore: "섹션마다 역할을 정해 적은 순서대로 보내요. 답은 반드시 ",
  descAfter: " 형식의 JSON 배열이어야 해요.",
  emptyUsesDefault: "비어 있어 기본 프롬프트를 써요.",
  listMarkMissing: (mark: string) => `어느 섹션에도 ${mark} 이 없어요.`,
  dragToReorder: "드래그해서 순서 바꾸기",
  sectionName: (n: number) => `섹션 ${n}`,
  sectionNameTip: "표시용 이름이라 요청에는 쓰이지 않아요.",
  role: "역할",
  removeSection: "이 섹션 삭제",
  defaults: "기본값",
  preview: "리퀘스트 미리보기",
};

// 판정 테스트 카드
const judge = {
  title: "판정 테스트",
  urls: "유튜브 주소",
  urlsPlaceholder: "https://www.youtube.com/watch?v=... (한 줄에 하나)",
  genre: "장르 식별자",
  genrePlaceholder: "rock",
  lookup: "링크 조회",
  looking: "조회 중…",
  send: "요청 전송",
  sending: "보내는 중…",
  stale: "작성한 주소를 아직 조회하지 않았어요. 이대로 전송하면 내장된 예시 곡을 사용해요.",
  listTitle: "모델에 보낼 목록",
  copyList: "목록 복사",
  copy: "복사",
  rawShow: "요청 기록 보기",
  rawHide: "요청 기록 접기",
};

// 리퀘스트 로그 · 사용량 통계가 같이 쓰는 이름
/** 요청을 보낸 곳(contract/ai-log 의 AI_LOG_SOURCES) */
const sources = { autoplay: "자동재생 판정", "judge-test": "판정 테스트", ping: "연결 확인", models: "모델 목록" } as const;

// 리퀘스트 로그
const log = {
  title: "리퀘스트 로그",
  desc: "AI 보조가 모델에게 보낸 요청의 본문 · 응답 · 걸린 시간을 기록해요.",
  filters: "필터",
  filterActive: (n: number) => (n ? `${n}개 적용됨` : ""),
  filterClear: "필터 초기화",
  source: "출처",
  result: "결과",
  ok: "성공",
  failed: "실패",
  sources,
  search: "URL · 모델 · 오류로 검색",
  refresh: "새로고침",
  clear: "전체 삭제",
  clearTitle: "리퀘스트 로그를 모두 지울까요?",
  clearBody: "사용량 통계는 남아요. 지운 로그는 되돌릴 수 없어요.",
  clearConfirm: "지우기",
  cleared: "리퀘스트 로그를 지웠어요",
  clearFailed: "리퀘스트 로그를 지우지 못했어요",
  count: (shown: number, total: number) => (shown === total ? `${total}건` : `${shown} / ${total}건`),
  storage: (used: string, max: string) => `저장 용량 ${used} / ${max}`,
  off: "기록이 꺼져 있어요. 새 요청은 기록하지 않아요(아래 기록 설정).",
  empty: "기록이 없어요",
  emptyDesc: "AI 보조가 요청을 보내면 여기에 남아요.",
  emptyFiltered: "필터에 맞는 기록이 없어요.",
  loadMore: "더 불러오기",
  loading: "불러오는 중…",
  loadFailed: "리퀘스트 로그를 불러오지 못했어요",
  detailFailed: "이 기록을 불러오지 못했어요",
  newCount: (n: number) => `새 기록 ${n}건`,
  live: "실시간",
  liveOff: "실시간 연결 끊김",
  /** 상태 칸: 닿기 전에 막힌 요청 */
  timeout: "시간 초과",
  unreached: "연결 실패",
  took: "소요 시간",
  first: "첫 응답",
  tokens: "토큰",
  tokenPair: (input: string, output: string) => `${input} → ${output}`,
  tokenTip: (cached: string, reasoning: string) => `입력 토큰 중 캐시 ${cached} · 출력 토큰 중 추론 ${reasoning}`,
  cost: "비용",
  costUnknown: "가격 정보 없음",
  provider: "프로바이더",
  attempt: "시도",
  attemptNth: (n: number) => `${n}번째`,
  retry: (n: number) => `재시도 ${n - 1}`,
  guild: "서버",
  genre: "장르",
  candidates: (n: number) => `후보 ${n}곡`,
  truncated: "일부 생략됨",
  url: "URL",
  headers: "요청 헤더",
  body: "요청 본문",
  response: "응답",
  error: "오류",
  copy: "복사",
  copied: "복사했어요",
};

// 사용량 통계
const usage = {
  title: "사용량 통계",
  desc: "AI 보조 요청의 토큰 · 비용 통계예요. 비용은 models.dev 의 데이터로 추정한 수치예요.",
  periods: { 7: "7일", 30: "30일", 90: "90일", 0: "전체" } as Record<number, string>,
  sources,
  refresh: "새로고침",
  clear: "통계 삭제",
  clearTitle: "사용량 통계를 모두 지울까요?",
  clearBody: "리퀘스트 로그는 남아요. 지운 통계는 되돌릴 수 없어요.",
  clearConfirm: "지우기",
  cleared: "사용량 통계를 지웠어요",
  clearFailed: "사용량 통계를 지우지 못했어요",
  loadFailed: "사용량 통계를 불러오지 못했어요",
  empty: "이 기간에는 요청이 없어요",
  cards: {
    requests: "요청",
    failed: (n: string) => `실패 ${n}`,
    input: "입력 토큰",
    cached: (n: string) => `캐시 ${n}`,
    output: "출력 토큰",
    reasoning: (n: string) => `추론 ${n}`,
    cost: "비용(추정)",
    unpriced: (n: string) => `가격 정보 없음 ${n}건`,
    latency: "평균 응답",
    p95: (ms: string) => `p95 ${ms}`,
  },
  chart: {
    title: "날짜별",
    metrics: { tokens: "토큰", requests: "요청", cost: "비용" },
    series: { input: "입력", cached: "캐시", output: "출력", ok: "성공", failed: "실패", cost: "비용" },
    /** 막대 하나가 여러 날을 묶었을 때(기간이 길 때) */
    range: (from: string, to: string) => `${from} ~ ${to}`,
    peak: (value: string) => `최대 ${value}`,
  },
  tables: {
    byModel: "모델별",
    bySource: "출처별",
    byGuild: "서버별",
    model: "모델",
    source: "출처",
    guild: "서버",
    requests: "요청",
    input: "입력 토큰",
    output: "출력 토큰",
    cached: "캐시 토큰",
    cost: "비용",
    avg: "평균 응답",
    noGuild: "이 기간에 판정한 서버가 없어요",
    unknown: "가격 정보 없음",
  },
};

// 고급 설정 카드
const advanced = {
  title: "요청 · 재시도",
  desc: "실패하면 설정한 대로 재요청하고, 최종 실패 시에는 규칙만 사용해요. 입력란을 비우면 기본값을 사용해요.",
  timeout: "타임아웃(초)",
  timeoutTip: "요청마다 응답을 기다릴 시간",
  retries: "실패 시 재요청 횟수",
  retriesTip: "실패 시 재요청할 최대 횟수\n(0이면 재요청하지 않음)",
  total: "판정 전체 상한(초)",
  totalTip: "재시도 · 대기를 포함한 판정 한 건의 시간 상한\n(0이면 상한 없음)",
  delay: "재시도 대기 시간(초)",
  delayTip: "실패 시 첫 대기 시간\n(재시도마다 두 배로 늘어남)",
  delayMax: "최대 대기 시간(초)",
  delayMaxTip: "재요청 대기 시간의 상한\n(서버의 대기 요구에도 적용 · Gemini API 는 30~60초를 요구하는 경우가 있음)",
  retryTimeouts: "타임아웃 시 재요청",
  retryStatus: "재요청할 응답 코드",
  retryStatusTip: "연결 실패는 입력하지 않아도 재요청해요.\n400, 401, 403, 404 는 재요청으로 해결할 수 없으니 넣지 마세요.",
};

// 유료 확인 대화상자
const paid = {
  title: "실제로 보낼까요?",
  body: "토큰 비용이 발생해요.",
  to: "엔드포인트",
  model: "모델",
  what: "보낼 것",
  checking: "확인하는 중…",
  emptyModel: "(비어 있음)",
  /** 판정 테스트로 보낼 것: 섹션 수(비었으면 기본) · 고른 곡 수(없으면 보기 곡 셋) */
  judgeWhat: (sections: number, picked: number) => `판정 프롬프트 전체 (${sections ? `섹션 ${sections}개` : "기본 섹션"} · ${picked ? `선택한 곡 ${picked}개` : "예시 곡 3개"})`,
  cancel: "취소",
  send: "보내기",
};

// 요청 미리보기 대화상자
const preview = {
  title: "리퀘스트 미리보기",
  notSent: "보내지 않았어요",
  rawShow: "원본 보기 (주소 · 헤더 · 본문)",
  rawHide: "원본 접기",
};

// 묶음(목록 줄)
const items = { model: "모델", prompt: "프롬프트", advanced: "고급 설정", log: "리퀘스트 로그", usage: "사용량 통계" };
/** 프로바이더를 고르지 않은 값 */
const providerOff = "사용하지 않음";
/** 버텍스 주소를 보일 때 아직 모르는 칸 */
const endpointProject = "[프로젝트 ID]";
const endpointModel = "{모델}";
/** 키 입력칸 자리 글 */
const keyPlaceholder = { accountSaved: "저장돼 있어요. 바꾸려면 새 JSON 을 붙여넣으세요", keySaved: "저장돼 있어요. 새로 저장하면 교체돼요.", empty: "키를 입력하세요" };
const keySaved = "키를 저장했어요";
const keyCleared = "키를 지웠어요";
const keySaveFailed = "키를 저장하지 못했어요.";
const keyClearFailed = "키를 지우지 못했어요.";
/** 줄 형식 자리표시자 설명(이름은 봇의 rules/line-format) */
const markHints: Record<string, string> = { index: "1부터", genre: "자동재생 장르의 식별자(예: rock). 라벨이 아니라 식별자가 들어가요", title: "영상 제목 (필수)", duration: "길이. 형식 없이 쓰면 3:05, {{duration::m}} 처럼 형식을 지정할 수 있어요. 모르면 빈 값이에요" };
const modelsRefreshed = "모델 정보를 갱신했어요";
const modelCount = (count: number) => `모델 ${count}개`;
const modelsCurrent = "모델 정보가 이미 최신이에요";
const modelsRefreshFailed = "모델 정보를 불러오지 못했어요.";
/** 파라미터 칸의 범위 안내 */
const atLeast = (value: number) => `${value} 이상`;
const atMost = (value: number) => `${value} 이하`;
const contextTokens = (count: string) => `컨텍스트 ${count}토큰`;
const outputTokens = (count: string) => `최대 출력 ${count}토큰`;
const savedNote = "다음 자동재생부터 반영돼요";
/** 요청 기록 · 미리보기 상자 이름 */
const boxes = { headers: "요청 헤더", body: "요청 본문", response: "응답", empty: "(비어 있음)" };
const verdicts = { pass: "통과", notSong: "곡 아님", wrongGenre: "장르 다름" };
const hiddenCount = (count: number) => `, ${count}개 숨김`;
/** 저쪽에 묻지 못해 받아 둔 목록으로 채웠다 */
const presetModels = (count: number) => `미리 저장된 목록의 모델 ${count}개를 표시해요`;
const failed = {
  tokens: "토큰을 세지 못했어요.",
  lookup: "조회하지 못했어요.",
  list: "프롬프트에 들어갈 목록을 만들지 못했어요.",
  judge: "판정 결과를 받지 못했어요.",
  fields: "모델의 파라미터 정보를 불러오지 못했어요.",
  state: "키 저장 여부와 기본 프롬프트를 불러오지 못했어요.",
  preview: "미리보기를 만들지 못했어요.",
  models: "불러오지 못했어요.",
  endpoint: "엔드포인트를 확인하지 못했어요.",
  send: "보내지 못했어요.",
};

export { title, enable, desc, descTip, listMarkMissing, model, params, test, list, prompt, judge, log, usage, advanced, paid, preview, items, providerOff, endpointProject, endpointModel, keyPlaceholder, keySaved, keyCleared, keySaveFailed, keyClearFailed, markHints, modelsRefreshed, modelCount, modelsCurrent, modelsRefreshFailed, atLeast, atMost, contextTokens, outputTokens, savedNote, boxes, verdicts, hiddenCount, presetModels, failed };
