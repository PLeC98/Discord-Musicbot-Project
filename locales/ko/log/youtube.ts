// 로그 문구: 유튜브(youtube 분류). 쿠키 파일 저장, 정리

const youtube = {
  refreshedCookiesSaveFailed: ({ error }: { error: string }) => `yt-dlp가 갱신한 쿠키 다시 저장 실패: ${error}`,
  leftoverCookieFilesListFailed: ({ error }: { error: string }) => `잔류 쿠키 파일 조회 실패: ${error}`,
  leftoverCookieFilesRemoved: ({ count }: { count: number }) => `이전 실행에서 남은 쿠키 파일 ${count}개 삭제`,
  cookiesFileIgnored: () => `config/cookies.txt는 이제 읽지 않음. 운영자 패널의 연령 제한 탭에서 쿠키를 다시 입력하고 이 파일은 삭제하세요`,
};

export { youtube };
