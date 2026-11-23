// 로그 문구: 재생 실패의 오류 줄(error 분류)

const error = {
  playFailed: ({ track, reason }: { track: string; reason: string }) => `재생 실패: ${track} | ${reason}`,
  playFailedRaw: ({ error }: { error: string }) => `재생 실패 원문: ${error}`,
};

export { error };
