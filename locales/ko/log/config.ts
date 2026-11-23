// 로그 문구: 설정(config 분류). 기동 때의 설정 검사와 로그 언어 고르기

const config = {
  /** 적은 LOG_LANGUAGE를 쓸 수 없어 다른 언어로 찍는다. malformed: 언어 태그 형식이 아님(아니면 그 언어의 로그 문구가 없음) */
  logLanguageIgnored: ({ value, malformed, language }: { value: string; malformed: boolean; language: string }) => `LOG_LANGUAGE 무시(${value}): ${malformed ? "언어 태그 형식이 아님" : "그 언어의 로그 문구가 없음"}. 로그 언어: ${language}`,
  tunableInvalid: ({ problem }: { problem: string }) => `운영 설정값 ${problem}. 해당 값은 기본값으로 적용. 운영자 패널에서 수정하세요`,
  tunablesApplyFailed: ({ error }: { error: string }) => `운영 설정값을 저장했지만 적용하지 못한 곳이 있음: ${error}`,
  aiModelInfoLoadFailed: ({ error }: { error: string }) => `AI 모델 정보 불러오기 실패(PocketRisu 레지스트리): ${error}. 기존 정보를 씀`,
  aiPricesLoadFailed: ({ error }: { error: string }) => `AI 가격표 불러오기 실패(models.dev): ${error}. 기존 가격표로 비용 계산`,
  aiModelInfoReadFailed: ({ file, error }: { file: string; error: string }) => `AI 모델 정보 읽기 실패(${file}): ${error}`,
  aiPricesReadFailed: ({ file, error }: { file: string; error: string }) => `AI 가격표 읽기 실패(${file}): ${error}`,
  aiAssistSettings: ({ lines }: { lines: string }) => `AI 보조 설정: ${lines}`,
  /** AI 모델 정보가 우리가 정하는 칸(모델, 프롬프트)을 바꾸려 했다. items: 앞의 몇 개, more: 더 있다 */
  aiModelInfoTouchingOurs: ({ count, items, more }: { count: number; items: string; more: boolean }) => `AI 모델 정보가 모델, 프롬프트 칸을 바꾸려 해 그 값은 쓰지 않음(${count}곳): ${items}${more ? " 등" : ""}`,
  /** AI 모델 정보에서 형식이 맞지 않는 프로필을 뺐다. items: 앞의 몇 개, more: 더 있다 */
  aiModelInfoProfilesSkipped: ({ count, items, more }: { count: number; items: string; more: boolean }) => `AI 모델 정보에서 형식이 맞지 않는 프로필 ${count}개를 빼고 저장: ${items}${more ? " 등" : ""}`,
  /** 자동재생 장르 설정이 잘못됐다. kept: 이전 정상 설정으로 동작한다(아니면 장르가 없다) */
  genresInvalid: ({ error, kept }: { error: string; kept: boolean }) => `${error}\n   ${kept ? "고칠 때까지 이전 정상 설정으로 동작" : "고칠 때까지 자동재생 장르가 없음. 운영자 패널의 자동재생 탭에서 고치세요"}`,
  /** 활동 문구 설정이 잘못됐다. kept: 이전 정상 설정으로 동작한다(아니면 활동 문구를 걸지 않는다) */
  statusInvalid: ({ error, kept }: { error: string; kept: boolean }) => `${error}\n   ${kept ? "고칠 때까지 이전 정상 설정으로 동작" : "고칠 때까지 활동 문구를 걸지 않음. 운영자 패널의 상태 문구 탭에서 고치세요"}`,
  /** AI 모델 정보 레지스트리(PocketRisu)가 HTTP 오류로 답했다. at: 받은 주소 */
  registryHttpFailed: ({ status, at }: { status: number; at: string }) => `레지스트리 ${status}: ${at}`,
  registryNoHash: () => `레지스트리 인덱스에 해시가 없음`,
  /** version: 받은 카탈로그 형식, supported: 읽을 수 있는 형식 */
  registryFormatUnsupported: ({ version, supported }: { version: string; supported: number }) => `지원하지 않는 레지스트리 카탈로그 형식: ${version}(${supported}만 지원)`,
  registryHashMismatch: () => `레지스트리 인덱스와 카탈로그의 해시가 다름(원격에서 갱신 중, 다음에 다시 불러옴)`,
  /** 모델 필드가 통째로 빈 레지스트리. registries: 이름(쉼표로 이음) */
  registryFieldsLost: ({ registries }: { registries: string }) => `${registries}의 모델 필드가 통째로 비어 있음. 원격 형식이 바뀐 것으로 보여 쓰지 않음`,
};

export { config };
