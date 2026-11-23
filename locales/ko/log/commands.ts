// 로그 문구: 명령어 처리(commands 분류). /queue 썸네일, /system 이미지 그리기, 명령어로 바꾼 서버 설정 저장

const commands = {
  queueThumbnailWaitTimedOut: ({ waitMs }: { waitMs: number }) => `/queue 썸네일 대기 시간 초과(이미지 없이 출력): ${waitMs}ms`,
  setchannelSaveFailed: ({ name, id, field, error }: { name: string; id: string; field: string; error: string }) => `서버 설정 저장 실패(/setchannel): ${name} (${id}) | ${field} | ${error}`,
  panelMoveAfterChannelChangeFailed: ({ error }: { error: string }) => `전용 채널 변경 후 패널 이동 실패: ${error}`,
  setplaylistlimitSaveFailed: ({ name, id, field, error }: { name: string; id: string; field: string; error: string }) => `서버 설정 저장 실패(/setplaylistlimit): ${name} (${id}) | ${field} | ${error}`,
  renderWorkerExited: ({ code }: { code: number }) => `그리기 워커가 종료됨(종료 코드=${code})`,
  renderTimedOut: ({ seconds }: { seconds: number }) => `이미지 그리기 시간 초과(${seconds}초)`,
  queueThumbnailLabel: () => `/queue 썸네일 처리`,
  notRasterImage: () => `JPEG, PNG, WebP 가 아님`,
  queueThumbnailFailed: ({ key, error }: { key: string; error: string }) => `/queue 썸네일 처리 실패(대체 이미지로 출력): ${key} | ${error}`,
  dashboardReplyDelete: () => `/dashboard 응답 삭제`,
  joinPlaceholderUpdate: () => `/join 자리표시자 갱신`,
  placeholderDelete: () => `자리표시자 삭제`,
  systemRenderLabel: () => `/system 이미지 그리기`,
  queueRenderLabel: () => `/queue 썸네일 그리기`,
  renderWorkerLabel: () => `이미지 그리기 워커`,
  renderFailed: () => `그리기 실패`,
  renderCauseUnknown: () => `원인 불명`,
  renderWorkerStopped: ({ error }: { error: string }) => `워커 중단(${error})`,
  renderWorkerExitedCode: ({ code }: { code: number }) => `워커 비정상 종료(종료 코드=${code})`,
  renderWorkerTimedOut: ({ seconds }: { seconds: number }) => `${seconds}초 안에 끝나지 않아 워커 중단`,
};

export { commands };
