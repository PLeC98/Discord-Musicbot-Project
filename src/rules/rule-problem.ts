// 아래층(rules, config, store)과 서버가 문장 대신 내는 문제: 코드와 값. 문장은 rules/text/<언어>/가 그린다(봇의 로그와 터미널은 LOG_LANGUAGE, 화면은 보는 사람의 언어).
// 감싸는 문제(운영 설정값의 이름과 값, 불러오기 항목)는 이유를 cause에 담는다. 화면도 부르는 Node 없는 모듈

const RULE_CODES = [
  // 감싸는 문제. tune-value: 운영 설정값의 이름(key)과 넣은 값(value), archive-item: 불러오기 항목(item)
  "tune-value",
  "archive-item",
  // 운영 설정값 저장 검사(store/tunables)
  "tune-unknown-key",
  "tune-not-text",
  "tune-locked",
  // 값 검사(config/index의 invalid)
  "guild-id",
  "bool",
  "one-of",
  "integer",
  "safe-integer",
  "at-least",
  "at-most",
  "url",
  "url-scheme",
  "origin-only",
  "address",
  "color",
  "queue-max",
  "ytdlp-tag",
  "cookies",
  "client-names",
  // bgutil의 태그와 커밋(rules/bgutil-install)
  "bgutil-commit-only",
  "bgutil-not-tag",
  "bgutil-commit-hash",
  "bgutil-needs-commit",
  // 불러오기
  "archive-missing",
  // 장르 설정 검사(config/schema/genres)
  "genre-source-weight",
  "genre-source-min-score",
  "genre-source-need",
  "genre-source-enum",
  "genre-source-years",
  "genre-source-lengths",
  "genre-source-missing",
  "genre-source-type",
  "genre-label",
  "genre-emoji",
  "genre-old-keywords",
  "genre-no-sources",
  "genre-min-duration",
  "genre-max-duration",
  "genre-prefetch",
  "genre-durations",
  "genres-empty",
  "genres-too-many",
  "genre-id-empty",
  "genre-id-numeric",
  "genre-id-long",
  "defaults-prefetch",
  "defaults-min-duration",
  "defaults-max-duration",
  "defaults-blocked",
  "defaults-max-below-default",
  "defaults-durations",
  // 활동 문구 설정 검사(config/schema/status)
  "status-range",
  "range-not-text",
  "range-split",
  "range-part",
  "status-empty-text",
  "status-long-text",
  "status-type",
  "status-message-shape",
  "status-no-messages",
  "status-entry-empty",
  "status-entry-no-when",
  "status-special-shape",
  "status-name-empty",
  "status-name-numeric",
  "status-interval",
  // AI 설정 검사(config/schema/ai)
  "ai-secret-header",
  "ai-between",
  "ai-line-format-text",
  "ai-line-format",
  "ai-list-shape",
  "ai-provider",
  "ai-enabled",
  "ai-temperature",
  "ai-skip-confident",
  "ai-total-timeout",
  "ai-retry-timeouts",
  "ai-retry-status",
  "ai-extra-text",
  "ai-prompt-field",
  "ai-project",
  "ai-location-text",
  "ai-location",
  "ai-params-model",
  "ai-params-shape",
  "ai-hide-models",
  "ai-prompt-names",
  "ai-needs-provider",
  "ai-needs-base-url",
  "ai-base-url",
  "ai-needs-model",
  "format-needs-title",
  // AI 프롬프트 검사(config/schema/ai-prompt)
  "prompt-shape",
  "prompt-section-shape",
  "prompt-role",
  "prompt-text",
  "prompt-format",
  "prompt-chatml",
  "prompt-needs-list",
  // 줄 형식 검사(rules/line-format)
  "format-unclosed",
  "format-block-unclosed",
  "format-stray-close",
  "format-unknown-block",
  "format-block-test",
  "format-stray-else",
  "format-double-else",
  "format-renamed",
  "format-unknown-name",
  "format-no-arg",
  // 설정 불러오기(dashboard/settings-archive, login-background/archive, audio-cache-archive)
  "archive-full-backup",
  "archive-no-json",
  "archive-json-big",
  "archive-json-bad",
  "archive-json-shape",
  "archive-format",
  "archive-favicon-big",
  "archive-not-audio",
  "archive-no-rows",
  "archive-rows-bad",
  "archive-rows-shape",
  "archive-website",
  "archive-website-cleared",
  "archive-cookies",
  "archive-potoken",
  "archive-ytdlp-pin",
  "archive-bgutil-pin",
  "archive-ai-target",
  "archive-status-links",
  "archive-prompt-shape",
  "archive-not-table",
  "archive-favicon-index",
  "archive-favicon-missing",
  "archive-favicon-broken",
  "lbg-still-missing",
  "lbg-still-format",
  "lbg-list-missing",
  "lbg-list-bad",
  "lbg-rung-missing",
  "lbg-rung-bad",
  "lbg-index-big",
  "lbg-index-unreadable",
  "lbg-index-shape",
  "lbg-unfinished",
  "lbg-duplicate",
  "lbg-unknown-files",
  "lbg-no-room",
  "lbg-replace",
  "lbg-stop-making",
  "lbg-none",
  // 데이터 글 그대로(text): 모델 이름, 주소, 바깥 서비스의 오류 글
  "plain",
  // 봇 상태 탭의 연결(dashboard/status/links)
  "link-off",
  "link-no-key",
  "link-no-token",
  "link-genres-broken",
  "link-unused",
  "link-anon-token",
  "link-recent-fails",
  "link-reconnects",
  "link-reconnecting",
  "link-pot-down",
  "link-lb-hint",
  // 아직 코드로 옮기지 않은 문장(text). 어느 언어로 보든 글 그대로 보인다
  "unmoved",
] as const;

