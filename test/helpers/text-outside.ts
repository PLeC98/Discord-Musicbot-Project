// 봇 코드(src/, scripts/)에 적힌 한글 문자열을 파일별, 종류별로 센다(문구표가 있는 언어 폴더 locales/<언어>/는 훑지 않는다). 데이터는 세지 않는다.
// 종류: 로그 계열(log. 로그, 예외 메시지, 터미널 출력), 일어날 수 없는 일의 예외(bug. infra/bug), 그 밖(outside. 화면, 디스코드로 가거나 호출 밖에서 만든 글).
// 로그 계열은 가장 가까운 호출로 판별한다: 로거(log.warn 등, 같은 파일에서 logger.child로 만든 로거 포함), 로그 라벨을 받는 함수, repeatingFailure가 반환한 객체의 fail,
// 스크립트 줄(scriptLine이 만든 함수), Error를 생성하는 곳(Error를 상속한 클래스의 super 포함), throw

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.join(import.meta.dirname, "..", "..");
const HANGUL = /[가-힣ㄱ-ㆎ]/;

// 로그 라벨, 예외 메시지를 받는 함수(이름이 같으면 어느 모듈의 것이든). 문자열 인자가 로그로만 전달되는 것을 확인했고, 저장소에서 이름이 유일하다
const LOG_CALLS = new Set(["bestEffort", "unlessGone", "repeatingFailure", "failing", "warnOnce", "codedError", "logRejection", "register", "dispose", "describeError", "timeoutError", "logTitle", "wrongKey", "untilDiscordAnswers", "answerDuring", "expireMessage", "_repostNowPlaying", "scheduleEmpty", "refreshPanel", "noticeFailed", "unreserve", "enoughMemory", "av1LpFor", "rotatedFilesOf", "botChannelAtDiscord", "_botChannelAtDiscord"]);
// 이름이 흔해 지정한 파일 안에서만 로그 라벨 함수로 취급하는 목록
const LOG_CALLS_IN: Readonly<Record<string, readonly string[]>> = {
  "src/dashboard/routes/login-background.ts": ["changed"],
  "src/dashboard/routes/appearance.ts": ["changing"],
  "src/dashboard/routes/vendor.ts": ["saveCard"],
  "src/player/voice-link.ts": ["release", "disconnect", "recover"],
  // 로거를 감싼 지역 함수, 실패를 결과(result.json, 저장소 관리 워크플로가 읽는다)에 모으는 함수의 라벨
  "scripts/update-ytdlp.ts": ["say"],
  "scripts/check-vendor-updates.ts": ["attempt"],
};
// 요청 객체의 로그 라벨 속성(요청 로그와 조회 로그의 라벨, 정리 로그의 사유)
const LABEL_PROPS = new Set(["source", "reason"]);
const LABEL_PROP_CALLS = new Set(["requestPlayback", "playOnReply", "continueCollection", "leaveGuild", "dispose"]);
const LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal", "log"]);

// 문구가 아니라 데이터인 파일(전체)과 선언(해당 이름의 선언 내부). 화면에 노출되어도 번역할 문구가 아니다
const DATA_FILES: Readonly<Record<string, string>> = {
  "src/rules/ko-search.ts": "한글 검색의 자모 표",
  "src/infra/josa.ts": "조사 표",
  "src/sources/youtube/match.ts": "제목 맞추기 표",
  "src/config/defaults/genres.ts": "운영자가 수정하는 기본 장르 문서",
  "src/config/defaults/status.ts": "운영자가 수정하는 기본 활동 문구 문서",
  "src/config/legacy-ai-defaults.ts": "비교에만 쓰는 이전 AI 기본값",
  "src/autoplay/assist/sample.ts": "모델에 보내는 예시 곡(화면에도 보낸 값을 그대로 보인다)",
};
const DATA_DECLARATIONS: Readonly<Record<string, readonly string[]>> = {
  // 해당 언어로 표기한 언어 이름(화면 언어와 상관없이 같다)
  "src/rules/languages.ts": ["LANGUAGES"],
  // 모델에 보내는 질문(화면에도 보낸 값을 그대로 보인다)
  "src/autoplay/assist/index.ts": ["PING_TEXT"],
  // 빌드 도구가 만드는 파일의 내용(저장소에 넣는 파일이라 로그 언어를 따르지 않는다)과 읽는 원본의 절 제목
  "scripts/build-emoji-list.ts": ["NOTE_SECTION", "source"],
  "scripts/build-icon-font.ts": ["body"],
  "scripts/build-mono-font.ts": ["body"],
  "scripts/build-sans-font.ts": ["body"],
  "scripts/build-twemoji-font.ts": ["body"],
  // diff 줄을 짝짓는 키에 넣는 경로 자리표시
  "scripts/verify-move.ts": ["normalize"],
};

