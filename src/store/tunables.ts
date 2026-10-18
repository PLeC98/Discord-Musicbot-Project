// 운영 조절값(rules/tunables)을 settings.db 의 "tunables" 문서에서 꺼내 설정 객체에 올린다.
// 기동 때 한 번(boot), 대시보드에서 저장할 때마다(save). 계산은 .env 와 같은 loadConfig 가 한다(검사 · 단위 · 다듬기가 하나).
// 저장하면 설정 객체를 고치고 알린다(config/tunables-changed). 기동 때 만들어 둔 제한기 · 타이머가 듣고 다시 만든다.
// 다시 시작해야 적용되는 값(restart)은 저장해도 기동 때 값으로 돈다. 저장하자마자 반쯤 적용되는 일(실행하지 않은 POToken 서버를 찾는 따위)이 없게.

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "config" });
// 설정 객체는 필드마다 덮어쓰므로 받은 이름으로만 읽는다(모듈 맨 위에서 꺼내 두지 않는다)
import * as root from "../config/index.ts";
import { codedError, messageOf } from "../rules/error-kind.ts";
import { tunablesChanged } from "../config/tunables-changed.ts";
import { TUNABLES, TUNABLE_KEYS, RESTART_KEYS, tunableValue, type TunablesView } from "../rules/tunables.ts";
import * as docs from "./settings-docs.ts";

const DOC = "tunables";

// 기동 때 올린 값. 다시 시작해야 적용되는 값은 이것으로 돈다
let booted: Record<string, string> = {};

/** 문서에서 아는 이름 · 문자열 값만 남긴다. 빈 문자열은 기본값이라 뺀다. 공백은 tunableValue 대로(텍스트 필드는 남긴다) */
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

// 계산한 값을 설정 객체에 올린다. 값을 쓰는 곳이 쥔 객체가 바뀌지 않게 필드마다 덮어쓴다. 문제 줄을 돌려준다
function apply(values: Record<string, string>) {
  const config = root.default;
  const next = root.loadConfig(process.env, { tunables: values });
  const { bot, ytdlp, bgutil, sponsorblock, voiceStatus, cache, stream, dashboard, aiLog } = next.config;
  Object.assign(config.bot, bot);
  Object.assign(config.ytdlp, ytdlp);
  Object.assign(config.bgutil, bgutil);
  Object.assign(config.sponsorblock, sponsorblock);
  Object.assign(config.voiceStatus, voiceStatus);
  Object.assign(config.cache, cache);
  Object.assign(config.stream, stream);
  Object.assign(config.dashboard.rateLimit, dashboard.rateLimit);
  Object.assign(config.dashboard.sse, dashboard.sse);
  Object.assign(config.aiLog, aiLog);
  return next.tuneProblems;
}

// 기동 때 올린다. 틀린 필드는 기동을 멈추지 않고 그 필드만 기본값(DB 를 외부에서 고쳤을 때 등. 고칠 화면이 떠야 한다)
function boot(values: Record<string, string>) {
  for (const line of apply(values)) log.warn(`운영 조절값의 ${line} 그 값은 기본값으로 돕니다. 운영자 패널에서 고치세요`);
  booted = values;
}

/** 기동 때. settings.db 를 연 뒤 */
function load() {
  boot(shape(docs.read(DOC).data));
}

/** 봇이 켜지지 않은 채(명령 배포 스크립트). settings.db 를 읽기 전용으로 본다 */
function loadReadOnly(file: string) {
  boot(shape(docs.peek(file, DOC)));
}

/** 지금 쓰는 값: 다시 시작해야 적용되는 이름은 기동 때 값, 나머지는 저장한 값 */
function effective(saved: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const { key } of TUNABLES) {
    const value = RESTART_KEYS.has(key) ? booted[key] : saved[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * 저장. values 는 필드 전부(빈 필드는 기본값), revision 은 화면이 읽은 번호.
 * 모르는 이름 · 틀린 값이면 CONFIG_INVALID(problems), 그사이 다른 저장이 있었으면 REVISION_CONFLICT 로 던진다
 */
function save(values: Record<string, unknown>, revision: number): TunablesView {
  const problems = problemsOf(values);
  if (problems.length) throw Object.assign(codedError("CONFIG_INVALID", problems.join("\n")), { problems });
  const saved = shape(values);
  const next = docs.write(DOC, saved, revision);
  use(saved);
  return { values: saved, revision: next, pending: pendingOf(saved) };
}

/** 저장 전 검사(모르는 이름 · 문자열이 아닌 값 · .env 와 같은 값 검사). 문제 줄들 */
function problemsOf(values: Record<string, unknown>): string[] {
  const unknown = Object.keys(values).filter((key) => !TUNABLE_KEYS.has(key));
  const wrongType = Object.entries(values).filter(([, value]) => typeof value !== "string" && value !== null);
  return [...unknown.map((key) => `${key}: 모르는 설정입니다.`), ...wrongType.map(([key]) => `${key}: 문자열로 보내야 합니다.`), ...root.loadConfig(process.env, { tunables: shape(values) }).tuneProblems];
}

// 저장한 값을 설정 객체에 올리고 알린다(다시 시작해야 적용되는 값은 기동 때 값으로)
function use(saved: Record<string, string>) {
  apply(effective(saved));
  for (const error of tunablesChanged()) log.error(`운영 조절값을 저장했지만 적용하지 못한 곳이 있습니다: ${messageOf(error)}`);
}

/** 문서를 외부(가져오기)가 바꿨다. DB 에서 다시 읽어 저장할 때처럼 올린다 */
function reload() {
  use(shape(docs.read(DOC).data));
}

/** 가져오기가 한 트랜잭션 안에서 쓴다. 검사는 problemsOf 로 먼저. 메모리는 reload 로 */
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

export { load, loadReadOnly, save, view, problemsOf, reload, writeRaw };
