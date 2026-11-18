// bgutil(POToken 공급자) 설치의 판단: 어느 태그와 커밋을 받을지, 태그가 가리키는 커밋, 잠금 파일에서 설치 스크립트를 돌릴 의존성. 설정 모듈과 설치 스크립트(scripts/install-bgutil)가 따른다

/** git 커밋 해시(40자 소문자 16진) */
function isCommitSha(text: string) {
  return /^[0-9a-f]{40}$/.test(text);
}

/** refspec, 명령 인자로 넘겨도 되는 태그 이름(`:`, `*`, `..`, 앞의 `-`가 없다) */
function isPlainTag(text: string) {
  return /^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(text) && !text.includes("..");
}

/** 틀린 짝: 어느 이름의 어떤 값이 왜 틀렸나(설정값 문제 줄의 재료) */
type BgutilTargetProblem = { key: "BGUTIL_VERSION" | "BGUTIL_COMMIT"; value: string; reason: string };

/**
 * 받을 태그와 그 태그가 가리켜야 할 커밋. version, commit은 업데이트 탭의 bgutil 카드가 고정한 값(비면 없음).
 * 둘 다 없으면 기본 짝, 기본 태그만 있으면 고정한 커밋. 다른 태그는 커밋이 함께 있어야 한다(태그만으로는 받은 코드를 확인할 수 없다)
 */
function bgutilTarget(version: string, commit: string, defaults: { version: string; commit: string }): { tag: string; commit: string } | BgutilTargetProblem {
  if (!version && !commit) return { tag: defaults.version, commit: defaults.commit };
  if (!version) return { key: "BGUTIL_VERSION", value: "", reason: "커밋만 있고 태그가 없음" };
  if (!isPlainTag(version)) return { key: "BGUTIL_VERSION", value: version, reason: "태그 이름이 아님" };
  if (commit) return isCommitSha(commit) ? { tag: version, commit } : { key: "BGUTIL_COMMIT", value: commit, reason: "커밋 해시 40자(16진수 소문자)여야 함" };
  if (version === defaults.version) return { tag: version, commit: defaults.commit };
  return { key: "BGUTIL_COMMIT", value: "", reason: `태그를 기본값(${defaults.version})과 다르게 두면 그 태그의 커밋이 함께 있어야 함` };
}

/**
 * git ls-remote <저장소> refs/tags/<태그> refs/tags/<태그>^{} 의 출력에서 태그가 가리키는 커밋.
 * 주석 태그는 벗긴 줄(^{})의 커밋, 가벼운 태그는 태그 줄의 커밋이다. 태그가 없으면(출력이 비면) null
 */
function taggedCommit(output: string, tag: string): string | null {
  const lines = output
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([sha, ref]) => sha && isCommitSha(sha.toLowerCase()) && ref);
  const find = (ref: string) => lines.find(([, name]) => name === ref)?.[0]?.toLowerCase() ?? null;
  return find(`refs/tags/${tag}^{}`) ?? find(`refs/tags/${tag}`);
}

/** package-lock.json(v2, v3)의 한 항목에서 쓰는 필드 */
type LockEntry = { hasInstallScript?: boolean; dev?: boolean; devOptional?: boolean; link?: boolean };

/**
 * 설치 스크립트를 돌릴 실행 의존성의 이름(개발 의존성은 빼고, 이름순). npm ci --ignore-scripts 뒤 npm rebuild로 넘긴다.
 * 이름은 셸 명령줄에 들어가므로 npm 패키지 이름 형식이 아니면 예외를 던진다.
 * npm rebuild는 이름이 같은 패키지를 모두 다시 빌드하므로, 같은 이름의 개발 의존성에 설치 스크립트가 있으면 예외를 던진다(개발 의존성의 스크립트가 돌게 된다)
 */
function rebuildTargets(lock: { packages?: Record<string, LockEntry> }): string[] {
  const names = new Set<string>();
  const devNames = new Set<string>();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key || entry.link || !entry.hasInstallScript) continue;
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    if (!/^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)) throw new Error(`lockfile에 잘못된 형식의 패키지 이름이 있습니다: ${key}`);
    (entry.dev || entry.devOptional ? devNames : names).add(name);
  }
  const both = [...names].filter((name) => devNames.has(name));
  if (both.length) throw new Error(`이름이 같은 개발 의존성에도 설치 스크립트가 있어 이름으로 다시 빌드할 수 없습니다: ${both.join(", ")}`);
  return [...names].sort();
}

// npm ci가 루트 패키지에서 돌리는 수명 주기 스크립트
const ROOT_LIFECYCLE = ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare"];

/** 루트 패키지의 설치 수명 주기 스크립트 이름. --ignore-scripts로 건너뛰므로 있으면 사람이 본다 */
function rootInstallScripts(pkg: { scripts?: Record<string, unknown> }): string[] {
  return ROOT_LIFECYCLE.filter((name) => typeof pkg.scripts?.[name] === "string");
}

export { isCommitSha, isPlainTag, bgutilTarget, taggedCommit, rebuildTargets, rootInstallScripts };
export type { BgutilTargetProblem };
