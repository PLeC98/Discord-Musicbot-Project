// 운영자 패널: AI 보조 탭(모델 · 파라미터 · 연결 테스트 · 프롬프트 · 판정 테스트 · 고급 설정)

import { formatNumber } from "../../utils/locale.ts";

// 목록
const title = "AI 보조";
const enable = "AI 보조 켜기";
const desc = "자동재생 후보를 LLM을 사용해 재검증해요.";
const descTip = "유튜브 검색으로 고른 후보만 물어요(키워드 검색 · 곡 이름으로 찾기).\n유튜브 주소를 직접 주는 출처(유튜브 재생목록 · VocaDB 등)는 묻지 않아요.\n모델을 못 부르면 규칙으로 고르니 재생은 멈추지 않아요.";
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
  accountHint: "받은 JSON 을 그대로 붙여넣어요. 프로젝트를 비우면 그 안의 project_id 를 써요.",
  keyHint: "저장된 값은 보안을 위해 출력하지 않아요. 확인하려면 설정 파일을 직접 확인해 주세요.",
  insecure: "지금 평문(HTTP)으로 접속 중이에요. 키가 그대로 네트워크를 지나가요.",
  staleUrl: "주소를 고쳤지만 아직 저장하지 않았어요. 저장 전에는 키를 붙이지 않고 보내요.",
  model: "모델",
  modelPlaceholder: "모델 이름",
  refreshList: "모델 목록 새로고침",
  manualTip: "목록을 못 받았으면 직접 적어야 해요",
  manual: "직접 입력",
  hide: "목록에서 모델 숨기기",
  /** 숨기기 설명: 앞 · 와일드카드 기호 · 뒤 */
  hideHelpBefore: "받아 온 목록에서 빼요. ",
  hideHelpAfter: " 만 와일드카드로 보고 대소문자는 가리지 않아요. 영상 · 이미지 모델이나 옛 모델을 빼는 데 써요.",
  hidePlaceholder: "*sora* 처럼 적고 Enter",
};

// 파라미터 카드
const params = {
  title: "파라미터 설정",
  refresh: "모델 정보 갱신",
  refreshTip: "모델 정보를 다시 받아요",
  advanced: "고급 파라미터 설정",
  default: "기본값",
  defaultWith: (value: unknown) => `기본값 (${String(value)})`,
  listPlaceholder: "적고 Enter",
  badJson: "JSON 으로 읽지 못했어요",
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
  batch: "요청 하나에 맡길 곡 수",
  batchTip: "요청을 잘게 쪼개면 느려요.",
  skipConfident: "확신할 땐 묻지 않기",
  skipConfidentTip: "채널명, 길이가 일치하면 묻지 않아요.",
  lineFormat: "줄 형식",
  /** 줄 형식 설명: 앞 · 목록 자리 표시 · 뒤 */
  lineFormatBefore: "후보를 한 줄에 어떻게 적을지예요. 이렇게 적은 목록이 프롬프트의 ",
  lineFormatAfter: " 자리에 들어가요. 업로더 이름은 넣을 수 없어요(Vevo · Radio Mix 같은 이름 때문에 정답률이 떨어졌어요).",
  unknownDuration: "길이를 모르는 후보",
  unknownText: "대신 적을 글자",
  unknownTextPlaceholder: "모름",
};

// 판정 프롬프트 카드
const prompt = {
  title: "판정 프롬프트",
  tokens: (count: number) => `${formatNumber(count)} 토큰`,
  estimated: "추산치",
  tokensFailed: "토큰 수를 세지 못함",
  addSection: "섹션 추가",
  /** 설명: 앞 · 답 꼴 예시 · 뒤 */
  descBefore: "섹션마다 역할을 정해 적은 차례대로 보내요. 답은 반드시 ",
  descAfter: " 꼴의 JSON 배열이어야 해요.",
  emptyUsesDefault: "비어 있어 기본 프롬프트를 써요.",
  listMarkMissing: (mark: string) => `어느 섹션에도 ${mark} 이 없어요.`,
  dragToReorder: "끌어서 차례 바꾸기",
  sectionName: (n: number) => `섹션 ${n}`,
  sectionNameTip: "표기를 위한, 요청에 쓰이지 않는 값이에요.",
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
  genre: "장르",
  genrePlaceholder: "록",
  lookup: "링크 조회",
  looking: "조회 중…",
  send: "요청 전송",
  sending: "보내는 중…",
  stale: "작성한 주소를 아직 조회하지 않았어요. 이대로 전송하면 내장된 보기 곡을 사용해요.",
  listTitle: "모델에게 갈 목록",
  copyList: "목록 복사",
  copy: "복사",
  rawShow: "요청 기록 보기",
  rawHide: "요청 기록 접기",
};

// 자리만 있는 것(2차 18단계 신규 기능)
const logNotYet = "리퀘스트 로그는 아직 짜지 않았어요";
const usageNotYet = "사용량 통계는 아직 짜지 않았어요";

