// bgutil(POToken 공급자) 설치의 판단: 어느 태그와 커밋을 받을지, 잠금 파일에서 설치 스크립트를 돌릴 의존성. 설치 스크립트(scripts/install-bgutil)가 따른다

/** git 커밋 해시(40자 소문자 16진) */
function isCommitSha(text: string) {
  return /^[0-9a-f]{40}$/.test(text);
}

/** refspec, 명령 인자로 넘겨도 되는 태그 이름(`:`, `*`, `..`, 앞의 `-` 가 없다) */
function isPlainTag(text: string) {
  return /^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(text) && !text.includes("..");
}

/**
 * 받을 태그와 그 태그가 가리켜야 할 커밋. commit 은 .env 의 BGUTIL_COMMIT(비면 없음).
 * 기본 태그면 고정한 커밋, 다른 태그면 commit 을 함께 받아야 한다(태그만으로는 받은 코드를 확인할 수 없다). 받지 못하면 error
 */
function bgutilPin(version: string, commit: string, defaults: { version: string; commit: string }): { tag: string; commit: string } | { error: string } {
  if (!isPlainTag(version)) return { error: `BGUTIL_VERSION 이 태그 이름이 아닙니다: ${version}` };
  if (commit) return isCommitSha(commit) ? { tag: version, commit } : { error: `BGUTIL_COMMIT 은 커밋 해시 40자(소문자 16진)여야 합니다: ${commit}` };
  if (version === defaults.version) return { tag: version, commit: defaults.commit };
  return { error: `BGUTIL_VERSION 을 기본값(${defaults.version})과 다르게 두면 그 태그의 커밋 40자를 BGUTIL_COMMIT 에 함께 적으세요. 커밋은 git ls-remote <저장소> refs/tags/${version}^{} 로 확인합니다` };
}

/** package-lock.json(v2, v3)의 한 항목에서 쓰는 필드 */
type LockEntry = { hasInstallScript?: boolean; dev?: boolean; devOptional?: boolean; link?: boolean };

/**
 * 설치 스크립트를 돌릴 실행 의존성의 이름(개발 의존성은 빼고, 이름순). npm ci --ignore-scripts 뒤 npm rebuild 로 넘긴다.
 * 이름은 셸 명령줄에 들어가므로 npm 패키지 이름 형식이 아니면 던진다.
 * npm rebuild 는 이름이 같은 패키지를 모두 다시 빌드하므로, 같은 이름의 개발 의존성에 설치 스크립트가 있으면 던진다(개발 의존성의 스크립트가 돌게 된다)
 */
function rebuildTargets(lock: { packages?: Record<string, LockEntry> }): string[] {
  const names = new Set<string>();
  const devNames = new Set<string>();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key || entry.link || !entry.hasInstallScript) continue;
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    if (!/^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)) throw new Error(`잠금 파일의 패키지 이름이 아닙니다: ${key}`);
    (entry.dev || entry.devOptional ? devNames : names).add(name);
  }
  const both = [...names].filter((name) => devNames.has(name));
  if (both.length) throw new Error(`이름이 같은 개발 의존성에도 설치 스크립트가 있어 이름으로 다시 빌드할 수 없습니다: ${both.join(", ")}`);
  return [...names].sort();
}

// npm ci 가 루트 패키지에서 돌리는 수명 주기 스크립트
const ROOT_LIFECYCLE = ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare"];

/** 루트 패키지의 설치 수명 주기 스크립트 이름. --ignore-scripts 로 건너뛰므로 있으면 사람이 본다 */
function rootInstallScripts(pkg: { scripts?: Record<string, unknown> }): string[] {
  return ROOT_LIFECYCLE.filter((name) => typeof pkg.scripts?.[name] === "string");
}

export { isCommitSha, isPlainTag, bgutilPin, rebuildTargets, rootInstallScripts };
