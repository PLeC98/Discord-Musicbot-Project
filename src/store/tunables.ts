// 운영 설정값(rules/tunables)을 settings.db의 "tunables" 문서에서 꺼내 설정 객체에 올린다.
// 기동 시 한 번(boot), 대시보드에서 저장할 때마다(save). 계산은 .env와 같은 loadConfig가 한다(검사, 단위, 다듬기가 하나).
// 저장하면 설정 객체를 고치고 알린다(config/tunables-changed). 기동 시 만들어 둔 제한기, 타이머가 듣고 다시 만든다.
// 다시 시작해야 적용되는 값(restart)은 저장해도 기동 시 값으로 돈다. 저장하자마자 반쯤 적용되는 일(실행하지 않은 POToken 서버를 찾는 따위)이 없게.
// 도구 카드가 고치는 값(card)은 저장 바의 저장(save)이 건드리지 못한다. 요청 본문에서 읽지 않고 저장된 값을 이어 쓴다(본문에서 빼는 것으로 삭제하지 못하게). 고치는 것은 saveCard 뿐이다.

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "config" });
// 설정 객체는 필드마다 덮어쓰므로 받은 이름으로만 읽는다(모듈 맨 위에서 꺼내 두지 않는다)
import * as root from "../config/index.ts";
import { codedError, messageOf } from "../rules/error-kind.ts";
import { tunablesChanged } from "../config/tunables-changed.ts";
import { TUNABLES, TUNABLE_KEYS, RETIRED_TUNABLES, RESTART_KEYS, CARD_KEYS, tunable, tunableValue, type TunablesView } from "../rules/tunables.ts";
import { rule, tuneKeyOf, tuneProblem, type RuleProblem } from "../rules/rule-problem.ts";
import * as docs from "./settings-docs.ts";
import { L } from "../infra/log/text.ts";
import { logRuleLine, ruleLogText } from "../rules/text/index.ts";
import { logTextError } from "../infra/log/log-text.ts";

const DOC = "tunables";

// 기동 시 올린 값. 다시 시작해야 적용되는 값은 이것으로 돈다
let booted: Record<string, string> = {};

/** 문서에서 아는 이름, 문자열 값만 남긴다. 빈 문자열은 기본값이라 뺀다. 공백은 tunableValue 대로(텍스트 필드는 남긴다) */
function shape(data: unknown): Record<string, string> {
  const source = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const { key } of TUNABLES) {
    const value = source[key];
    const kept = typeof value === "string" ? tunableValue(key, value) : "";
    if (kept) out[key] = kept;
  }
  return out;
}

/**
 * 운영 설정값이 반영되는 설정 객체의 영역(경로). 저장하면 이 영역만 새 값으로 덮어쓴다. 설정 객체 전체를 덮지 않는 까닭은
 * 실행 중 다른 곳에서 채워 넣는 값(store/service-keys의 서비스 키)이 있기 때문이다. 운영 설정값을 추가해 새 영역이 생기면 여기에도 추가한다(빠진 영역이 있으면 테스트가 잡아낸다)
 */
const TUNED_SECTIONS = ["bot", "ytdlp", "bgutil", "sponsorblock", "voiceStatus", "cache", "stream", "dashboard.rateLimit", "dashboard.sse", "dashboard.operators", "aiLog", "geoip", "i18n"] as const;

type Section = Record<string, unknown>;
const sectionOf = (root: object, path: string) => path.split(".").reduce<Section>((at, key) => at[key] as Section, root as Section);

// 계산한 값을 설정 객체에 올린다. 값을 쓰는 곳이 쥔 객체가 바뀌지 않게 영역마다 필드를 덮어쓴다. 문제를 돌려준다
function apply(values: Record<string, string>) {
  const config = root.default;
  const next = root.loadConfig(process.env, { tunables: values });
  for (const path of TUNED_SECTIONS) Object.assign(sectionOf(config, path), sectionOf(next.config, path));
  return next.tuneProblems;
}

// 기동 시 올린다. 틀린 필드는 기동을 멈추지 않고 그 필드만 기본값(DB를 외부에서 고쳤을 때 등. 고칠 화면이 떠야 한다)
function boot(values: Record<string, string>) {
  for (const problem of apply(values)) log.warn(L.config.tunableInvalid({ problem: ruleLogText(problem) }));
  booted = values;
}

/** 기동 시. settings.db를 연 뒤 */
function load() {
  boot(shape(docs.read(DOC).data));
}

/**
 * 봇이 켜지지 않은 채(스크립트). settings.db를 읽기 전용으로 본다.
 * strict: 파일은 있는데 읽지 못하면 예외를 던진다(기본값으로 넘어가면 저장해 둔 버전 고정을 무시하게 되는 스크립트용). 파일, 문서가 없으면 어느 쪽이든 기본값
 */
function loadReadOnly(file: string, { strict = false } = {}) {
  boot(shape(docs.peek(file, DOC, { strict })));
}

/** 지금 쓰는 값: 다시 시작해야 적용되는 이름은 기동 시 값, 나머지는 저장한 값 */
function effective(saved: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const { key } of TUNABLES) {
    const value = RESTART_KEYS.has(key) ? booted[key] : saved[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// 문서에서 도구 카드의 값만 추린다
const cardPart = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).filter(([key]) => CARD_KEYS.has(key)));
// keys가 참을 돌려주는 이름의 문제만 남긴다
const about = (problems: RuleProblem[], keys: (key: string) => boolean) => problems.filter((problem) => keys(tuneKeyOf(problem) ?? ""));

// 저장 거절의 예외. 메시지는 로그 언어로 그린 문제, problems는 화면이 그릴 문제
const invalidError = (problems: RuleProblem[]) => Object.assign(codedError("CONFIG_INVALID", L.config.problemLines({ lines: problems.map(logRuleLine).join("\n") })), { problems });

