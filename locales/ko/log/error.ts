// 로그 문구: 재생 실패의 오류 줄(error 분류)

const error = {
  playFailed: ({ track, reason }: { track: string; reason: string }) => `재생 실패: ${track} | ${reason}`,
  playFailedRaw: ({ error }: { error: string }) => `재생 실패 원문: ${error}`,
  noticeTemplateVarsMissing: ({ code, names }: { code: string; names: string }) => `안내 문구 템플릿 변수가 누락되어 기본 오류 메시지로 대체: ${code} (${names})`,
};

export { error };