const posix = (p: string) => p.split(path.sep).join("/");

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = posix(path.join(dir, e.name));
    return e.isDirectory() ? walk(rel) : rel.endsWith(".ts") ? [rel] : [];
  });
}

/** 속성 접근, 인덱스 접근, 호출 체인의 맨 앞 식별자(a.b[c].d() → a). 없으면 null */
function rootName(node: ts.Expression): string | null {
  let at: ts.Expression = node;
  for (;;) {
    if (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) at = at.expression;
    else if (ts.isCallExpression(at)) at = at.expression;
    else if (ts.isNonNullExpression(at) || ts.isParenthesizedExpression(at)) at = at.expression;
    else break;
  }
  return ts.isIdentifier(at) ? at.text : null;
}

/** 해당 파일에서 초기값에 지정한 호출이 포함된 변수 이름 목록(const wlog = logger.child(...), const fails = repeatingFailure(...)) */
function namesMadeBy(source: ts.SourceFile, made: RegExp): Set<string> {
  const out = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && made.test(node.initializer.getText(source))) out.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

type Scope = { rel: string; loggers: Set<string>; failures: Set<string>; lines: Set<string> };

function isLogCall(call: ts.CallExpression, scope: Scope): boolean {
  const callee = call.expression;
  if (callee.kind === ts.SyntaxKind.SuperKeyword) return isInErrorClass(call);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : null;
  const root = rootName(callee);
  // 로거: 로거 이름으로 시작해 로그 레벨 이름으로 끝나거나, 레벨을 동적으로 선택한다(log[level])
  if (root && scope.loggers.has(root) && ((name && LEVELS.has(name)) || ts.isElementAccessExpression(callee))) return true;
  // repeatingFailure가 반환한 객체(또는 이를 감싼 failuresOf)의 fail
  if (name === "fail" && root && (scope.failures.has(root) || root === "failuresOf")) return true;
  // 스크립트 줄: scriptLine이 만든 함수(say 등)나 scriptLine(분류)(수준, 글)
  if (ts.isIdentifier(callee) && scope.lines.has(callee.text)) return true;
  if (ts.isCallExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "scriptLine") return true;
  if (name && (LOG_CALLS.has(name) || LOG_CALLS_IN[scope.rel]?.includes(name))) return true;
  return false;
}

/** Error를 상속한 클래스 안의 super(...) */
function isInErrorClass(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isClassLike(at)) return (at.heritageClauses ?? []).some((clause) => clause.types.some((type) => /Error$/.test(type.expression.getText())));
  }
  return false;
}

function isLogged(node: ts.Node, scope: Scope): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isThrowStatement(at)) return true;
    if (ts.isNewExpression(at) && /Error$|^DOMException$/.test(at.expression.getText())) return true;
    if (ts.isCallExpression(at) && isLogCall(at, scope)) return true;
    // 요청 객체의 로그 라벨 속성
    if (ts.isPropertyAssignment(at) && LABEL_PROPS.has(at.name.getText()) && ts.isObjectLiteralExpression(at.parent) && ts.isCallExpression(at.parent.parent)) {
      const callee = at.parent.parent.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      if (LABEL_PROP_CALLS.has(name)) return true;
    }
    if (ts.isFunctionLike(at) || ts.isSourceFile(at)) return false;
  }
  return false;
}