/**
 * 저장 바의 저장. values는 필드 전부(빈 필드는 기본값), revision은 화면이 읽은 번호. 도구 카드의 값은 values에서 읽지 않고 저장된 값을 이어 쓴다.
 * 모르는 이름, 틀린 값이면 CONFIG_INVALID(problems), 그사이 다른 저장이 있었으면 REVISION_CONFLICT 예외를 던진다.
 * 검사는 이 저장이 고치는 값만 본다(저장돼 있던 카드 값이 잘못돼 있어도 상관없는 저장을 막지 않는다)
 */
function save(values: Record<string, unknown>, revision: number): TunablesView {
  const general = Object.fromEntries(Object.entries(values).filter(([key]) => !CARD_KEYS.has(key)));
  const before = shape(docs.read(DOC).data);
  const saved = { ...shape(general), ...cardPart(before) };
  const problems = [...shapeProblems(general), ...about(root.loadConfig(process.env, { tunables: saved }).tuneProblems, (key) => !CARD_KEYS.has(key)), ...lockedProblems(before, saved)];
  if (problems.length) throw invalidError(problems);
  const next = docs.write(DOC, saved, revision);
  use(saved);
  return { values: saved, revision: next, pending: pendingOf(saved) };
}

/**
 * 도구 카드의 저장. changes의 이름(카드 값과, 함께 바꾸는 카드 값이 잠그는 이름)을 그 값으로 바꾸고(빈 값, null은 기본값) 나머지는 그대로 둔다.
 * expect: 화면이 보던 값(이름마다, 기본값이면 빈 문자열). 그사이 달라졌으면 CARD_CONFLICT, 바꾸는 값이 틀리면 CONFIG_INVALID(problems) 예외를 던진다
 */
function saveCard(changes: Record<string, string | null>, expect: Record<string, string> = {}): TunablesView {
  // 카드 값과 함께라면 그 값이 잠그는 이름도 바꾼다(이전 버전으로 되돌릴 때 고정과 채널을 함께)
  const stray = [...Object.keys(changes), ...Object.keys(expect)].filter((key) => !CARD_KEYS.has(key) && !(TUNABLE_KEYS.has(key) && tunable(key).lockedBy && tunable(key).lockedBy! in changes));
  if (stray.length) throw logTextError(L.config.toolCardKeysUnknown({ names: stray.join(", ") }));
  const doc = docs.read(DOC);
  const now = shape(doc.data);
  const moved = Object.entries(expect).filter(([key, value]) => (now[key] ?? "") !== value);
  if (moved.length) throw codedError("CARD_CONFLICT", L.config.toolCardConflict({ names: moved.map(([key]) => key).join(", ") }));
  const saved = shape({ ...now, ...changes });
  const problems = about(root.loadConfig(process.env, { tunables: saved }).tuneProblems, (key) => key in changes);
  if (problems.length) throw invalidError(problems);
  const next = docs.write(DOC, saved, doc.revision);
  use(saved);
  return { values: saved, revision: next, pending: pendingOf(saved) };
}

// 잠긴 값(lockedBy의 값이 있는 동안)을 바꾸려 했다
function lockedProblems(before: Record<string, string>, after: Record<string, string>): RuleProblem[] {
  return TUNABLES.flatMap(({ key, lockedBy }) => (lockedBy && before[lockedBy] && (before[key] ?? "") !== (after[key] ?? "") ? [tuneProblem(key, after[key] ?? "", rule("tune-locked", { lockedBy }))] : []));
}

// 모르는 이름, 문자열이 아닌 값
function shapeProblems(values: Record<string, unknown>): RuleProblem[] {
  const unknown = Object.keys(values).filter((key) => !TUNABLE_KEYS.has(key) && !RETIRED_TUNABLES.has(key));
  const wrongType = Object.entries(values).filter(([, value]) => typeof value !== "string" && value !== null);
  return [...unknown.map((key) => rule("tune-unknown-key", { key })), ...wrongType.map(([key]) => rule("tune-not-text", { key }))];
}

/** 문서 전체의 검사(불러오기: 모르는 이름, 문자열이 아닌 값, .env와 같은 값 검사) */
function problemsOf(values: Record<string, unknown>): RuleProblem[] {
  return [...shapeProblems(values), ...root.loadConfig(process.env, { tunables: shape(values) }).tuneProblems];
}

// 저장한 값을 설정 객체에 올리고 알린다(다시 시작해야 적용되는 값은 기동 시 값으로)
function use(saved: Record<string, string>) {
  apply(effective(saved));
  for (const error of tunablesChanged()) log.error(L.config.tunablesApplyFailed({ error: messageOf(error) }));
}

/** 문서를 외부(불러오기)가 바꿨다. DB에서 다시 읽어 저장할 때처럼 올린다 */
function reload() {
  use(shape(docs.read(DOC).data));
}

/** 불러오기가 한 트랜잭션 안에서 쓴다. 검사는 problemsOf로 먼저. 메모리는 reload로 */
function writeRaw(values: Record<string, unknown>) {
  docs.write(DOC, shape(values), docs.read(DOC).revision);
}

// 저장했지만 다시 시작해야 적용되는 이름
const pendingOf = (saved: Record<string, string>) => [...RESTART_KEYS].filter((key) => (saved[key] ?? "") !== (booted[key] ?? ""));

/** 화면용 */
function view(): TunablesView {
  const doc = docs.read(DOC);
  const saved = shape(doc.data);
  return { values: saved, revision: doc.revision, pending: pendingOf(saved) };
}

export { load, loadReadOnly, save, saveCard, view, problemsOf, reload, writeRaw, TUNED_SECTIONS };
