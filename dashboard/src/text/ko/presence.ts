// 상태 문구 편집기

/** 특별 문구의 조건 종류 */
const conditionDate = "양력";
const conditionLunar = "음력";
const conditionTime = "시간대";

// 목록
const title = "상태 문구";
const addSpecial = "기간 · 시간대 문구 추가";
const desc = "위에 배열된 것을 우선하고, 조건에 부합하는 게 없으면 기본 문구를 사용해요.";
const defaults = "기본 문구";
const messageCount = (count: number) => `문구 ${count}`;
const dragToReorder = "끌어서 차례 바꾸기";
const noCondition = "조건 없음";
const noName = "이름 없음";
const empty = "기간 · 시간대 문구가 없어요. 오른쪽 위 + 로 더해요";
const savedNote = "다음 상태 문구부터 반영돼요";

// 기본 문구
const defaultsDesc = "설정한 문구들의 조건과 맞지 않는 때에 이 문구들을 사용해요.";
const interval = "문구 변경 주기(초)";
const ifEmpty = (value: number | string) => `비우면 ${value}`;
const messages = "문구";

// 기간 · 시간대 문구
const namePlaceholder = "항목 이름 (크리스마스)";
const removeSpecial = "이 항목 삭제";
const conditions = "조건";
const conditionsDesc = "둘 이상 적으면 모두 맞을 때만 써요. 연말 · 자정을 걸쳐도 돼요(12-28 ~ 01-05, 22:00 ~ 06:00).";

// 검사
const problems = {
  noName: "이름이 없어요",
  duplicate: "같은 이름의 항목이 있어요",
  /** 이름이 빈 항목을 검사에 넘길 때 쓰는 이름 */
  unnamed: "이름 없는 항목",
};

// 문구 줄
const insertEmoji = "이모지 넣기";
const activity = "활동 종류";
const removeMessage = "이 문구 삭제";
/** 디스코드 활동 종류(빈 값은 기본) */
const activityTypes = { "": "기본", Listening: "듣는 중", Playing: "게임 중", Watching: "시청 중", Competing: "경쟁 중", Custom: "말머리 없음" };

export { conditionDate, conditionLunar, conditionTime, title, addSpecial, desc, defaults, messageCount, dragToReorder, noCondition, noName, empty, savedNote, defaultsDesc, interval, ifEmpty, messages, namePlaceholder, removeSpecial, conditions, conditionsDesc, problems, insertEmoji, activity, removeMessage, activityTypes };
