// 로그 문구: bgutil(POToken 서버) 설치(bgutil 분류). 고정한 태그와 커밋의 git 체크아웃

const bgutil = {
  checkoutNotGit: ({ dir }: { dir: string }) => `경로(${dir})가 git 체크아웃이 아닙니다. 지우고 다시 설치하세요`,
  tagMoved: ({ tag, commit, tagged }: { tag: string; commit: string; tagged: string }) => `태그(${tag})가 고정된 커밋(${commit})이 아닌 다른 커밋(${tagged})을 가리킵니다. 태그가 옮겨졌을 수 있어 설치하지 않습니다`,
  /** 다시 빌드할 패키지를 못 정했다(rules/bgutil-install). key: 형식이 잘못된 lockfile의 키 */
  lockBadName: ({ key }: { key: string }) => `lockfile에 잘못된 형식의 패키지 이름이 있습니다: ${key}`,
  /** names: 이름이 같은 개발 의존성에도 설치 스크립트가 있는 패키지(쉼표로 이음) */
  lockDevOverlap: ({ names }: { names: string }) => `이름이 같은 개발 의존성에도 설치 스크립트가 있어 이름으로 다시 빌드할 수 없습니다: ${names}`,
  /** 체크아웃이 고정한 커밋 그대로가 아니다. head: 지금 HEAD, changed: 바뀐 파일 수(없으면 0) */
  checkoutNotPinned: ({ commit, head, changed }: { commit: string; head: string; changed: number }) => `체크아웃 상태가 고정된 커밋(${commit}) 그대로가 아닙니다(HEAD ${head}${changed ? `, 바뀐 파일 ${changed}개` : ""})`,
  serverFolderMissing: () => `체크아웃에 server 폴더가 없음`,
  rootInstallScripts: ({ scripts }: { scripts: string }) => `server/package.json에 설치 스크립트(${scripts})가 생김. 무엇을 하는지 확인한 뒤 설치 스크립트를 고쳐야 함`,
  serverVersionMissing: () => `server/package.json에 버전이 없음`,
  trialFailed: ({ reason }: { reason: string }) => `실행 테스트 실패: ${reason}`,
  trialServerNotExited: ({ pid }: { pid: string }) => `실행 테스트로 띄운 POToken 서버(PID ${pid})가 끝나지 않음`,
};

export { bgutil };
