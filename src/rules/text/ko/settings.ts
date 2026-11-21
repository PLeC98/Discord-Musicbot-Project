// 설정 문서 검사(장르, 활동 문구, AI, 프롬프트, 줄 형식)의 문장. 운영자가 고칠 것까지 적는다.
// 위치 값: 장르는 id(장르 식별자)와 source(몇 번째 소스), 활동 문구는 name(특별 문구 이름. 없으면 평소 문구), AI는 model, 프롬프트는 section(몇 번째 섹션), 줄 형식은 at(몇 번째 글자)

import type { RuleParams, RuleSentences } from "../../rule-problem.ts";

const sourceAt = (p: RuleParams) => `${p.id}의 ${p.source}번째 소스`;
const statusAt = (p: RuleParams) => (p.name === undefined ? "평소 문구" : String(p.name));
const or = (list: unknown) => String(list).split(",").join(" 또는 ");

const genres = {
  "genre-source-weight": (p) => `${sourceAt(p)}: weight는 1 이상이어야 해요`,
  "genre-source-min-score": (p) => `${sourceAt(p)}: minScore는 0 이상이어야 해요`,
  "genre-source-need": (p) => `${sourceAt(p)}(${p.label}): ${or(p.fields)} 중 하나를 적어야 해요`,
  "genre-source-enum": (p) => `${sourceAt(p)}(${p.label}): ${p.key}에 "${p.value}" 값은 쓸 수 없어요. 쓸 수 있는 것: ${p.allowed}`,
  "genre-source-years": (p) => `${sourceAt(p)}: yearFrom이 yearTo보다 커요`,
  "genre-source-lengths": (p) => `${sourceAt(p)}: minLength가 maxLength보다 커요`,
  "genre-source-missing": (p) => `${sourceAt(p)}: type과 값을 적어야 해요`,
  "genre-source-type": (p) => `${sourceAt(p)}: 모르는 종류예요(${p.type}). 쓸 수 있는 것: ${p.types}`,
  "genre-label": (p) => `${p.id}: label은 비울 수 없고 100자까지 쓸 수 있어요`,
  "genre-emoji": (p) => `${p.id}: emoji는 이모지 한 글자나 봇의 앱 이모지(<:이름:id>) 하나여야 해요`,
  "genre-old-keywords": (p) => `${p.id}: 맨 위 keywords:는 더 이상 쓰지 않아요. sources:로 옮겨 주세요. sources: [{ type: keyword, keywords: [...] }]`,
  "genre-no-sources": (p) => `${p.id}: 소스(sources)가 하나는 있어야 해요`,
  "genre-min-duration": (p) => `${p.id}: minDurationSec은 0 이상이어야 해요`,
  "genre-max-duration": (p) => `${p.id}: maxDurationSec은 비우거나 0보다 커야 해요`,
  "genre-prefetch": (p) => `${p.id}: prefetchCount는 장르마다 둘 수 없어요. defaults에만 적어 주세요`,
  "genre-durations": (p) => `${p.id}: 이 장르의 minDurationSec(${p.min})이 maxDurationSec(${p.max})보다 커요`,
  "genres-empty": () => "장르가 하나도 없어요",
  "genres-too-many": (p) => `장르가 ${p.count}개예요. 디스코드 선택 메뉴는 ${p.max}개까지만 보여 줘요`,
  "genre-id-empty": () => "장르 식별자가 비어 있어요",
  "genre-id-numeric": (p) => `"${p.id}": 숫자만으로 된 식별자는 순서가 어긋나요. "${p.id}s"처럼 글자를 붙여 주세요`,
  "genre-id-long": (p) => `"${p.head}…": 식별자는 100자까지 쓸 수 있어요`,
  "defaults-prefetch": () => "prefetchCount는 1 이상이어야 해요",
  "defaults-min-duration": () => "minDurationSec은 0 이상이어야 해요",
  "defaults-max-duration": () => "maxDurationSec은 비우거나 0보다 커야 해요",
  "defaults-blocked": () => "blockedKeywords는 목록으로 적어야 해요",
  "defaults-max-below-default": (p) => `maxDurationSec(${p.max})이 minDurationSec의 기본값(${p.min})보다 작아요`,
  "defaults-durations": () => "minDurationSec이 maxDurationSec보다 커요",
} satisfies Partial<RuleSentences>;

const status = {
  "status-range": (p, cause) => `${p.name}의 ${p.kind}: ${cause}`,
  "range-not-text": () => "글자로 적어야 해요",
  "range-split": (p) => `"${p.example}"처럼 ~로 나눠 적어야 해요`,
  "range-part": (p) => `"${p.part}"는 ${p.shape} 두 자리로 적어야 해요`,
  "status-empty-text": (p) => `${statusAt(p)}: 빈 문구가 있어요`,
  "status-long-text": (p) => `${statusAt(p)}: 문구가 ${p.max}자를 넘어요("${p.head}…")`,
  "status-type": (p) => `${statusAt(p)}: ${p.type}은 쓸 수 없는 활동 종류예요(${p.types})`,
  "status-message-shape": (p) => `${statusAt(p)}: 문구는 글자로 적거나 text/type으로 나눠 적어야 해요`,
  "status-no-messages": (p) => `${statusAt(p)}: 문구가 하나는 있어야 해요`,
  "status-entry-empty": (p) => `${p.name}: 내용이 비어 있어요`,
  "status-entry-no-when": (p) => `${p.name}: date, lunar, time 중 하나는 있어야 해요(없으면 항상 이 문구만 나와요)`,
  "status-special-shape": () => "special은 이름을 붙인 목록이어야 해요",
  "status-name-empty": () => "문구 이름이 비어 있어요",
  "status-name-numeric": (p) => `"${p.name}": 숫자만으로 된 이름은 순서가 어긋나요. "${p.name}년"처럼 글자를 붙여 주세요`,
  "status-interval": (p) => `interval은 ${p.min}초 이상이어야 해요`,
} satisfies Partial<RuleSentences>;