/** bug(…)의 인자 안(가장 가까운 함수 경계까지) */
function isBug(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isCallExpression(at) && ts.isIdentifier(at.expression) && at.expression.text === "bug") return true;
    if (ts.isFunctionLike(at) || ts.isSourceFile(at)) return false;
  }
  return false;
}

/** 데이터: SQL(exec에 넘기는 문자열), 데이터로 지정한 선언 내부 */
function isData(node: ts.Node, rel: string): boolean {
  const declared = DATA_DECLARATIONS[rel] ?? [];
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isCallExpression(at) && ts.isPropertyAccessExpression(at.expression) && at.expression.name.text === "exec") return true;
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name) && declared.includes(at.name.text)) return true;
  }
  return false;
}

/** 한글이 든 문자열 자리 하나. kind: 로그 계열(log), 일어날 수 없는 일의 예외(bug), 데이터(data), 그 밖(outside). start: 소스 안의 시작 위치 */
type KoreanSite = { line: number; start: number; text: string; kind: "log" | "bug" | "data" | "outside" };

/** 소스 파일 하나의 모든 한글 문자열 자리(로그 계열, bug, 데이터 포함) */
function koreanSites(rel: string, text: string): KoreanSite[] {
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const scope: Scope = { rel, loggers: new Set(["log", "logger", "console", ...namesMadeBy(source, /\.child\(/)]), failures: namesMadeBy(source, /\brepeatingFailure\(|\bfailuresOf\(/), lines: namesMadeBy(source, /\bscriptLine\(/) };
  const out: KoreanSite[] = [];
  const visit = (node: ts.Node) => {
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if (literal && HANGUL.test(node.text)) {
      const kind = DATA_FILES[rel] || isData(node, rel) ? "data" : isBug(node) ? "bug" : isLogged(node, scope) ? "log" : "outside";
      out.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, start: node.getStart(source), text: node.text, kind });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** 소스 하나에서 로그, 데이터가 아닌 한글 문자열(줄 번호와 문자열) */
const rowsIn = (rel: string, text: string): Array<{ line: number; text: string }> =>
  koreanSites(rel, text)
    .filter((site) => site.kind === "outside")
    .map(({ line, text: value }) => ({ line, text: value }));

/** 파일 하나의 로그, 데이터 밖 한글 문자열 */
const stringsOf = (rel: string): string[] => rowsIn(rel, fs.readFileSync(path.join(ROOT, rel), "utf8")).map((one) => one.text);

/** 지도에서 세는 종류(데이터는 세지 않는다) */
type CountedKind = "outside" | "log" | "bug";
type KoreanCounts = Partial<Record<CountedKind, number>>;

/** 문구표 밖 한글 지도: src와 scripts의 파일마다 종류별 한글 문자열 수(0인 종류와 파일은 뺀다) */
function koreanMap(): Record<string, KoreanCounts> {
  const map: Record<string, KoreanCounts> = {};
  for (const rel of [...walk("src"), ...walk("scripts")]) {
    const counts: KoreanCounts = {};
    for (const site of koreanSites(rel, fs.readFileSync(path.join(ROOT, rel), "utf8"))) if (site.kind !== "data") counts[site.kind] = (counts[site.kind] ?? 0) + 1;
    if (Object.keys(counts).length) map[rel] = counts;
  }
  return map;
}

export { koreanMap, stringsOf, rowsIn, koreanSites, DATA_FILES, DATA_DECLARATIONS, LOG_CALLS_IN };
export type { KoreanSite, KoreanCounts, CountedKind };
