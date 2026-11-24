// 로그 문구: 전체 백업 스크립트(scripts/backup)의 터미널 출력

const backup = {
  made: ({ file }: { file: string }) => `전체 백업을 만들었습니다: ${file}`,
  backgroundsIncluded: ({ backgrounds }: { backgrounds: number }) => `로그인 배경 ${backgrounds}개를 담았습니다(만드는 중인 배경은 담지 않습니다)`,
  usersIncluded: () => `사용자 데이터(언어 설정)를 담았습니다`,
  audioIncluded: ({ audioFiles }: { audioFiles: number }) => `오디오 캐시: 캐시 파일 ${audioFiles}개, 자동 검색 결과, 직접 지정한 음원을 담았습니다`,
  audioIndexOnly: () => `오디오 캐시: 자동 검색 결과 · 직접 지정한 음원을 담았습니다(캐시 파일까지는 --with-audio)`,
  previousRemoved: ({ files }: { files: string }) => `이전 백업을 삭제했습니다: ${files}`,
  previousLeft: ({ files }: { files: string }) => `주의: 이전 백업을 삭제하지 못했습니다(다른 프로그램이 열어 두었을 수 있습니다). 평문 비밀값이 든 파일이니 직접 삭제하세요: ${files}`,
  envMissing: () => `주의: .env가 없어 담지 못했습니다. 옮긴 곳에서 .env를 따로 맞춰야 합니다`,
  legacyPartsLeft: ({ files }: { files: string }) => `주의: 예전 버전에서 중단된 백업 임시 파일이 남아 있습니다. 평문 비밀값이 들어 있을 수 있으니, 지금 도는 다른 백업이 없으면 직접 삭제하세요: ${files}`,
  partLeft: ({ path, code }: { path: string; code: string }) => `백업 완료 후 임시 파일(.part) 삭제 실패: ${path} (${code}). 평문 .env가 포함되어 있으니 직접 삭제하세요`,
  tempLeft: ({ files }: { files: string }) => `주의: 임시 사본을 삭제하지 못했습니다(설정 DB 사본에는 암호문 비밀값이 들어 있습니다). 직접 삭제하세요: ${files}`,
  secretsWarning: () => `이 파일에는 봇 토큰과 SECRETS_KEY가 평문으로 들어 있습니다. .env처럼 다루고, 옮긴 뒤에는 삭제하세요.`,
  howToMove: () => `옮기는 법: 옮길 봇 폴더에서 봇을 끄고, 이 ZIP을 그 폴더에 풀어 덮어쓴 뒤 봇을 켭니다(설정 DB와 사용자 데이터 DB는 시작할 때 교체하고, 오디오 캐시는 시작할 때 합칩니다).`,
  failed: ({ error }: { error: string }) => `전체 백업을 만들지 못했습니다: ${error}`,
};

export { backup };