const ai = {
  "ai-secret-header": () => "extra에 비밀 헤더(Authorization, x-api-key, Cookie 등)는 적을 수 없어요. 키는 API 키 입력란에 입력해 주세요(암호화해 저장해요)",
  "ai-between": (p) => `${p.key}는 ${p.min}~${p.max} 사이여야 해요`,
  "ai-line-format-text": () => "list.lineFormat은 글자로 적어야 해요",
  "ai-line-format": (p, cause) => `list.lineFormat ${p.at}번째 글자: ${cause}`,
  "ai-list-shape": () => "list는 이름:값 형식이어야 해요",
  "ai-provider": (p) => `provider는 ${p.providers} 중 하나여야 해요`,
  "ai-enabled": () => "enabled는 true 또는 false여야 해요",
  "ai-temperature": () => "temperature는 params 아래에 모델별로 적어요",
  "ai-skip-confident": () => "skipConfident는 true 또는 false여야 해요",
  "ai-total-timeout": () => "totalTimeoutMs는 0(상한 없음) 또는 1000~3600000 사이여야 해요",
  "ai-retry-timeouts": () => "retryTimeouts는 true 또는 false여야 해요",
  "ai-retry-status": () => "retryStatus는 400~599 사이 상태 코드 목록이어야 해요(예: [429, 503])",
  "ai-extra-text": () => "extra는 한 줄에 하나씩 적어야 해요",
  "ai-prompt-field": () => "프롬프트는 AI 보조 탭의 프롬프트 입력란에 적어요. AI 설정의 prompt 필드는 쓰이지 않아요",
  "ai-project": () => "project는 글자로 적어야 해요",
  "ai-location-text": () => "location은 글자로 적어야 해요",
  "ai-location": () => "location은 버텍스 리전 이름이어야 해요(영문 소문자, 숫자, 하이픈. 예: us-central1, global)",
  "ai-params-model": (p) => `params.${p.model}은 필드 이름과 값을 적는 표여야 해요(모델 이름으로 한 단계 나눠요)`,
  "ai-params-shape": () => "params는 모델 이름 아래에 필드를 적는 표여야 해요",
  "ai-hide-models": () => 'hideModels는 글자 목록이어야 해요(예: ["*sora*", "gpt-3.5*"])',
  "ai-prompt-names": () => "promptNames는 글자 목록이어야 해요",
  "ai-needs-provider": () => "켜려면 provider를 선택해야 해요",
  "ai-needs-base-url": () => "provider가 custom이면 baseUrl을 적어야 해요",
  "ai-base-url": () => "baseUrl은 http:// 또는 https://로 시작해야 해요",
  "ai-needs-model": () => "model을 적어야 해요",
  "format-needs-title": () => "{{title}}이 있어야 해요. 판정할 대상이 제목이에요",
} satisfies Partial<RuleSentences>;

const prompt = {
  "prompt-shape": () => "프롬프트는 섹션 목록이어야 해요(역할과 내용이 있는 항목)",
  "prompt-section-shape": (p) => `${p.section}번째 섹션: 역할과 내용을 적어야 해요`,
  "prompt-role": (p) => `${p.section}번째 섹션: 역할은 ${p.roles} 중 하나여야 해요`,
  "prompt-text": (p) => `${p.section}번째 섹션: 내용은 글자로 적어야 해요`,
  "prompt-format": (p, cause) => `${p.section}번째 섹션 ${p.at}번째 글자: ${cause}`,
  "prompt-chatml": (p) => `${p.section}번째 섹션: 내용에 <|im_start|>, <|im_end|>를 적을 수 없어요`,
  "prompt-needs-list": (p) => `어딘가에 ${p.mark}가 있어야 해요. 그 위치에 판정할 후보가 들어가요`,
} satisfies Partial<RuleSentences>;

const format = {
  "format-unclosed": () => "{{를 닫는 }}가 없어요",
  "format-block-unclosed": (p) => `${p.exist} 블록을 닫는 {{/}}가 없어요`,
  "format-stray-close": () => "닫을 블록이 없는데 {{/}}가 있어요",
  "format-unknown-block": (p) => `모르는 블록이에요(${p.raw}). 블록은 {{${p.exist} 값}} … {{:else}} … {{/}} 하나뿐이에요`,
  "format-block-test": (p) => `${p.exist} 뒤에 확인할 값을 입력해야 해요. 예: {{${p.exist} {{duration}}}}`,
  "format-stray-else": (p) => `{{:else}}는 ${p.exist} 블록 안에만 쓸 수 있어요`,
  "format-double-else": () => "{{:else}}가 한 블록에 두 개 있어요",
  "format-renamed": (p) => `이름이 바뀌었어요: {{${p.name}}} → ${p.now}`,
  "format-unknown-name": (p) => `모르는 이름이에요(${p.raw}). 쓸 수 있는 것: ${p.known}`,
  "format-no-arg": (p) => `{{${p.name}}}에는 :: 뒤의 값을 붙일 수 없어요`,
} satisfies Partial<RuleSentences>;

export { genres, status, ai, prompt, format };
