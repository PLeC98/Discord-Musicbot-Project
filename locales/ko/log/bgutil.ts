// 로그 문구: bgutil(POToken 서버) 설치(bgutil 분류). 고정한 태그와 커밋의 git 체크아웃

const bgutil = {
  checkoutNotGit: ({ dir }: { dir: string }) => `경로(${dir})가 git 체크아웃이 아닙니다. 지우고 다시 설치하세요`,
  tagMoved: ({ tag, commit, tagged }: { tag: string; commit: string; tagged: string }) => `태그(${tag})가 고정된 커밋(${commit})이 아닌 다른 커밋(${tagged})을 가리킵니다. 태그가 옮겨졌을 수 있어 설치하지 않습니다`,
  /** 다시 빌드할 패키지를 못 정했다(rules/bgutil-install). key: 형식이 잘못된 lockfile의 키 */
  lockBadName: ({ key }: { key: string }) => `lockfile에 잘못된 형식의 패키지 이름이 있습니다: ${key}`,
  /** names: 이름이 같은 개발 의존성에도 설치 스크립트가 있는 패키지(쉼표로 이음) */
  lockDevOverlap: ({ names }: { names: string }) => `이름이 같은 개발 의존성에도 설치 스크립트가 있어 이름으로 다시 빌드할 수 없습니다: ${names}`,
};

export { bgutil };
