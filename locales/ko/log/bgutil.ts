// 로그 문구: bgutil(POToken 서버) 설치(bgutil 분류). 고정한 태그와 커밋의 git 체크아웃, 설치 인자, 설치 단계, 기록, 실행 테스트, 터미널에서 고정 바꾸기

import { josa } from "../../../src/infra/josa.ts";

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
  argsTagMissing: ({ name }: { name: string }) => `${name} 뒤에 태그를 넣으세요(예: ${name} 2.0.2)`,
  argsNotTag: ({ value }: { value: string }) => `태그 이름이 아닙니다: ${value}`,
  argsCommitInvalid: ({ valueSuffix }: { valueSuffix: string }) => `--commit 뒤에 커밋 해시 40자를 넣으세요${valueSuffix}`,
  argsModesExclusive: () => `--pin, --unpin, --tag는 함께 쓸 수 없습니다`,
  argsUnpinWithCommit: () => `--unpin에는 --commit을 쓰지 않습니다`,
  argsTagNeedsCommit: () => `--tag에는 --commit을 함께 넣으세요`,
  argsCommitAlone: () => `--commit은 --pin이나 --tag와 함께 씁니다`,
  argsUnknown: ({ arg }: { arg: string }) => `모르는 인자입니다: ${arg}`,
  stepNpmCi: () => `의존성 설치(npm ci --ignore-scripts)`,
  stepRebuild: ({ names }: { names: string }) => `설치 스크립트가 있는 실행 의존성만 다시 빌드(npm rebuild ${names})`,
  stepTsc: () => `서버 빌드(tsc)`,
  stateSetAside: ({ error, file }: { error: string; file: string }) => `bgutil 기록(state.json)을 읽지 못해(${error}) ${file} 파일로 옮기고 새로 기록했습니다`,
  publishRenameFailed: () => `체크아웃한 폴더를 버전 폴더로 옮기지 못함(안의 파일이 열려 있음)`,
  stepCheckout: ({ tag, commit }: { tag: string; commit: string }) => `체크아웃(${tag}, ${commit})`,
  stateBuildInvalid: () => `빌드 기록 형식이 올바르지 않음`,
  trialNoAnswer: ({ seconds }: { seconds: number }) => `${seconds}초 안에 응답하지 않음`,
  trialSpawnFailed: ({ error }: { error: string }) => `실행 실패: ${error}`,
  trialExitedEarly: ({ code }: { code: number }) => `응답하기 전에 끝남(code=${code})`,
  stepTrial: ({ version }: { version: string }) => `실행 테스트(/ping이 ${version}${josa(version, "으로")} 응답하는지)`,
  /** version: 응답한 버전(없으면 null) */
  trialOtherVersion: ({ expected, version }: { expected: string; version: string | null }) => `다른 버전으로 응답함(기대 ${expected}, 응답 ${version ?? "없음"})`,
  /** output: 서버 출력(stderr)의 마지막 세 줄 */
  trialWithOutput: ({ reason, output }: { reason: string; output: string }) => `${reason} | 서버 출력: ${output}`,
  tagNotFound: ({ tag, tagsUrl }: { tag: string; tagsUrl: string }) => `저장소에 태그가 없음: ${tag}(태그 목록: ${tagsUrl})`,
  alreadyInUse: ({ tag, version }: { tag: string; version: string }) => `이미 ${tag}(서버 ${version}) 사용 중`,
  restartBot: () => `켜져 있는 봇을 다시 시작하세요(다시 시작해야 새 버전 적용)`,
  installFailed: ({ tag, reason }: { tag: string; reason: string }) => `${tag} 설치 실패(지금 쓰는 bgutil 그대로): ${reason}`,
  installFailedHint: () => `git, node, canvas 네이티브 모듈용 빌드 도구가 있는지, 네트워크와 태그를 확인하세요`,
  tagCommit: ({ tag, commit }: { tag: string; commit: string }) => `태그 ${tag}의 커밋: ${commit}`,
  pinNone: () => `없음`,
  pinKeptAfterFailure: ({ was }: { was: string }) => `설치하지 못해 설정은 그대로 둠(고정 ${was})`,
  settingsUnread: ({ error }: { error: string }) => `설정 DB(database/settings.db)에서 bgutil 고정 값을 읽지 못해 설치하지 않음: ${error}`,
  failed: ({ error }: { error: string }) => `설치 실패(지금 쓰는 bgutil 그대로): ${error}`,
  installed: ({ tag, version, from }: { tag: string; version: string; from: string | null }) => `${tag}(서버 ${version}) 설치 완료${from ? `(이전 ${from})` : ""}`,
  busy: ({ holder }: { holder: number | null }) => `설치 건너뜀: 다른 프로세스(${holder ? `PID ${holder}` : "PID 모름"})가 vendor/bgutil 사용 중`,
  pinBotRunning: ({ holder }: { holder: number | null }) => `봇이 실행 중이라(${holder ? `PID ${holder}` : "PID 모름"}) bgutil 고정을 바꾸지 않습니다. 대시보드 운영자 패널의 업데이트 탭에서 바꾸거나, 봇을 끄고 다시 실행하세요`,
  pinChanged: ({ was, now }: { was: string; now: string }) => `터미널에서 bgutil 고정 변경: ${was} → ${now}`,
  /** 설치가 돌린 git 명령. command: 명령 그대로, dir: 체크아웃 폴더 */
  gitCommand: ({ command, dir }: { command: string; dir: string }) => `${command} (${dir})`,
};

export { bgutil };