type RuleCode = (typeof RULE_CODES)[number];
type RuleParams = Readonly<Record<string, string | number>>;
type RuleProblem = { code: RuleCode; params?: RuleParams; cause?: RuleProblem };
/** 언어 모듈의 문장 하나. cause는 그려 둔 이유(없으면 빈 문자열) */
type RuleSentence = (params: RuleParams, cause: string) => string;
/** 언어 모듈이 코드마다 하나씩 적는 문장 */
type RuleSentences = Readonly<Record<RuleCode, RuleSentence>>;

const rule = (code: RuleCode, params?: RuleParams, cause?: RuleProblem): RuleProblem => ({ code, ...(params ? { params } : {}), ...(cause ? { cause } : {}) });

const CODES: ReadonlySet<string> = new Set(RULE_CODES);
const isRuleCode = (value: unknown): value is RuleCode => typeof value === "string" && CODES.has(value);

/** 아직 코드로 옮기지 않은 문장을 문제로 싣는다 */
const unmoved = (text: string): RuleProblem => rule("unmoved", { text });

/** 데이터 글을 그대로 싣는다(번역하지 않는다) */
const plain = (text: string): RuleProblem => rule("plain", { text });

/** 운영 설정값 하나의 문제: 이름과 넣은 값, 이유 */
const tuneProblem = (key: string, value: string, reason: RuleProblem): RuleProblem => rule("tune-value", { key, value }, reason);

/** 운영 설정값 문제의 이름. 다른 문제면 null */
const tuneKeyOf = (problem: RuleProblem): string | null => (problem.code === "tune-value" || problem.code === "tune-unknown-key" || problem.code === "tune-not-text" ? String(problem.params?.key ?? "") : null);

/** 문제 하나를 그 언어의 문장으로. causeLine: 이유를 그리는 함수(화면은 이름 대신 라벨을 붙여 그린다) */
function ruleLine(sentences: RuleSentences, problem: RuleProblem, causeLine: (cause: RuleProblem) => string = (cause) => ruleLine(sentences, cause)): string {
  return sentences[problem.code](problem.params ?? {}, problem.cause ? causeLine(problem.cause) : "");
}

export { RULE_CODES, rule, isRuleCode, unmoved, plain, tuneProblem, tuneKeyOf, ruleLine };
export type { RuleCode, RuleParams, RuleProblem, RuleSentence, RuleSentences };
