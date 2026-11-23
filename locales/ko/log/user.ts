// 로그 문구: 사용자 설정(user 분류). 사용자별 설정 읽기, 알림

const user = {
  userSettingsJsonInvalid: ({ userId }: { userId: string }) => `사용자 ${userId} 설정 읽기 실패(정하지 않은 것으로 읽음): 올바른 JSON 형식이 아님`,
  userSettingsValueInvalid: ({ userId, fields }: { userId: string; fields: string }) => `사용자 ${userId} 설정의 ${fields} 값 검증 실패(정하지 않은 것으로 읽음)`,
  userSettingsNotifyFailed: () => `사용자 설정 변경 알림 처리 실패:`,
  userSettingsReadFailed: () => `사용자 설정 읽기 실패(정하지 않은 것으로 적용):`,
};

export { user };
