// 로그 문구: ZIP 읽기(infra/zip). 설정 불러오기, yt-dlp 받기 등 여러 분류의 줄에 값으로 들어간다

const zip = {
  receiverClosed: () => `받는 쪽이 닫힘`,
  readFailed: ({ why }: { why: string }) => `ZIP 파일 읽기 실패: ${why}`,
};

export { zip };