// 고급 설정 카드
const advanced = {
  title: "요청 · 재시도",
  desc: "실패하면 설정한 대로 재요청을 하며, 최종 실패 시에는 규칙만을 사용해요. 칸을 비우면 기본값을 사용해요.",
  timeout: "타임아웃(초)",
  timeoutTip: "요청마다 응답을 기다릴 시간",
  retries: "실패 시 재요청 횟수",
  retriesTip: "실패 시 재요청할 최대 횟수\n(0이면 재요청하지 않음)",
  total: "판정 전체 상한(초)",
  totalTip: "재시도, 대기 등을 포함한 한 건의 판정에 거는 상한\n(0이면 상한 없음)",
  delay: "재시도 대기 시간(초)",
  delayTip: "실패 시 최초 대기\n(회차마다 두 배로 늘려 시도)",
  delayMax: "최대 대기 시간(초)",
  delayMaxTip: "재요청 대기 시간의 상한\n(서버의 대기 요구에도 적용 · Gemini API 는 30~60초를 요구하는 경우가 있음)",
  retryTimeouts: "타임아웃 시 재요청",
  retryStatus: "재요청할 응답 코드",
  retryStatusTip: "연결 실패는 적지 않아도 재요청해요.\n400, 401, 403, 404 는 재요청으로 해결할 수 없으니 넣지 마세요.",
};

// 유료 확인 대화상자
const paid = {
  title: "실제로 보낼까요?",
  body: "토큰이 들어요.",
  to: "보낼 곳",
  model: "모델",
  what: "보낼 것",
  checking: "확인하는 중…",
  emptyModel: "(비어 있음)",
  /** 판정 테스트로 보낼 것: 섹션 수(비었으면 기본) · 고른 곡 수(없으면 보기 곡 셋) */
  judgeWhat: (sections: number, picked: number) => `판정 프롬프트 전체 (섹션 ${sections || "기본"}개 · ${picked ? `고른 곡 ${picked}개` : "보기 곡 3개"})`,
  cancel: "그만두기",
  send: "보내기",
};

// 요청 미리보기 대화상자
const preview = {
  title: "리퀘스트 미리보기",
  notSent: "보내지 않았어요",
  rawShow: "날것 보기 (주소 · 헤더 · 본문)",
  rawHide: "날것 접기",
};

// 묶음(목록 줄)
const items = { model: "모델", prompt: "프롬프트", advanced: "고급 설정", log: "리퀘스트 로그", usage: "사용량 통계" };
/** 프로바이더를 고르지 않은 값 */
const providerOff = "사용하지 않음";
/** 버텍스 주소를 보일 때 아직 모르는 칸 */
const endpointProject = "[프로젝트 ID]";
const endpointModel = "{모델}";
/** 키 입력칸 자리 글 */
const keyPlaceholder = { accountSaved: "저장돼 있어요. 바꾸려면 새 JSON 을 붙여넣으세요", keySaved: "저장돼 있어요. 새로 저장하면 바뀌어요.", empty: "키를 입력하세요" };
const keySaved = "키를 저장했어요";
const keyCleared = "키를 지웠어요";
const keySaveFailed = "키를 저장하지 못했어요.";
const keyClearFailed = "키를 지우지 못했어요.";
/** 줄 형식 자리표시자 설명(이름은 봇의 LINE_MARKS) */
const markHints: Record<string, string> = { 번호: "1부터", 장르: "자동재생 장르 이름", 제목: "영상 제목 (필수)", 길이분: "길이(분)", 길이초: "길이(초)" };
/** 길이를 모르는 후보를 적는 법 */
const unknownWays = {
  hide: { label: "그 칸 빼기", hint: '자리표시자가 든 낱말째 빠져요. 기본 형식이면 "길이=3분"이 통째로 사라져요.' },
  text: { label: "글자로 적기", hint: "형식이 일정해 모델이 자리를 헷갈리지 않아요." },
  zero: { label: "0으로 적기", hint: "모르는 것을 0분이라고 알려 주는 셈이라 권하지 않아요." },
};
const modelsRefreshed = "모델 정보를 갱신했어요";
const modelCount = (count: number) => `모델 ${count}개`;
const modelsCurrent = "모델 정보가 이미 최신이에요";
const modelsRefreshFailed = "모델 정보를 받지 못했어요.";
/** 파라미터 칸의 범위 안내 */
const atLeast = (value: number) => `${value} 이상`;
const atMost = (value: number) => `${value} 이하`;
const contextTokens = (count: string) => `컨텍스트 ${count}토큰`;
const outputTokens = (count: string) => `최대 출력 ${count}토큰`;
const savedNote = "다음 자동재생부터 반영돼요";
/** 요청 기록 · 미리보기 상자 이름 */
const boxes = { headers: "요청 헤더", body: "요청 본문", response: "응답", empty: "(비어 있음)" };
const verdicts = { pass: "통과", notSong: "곡 아님", wrongGenre: "장르 다름" };
const hiddenCount = (count: number) => `, ${count}개 가림`;
const failed = {
  tokens: "토큰을 세지 못했어요.",
  lookup: "조회하지 못했어요.",
  list: "프롬프트에 적힐 목록을 그리지 못했어요.",
  judge: "판정을 받지 못했어요.",
  fields: "모델이 받는 칸을 읽지 못했어요.",
  state: "키가 있는지와 기본 프롬프트를 읽지 못했어요.",
  preview: "미리보기를 만들지 못했어요.",
  models: "불러오지 못했어요.",
  endpoint: "보낼 곳을 확인하지 못했어요.",
  send: "보내지 못했어요.",
};

export { title, enable, desc, descTip, listMarkMissing, model, params, test, list, prompt, judge, logNotYet, usageNotYet, advanced, paid, preview, items, providerOff, endpointProject, endpointModel, keyPlaceholder, keySaved, keyCleared, keySaveFailed, keyClearFailed, markHints, unknownWays, modelsRefreshed, modelCount, modelsCurrent, modelsRefreshFailed, atLeast, atMost, contextTokens, outputTokens, savedNote, boxes, verdicts, hiddenCount, failed };
